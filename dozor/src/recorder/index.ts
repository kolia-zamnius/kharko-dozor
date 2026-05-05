import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import type { RecordPlugin } from "@rrweb/types";
import type { eventWithTime } from "rrweb";
import { record } from "rrweb";
import type { DozorOptions, DozorState, UserIdentity, UserTraits } from "../types";
import { collectMetadata } from "./browser/metadata";
import { clearSessionId, getSessionId } from "./browser/session";
import { VisibilityManager } from "./browser/visibility-manager";
import { Emitter } from "./core/emitter";
import { StateMachine } from "./core/state-machine";
import type { Logger } from "./logger";
import { createLogger } from "./logger";
import { EventBuffer } from "./pipeline/event-buffer";
import { FlushScheduler } from "./pipeline/flush-scheduler";
import { IdleDetector } from "./pipeline/idle-detector";
import { PageTracker } from "./slicing/page-tracker";
import { SliceManager } from "./slicing/slice-manager";
import { Transport } from "./transport";

const DEFAULT_FLUSH_INTERVAL = 60_000;
const DEFAULT_BATCH_SIZE = 2_000;
const DEFAULT_FETCH_TIMEOUT = 10_000;
const IDLE_THRESHOLD = 60_000;

export class Dozor {
  private static instance: Dozor | null = null;

  // ── Subsystems ───────────────────────────────────────

  private emitter: Emitter;
  private stateMachine: StateMachine;
  private eventBuffer: EventBuffer;
  private idleDetector: IdleDetector;
  private sliceManager: SliceManager;
  private flushScheduler: FlushScheduler;
  private visibilityManager: VisibilityManager;
  private transport: Transport;
  private pageTracker: PageTracker | null = null;
  private logger: Logger;

  // ── Instance state ───────────────────────────────────

  private _sessionId: string | null = null;
  private _isHeld: boolean;
  private _userIdentity: UserIdentity | null = null;
  private stopRecording: (() => void) | null = null;
  private plugins: RecordPlugin[];
  private privacyMaskAttribute: string;
  private privacyBlockAttribute: string;
  private privacyBlockMedia: boolean;
  private privacyMaskInputs: boolean;

  // ── Subscribers (external state observers) ──────────

  private subscribers = new Set<() => void>();

  // ── Constructor ──────────────────────────────────────

  private constructor(options: DozorOptions) {
    const endpoint = options.endpoint;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    const fetchTimeout = options.fetchTimeout ?? DEFAULT_FETCH_TIMEOUT;

    this.logger = createLogger(options.debug ?? false);
    this.logger.log("init: starting", {
      endpoint,
      flushInterval,
      batchSize,
      fetchTimeout,
      autoStart: options.autoStart ?? true,
      hold: options.hold ?? false,
      pauseOnHidden: options.pauseOnHidden ?? true,
      recordConsole: options.recordConsole !== false,
    });

    this._isHeld = options.hold ?? false;
    this.privacyMaskAttribute = options.privacyMaskAttribute ?? "data-dozor-mask";
    this.privacyBlockAttribute = options.privacyBlockAttribute ?? "data-dozor-block";
    this.privacyBlockMedia = options.privacyBlockMedia ?? false;
    this.privacyMaskInputs = options.privacyMaskInputs ?? true;

    this.plugins = [];
    if (options.recordConsole !== false) {
      this.plugins.push(getRecordConsolePlugin());
    }

    // Create subsystems
    this.emitter = new Emitter(this.logger);
    this.stateMachine = new StateMachine(this.emitter, this.logger);
    this.transport = new Transport(endpoint, options.apiKey, this.logger, fetchTimeout);
    this.eventBuffer = new EventBuffer(this.emitter, this.logger);
    this.idleDetector = new IdleDetector(this.emitter, this.logger, IDLE_THRESHOLD);
    this.sliceManager = new SliceManager(this.emitter, this.logger);
    this.flushScheduler = new FlushScheduler(this.emitter, this.logger, {
      interval: flushInterval,
      batchSize,
    });
    this.visibilityManager = new VisibilityManager(this.emitter, this.logger, {
      pauseOnHidden: options.pauseOnHidden ?? true,
    });

    this.wireEvents();

    // Auto-start preserves _isHeld from options (unlike start() which resets it)
    if (options.autoStart ?? true) {
      this.logger.log("init: auto-starting recording");
      this.beginSession();
      this.stateMachine.transition("START");
      this.beginRecording();
    }

    this.logger.log("init: complete");
    this.notify();
  }

  // ── Event wiring (Mediator) ──────────────────────────

  private wireEvents(): void {
    const { emitter, logger } = this;

    // Flush trigger → drain buffer → send via transport
    emitter.on("flush:trigger", ({ reason }) => {
      if (this._isHeld) {
        logger.log("flush: skipped (transport held, reason: %s)", reason);
        return;
      }
      if (!this._sessionId) {
        logger.log("flush: skipped (no session, reason: %s)", reason);
        return;
      }

      const payload = this.eventBuffer.drain(this._sessionId);
      if (!payload) {
        logger.log("flush: skipped (buffer empty, reason: %s)", reason);
        return;
      }

      logger.log("flush: sending (%s, %d events)", reason, payload.events.length);

      if (reason === "unload") {
        this.transport.sendKeepalive(payload);
      } else {
        this.transport
          .send(payload)
          .then((ok) => {
            if (ok) {
              emitter.emit("flush:complete", {
                eventCount: payload.events.length,
                success: true,
              });
            } else {
              // Re-queue failed events for retry on next flush cycle
              this.eventBuffer.prepend(payload.events, payload.sliceMarkers);
              logger.warn("flush: re-queued %d events after failed send", payload.events.length);
              emitter.emit("flush:complete", {
                eventCount: payload.events.length,
                success: false,
              });
            }
          })
          .catch((err) => {
            // Unexpected error — re-queue events and report
            this.eventBuffer.prepend(payload.events, payload.sliceMarkers);
            logger.warn("flush: re-queued %d events after unexpected error", payload.events.length);
            emitter.emit("error", { source: "transport", error: err });
          });
      }
    });

    // Visibility hidden → auto-pause (if recording)
    emitter.on("visibility:hidden", () => {
      if (this.stateMachine.can("AUTO_PAUSE")) {
        logger.log("visibility: auto-pausing recording");
        this.stateMachine.transition("AUTO_PAUSE");
        this.teardownRecording();
        this.notify();
      }
    });

    // Visibility visible → resume (only if auto-paused)
    emitter.on("visibility:visible", () => {
      const { state } = this.stateMachine;
      if (state.status === "paused" && state.pauseReason === "visibility") {
        logger.log("visibility: auto-resuming recording");
        this.stateMachine.transition("RESUME");
        this.beginRecording();
        this.notify();
      }
    });

    // Slice created → add marker to event buffer
    emitter.on("slice:new", ({ marker }) => {
      this.eventBuffer.addSliceMarker(marker);
    });

    // Error handler — log errors that would otherwise be silently swallowed
    emitter.on("error", ({ source, error }) => {
      this.logger.error("error from %s:", source, error);
    });
  }

  // ── Static ──────────────────────────────────────────

  /** Initialize the Dozor recorder. Returns the singleton instance. */
  static init(options: DozorOptions): Dozor {
    if (Dozor.instance) return Dozor.instance;
    Dozor.instance = new Dozor(options);
    return Dozor.instance;
  }

  // ── Public properties ───────────────────────────────

  /** Current session ID (UUID v4), or `null` before `start()`. */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** `true` when actively recording. */
  get isRecording(): boolean {
    return this.stateMachine.status === "recording";
  }

  /** `true` when paused via `pause()`. */
  get isPaused(): boolean {
    return this.stateMachine.status === "paused";
  }

  /** Current lifecycle state. */
  get state(): DozorState {
    return this.stateMachine.status;
  }

  /** `true` when transport is held — events are buffered locally but not sent. */
  get isHeld(): boolean {
    return this._isHeld;
  }

  /** Current user ID, or `null` if not identified. */
  get userId(): string | null {
    return this._userIdentity?.userId ?? null;
  }

  /** Number of events currently buffered in memory (not yet sent). */
  get bufferSize(): number {
    return this.eventBuffer.size;
  }

  // ── Subscribe (external state observers) ───────────

  /**
   * Subscribe to state changes. The listener is called whenever any observable
   * property changes (state, sessionId, isHeld, userId, bufferSize).
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Notify all subscribers that observable state has changed. */
  private notify(): void {
    for (const listener of this.subscribers) {
      listener();
    }
  }

  // ── Lifecycle methods ───────────────────────────────

  /** Start recording. Creates a fresh session each time. Only works from `idle` state. */
  start(): void {
    this.logger.log("start()");
    if (!this.stateMachine.can("START")) {
      this.logger.warn("start(): ignored (current state: %s)", this.stateMachine.status);
      return;
    }
    this._isHeld = false;
    this.beginSession();
    this.stateMachine.transition("START");
    this.beginRecording();
    this.notify();
  }

  /** Pause recording without destroying the session. Keeps the session ID and buffered events alive. */
  pause(): void {
    this.logger.log("pause()");
    if (!this.stateMachine.can("PAUSE")) {
      this.logger.warn("pause(): ignored (current state: %s)", this.stateMachine.status);
      return;
    }
    this.teardownRecording();
    this.stateMachine.transition("PAUSE");
    this.notify();
  }

  /** Resume recording after a `pause()`. Continues the same session. */
  resume(): void {
    this.logger.log("resume()");
    if (!this.stateMachine.can("RESUME")) {
      this.logger.warn("resume(): ignored (current state: %s)", this.stateMachine.status);
      return;
    }
    this.stateMachine.transition("RESUME");
    this.beginRecording();
    this.notify();
  }

  /** Stop recording, flush remaining events, and return to `idle`. Can `start()` a new session afterwards. */
  stop(): void {
    this.logger.log("stop()");
    if (!this.stateMachine.can("STOP")) {
      this.logger.warn("stop(): ignored (current state: %s)", this.stateMachine.status);
      return;
    }
    this._isHeld = false;
    this.teardownRecording();
    this.emitter.emit("flush:trigger", { reason: "manual" });
    this.stateMachine.transition("STOP");
    this.endSession();
    this.notify();
  }

  /** Discard the current session. Drops buffered events and sends a delete request to the server. Returns to `idle`. */
  cancel(): void {
    this.logger.log("cancel()");
    if (!this.stateMachine.can("CANCEL")) {
      this.logger.warn("cancel(): ignored (current state: %s)", this.stateMachine.status);
      return;
    }
    this.teardownRecording();
    const sid = this._sessionId;
    this.stateMachine.transition("CANCEL");
    this.endSession();
    this._isHeld = false;
    if (sid) this.transport.deleteSession(sid);
    this.notify();
  }

  /**
   * Hold the transport — recording continues but events are buffered locally without being sent.
   * Use `release()` to flush the buffer and resume normal sending, or `cancel()` to discard everything.
   * No-op if already held or idle.
   */
  hold(): void {
    this.logger.log("hold()");
    if (this.stateMachine.status === "idle" || this._isHeld) {
      this.logger.warn("hold(): ignored (state: %s, isHeld: %s)", this.stateMachine.status, this._isHeld);
      return;
    }
    this._isHeld = true;
    this.logger.log("hold(): transport held — events buffered locally");
    this.notify();
  }

  /**
   * Release the transport hold — flush buffered events and resume normal sending.
   * Pass `{ discard: true }` to drop held events without sending them.
   * No-op if not held.
   */
  release(options?: { discard?: boolean }): void {
    this.logger.log("release()", options);
    if (!this._isHeld) {
      this.logger.warn("release(): ignored (not held)");
      return;
    }
    this._isHeld = false;

    if (options?.discard) {
      this.logger.log("release(): discarding held events");
      this.eventBuffer.clear();
    } else {
      this.logger.log("release(): flushing held events");
      this.emitter.emit("flush:trigger", { reason: "manual" });
    }
    this.notify();
  }

  /**
   * Identify the current user with an ID and optional traits (email, name, plan, etc.).
   * Call this when the user logs in or when you know who they are.
   * The identity is sent with the next batch and stored on the server.
   */
  identify(userId: string, traits?: UserTraits): void {
    this.logger.log("identify(): userId=%s", userId);
    this._userIdentity = { userId, traits };
    this.eventBuffer.updateIdentity(this._userIdentity);
    this.notify();
  }

  // ── Private — session lifecycle ─────────────────────

  /** Initialize a new session — generate ID, collect metadata, set up page tracking. */
  private beginSession(): void {
    this._sessionId = getSessionId(this.logger);
    this.eventBuffer.setMetadata(collectMetadata(this.logger));
    this._userIdentity = null;
    this.sliceManager.reset();
    this.eventBuffer.addSliceMarker(this.sliceManager.createInitialMarker());
    this.pageTracker = new PageTracker((url, pathname) => {
      this.emitter.emit("flush:trigger", { reason: "navigation" });
      this.sliceManager.startNewSlice("navigation", url, pathname);
    }, this.logger);
    this.logger.log("beginSession: %s", this._sessionId);
  }

  /** Tear down the current session — clear session ID, destroy page tracker. */
  private endSession(): void {
    this.logger.log("endSession: %s", this._sessionId);
    this.pageTracker?.destroy();
    this.pageTracker = null;
    clearSessionId(this.logger);
    this._sessionId = null;
    this.eventBuffer.clear();
    this.sliceManager.reset();
    this._userIdentity = null;
  }

  // ── Private — rrweb lifecycle ───────────────────────

  /** Start rrweb recording, flush scheduler, and idle detector. */
  private beginRecording(): void {
    this.logger.log("beginRecording: starting rrweb + scheduler + idle detector");
    const blockParts: string[] = [`[${this.privacyBlockAttribute}]`];
    if (this.privacyBlockMedia) {
      blockParts.push("img", "video", "audio", "picture", "canvas", "embed", "object");
    }

    const maskAttr = this.privacyMaskAttribute;

    this.stopRecording =
      record({
        emit: (event) => this.onEvent(event),
        plugins: this.plugins,
        maskTextSelector: `[${maskAttr}], [${maskAttr}] *`,
        blockSelector: blockParts.join(","),
        maskAllInputs: this.privacyMaskInputs,
      }) ?? null;

    this.flushScheduler.start();
    this.idleDetector.start();
  }

  /** Stop rrweb, flush scheduler, and idle detector (without flushing). */
  private teardownRecording(): void {
    this.logger.log("teardownRecording: stopping rrweb + scheduler + idle detector");
    if (this.stopRecording) {
      this.stopRecording();
      this.stopRecording = null;
    }
    this.flushScheduler.dispose();
    this.idleDetector.dispose();
  }

  // ── Private — rrweb event callback ──────────────────

  private onEvent(event: eventWithTime): void {
    // Idle resume: when activity returns after idle period, start a new slice
    if (this.idleDetector.isIdle && !this.sliceManager.isSnapshotting) {
      this.sliceManager.startNewSlice("idle");
    }

    this.eventBuffer.push(event, this.sliceManager.index);
  }
}
