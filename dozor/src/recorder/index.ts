import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import type { RecordPlugin } from "@rrweb/types";
import type { eventWithTime } from "rrweb";
import { record } from "rrweb";
import { DOZOR_MARKER_TAG, type DozorOptions, type DozorState, type UserIdentity, type UserTraits } from "../types";
import { collectMetadata } from "./browser/metadata";
import { clearSessionId, getSessionId } from "./browser/session";
import { VisibilityManager } from "./browser/visibility-manager";
import { Emitter } from "./core/emitter";
import { StateMachine } from "./core/state-machine";
import type { Logger } from "./logger";
import { createLogger } from "./logger";
import { UrlTracker } from "./markers/url-tracker";
import { EventBuffer } from "./pipeline/event-buffer";
import { FlushScheduler } from "./pipeline/flush-scheduler";
import { Transport } from "./transport";

const DEFAULT_FLUSH_INTERVAL = 60_000;
const DEFAULT_BATCH_SIZE = 2_000;
const DEFAULT_FETCH_TIMEOUT = 10_000;

export class Dozor {
  private static instance: Dozor | null = null;

  private emitter: Emitter;
  private stateMachine: StateMachine;
  private eventBuffer: EventBuffer;
  private flushScheduler: FlushScheduler;
  private transport: Transport;
  private urlTracker: UrlTracker | null = null;
  private logger: Logger;

  private _sessionId: string | null = null;
  private _isHeld: boolean;
  private _userIdentity: UserIdentity | null = null;
  private stopRecording: (() => void) | null = null;
  private plugins: RecordPlugin[];
  private privacyMaskAttribute: string;
  private privacyBlockAttribute: string;
  private privacyBlockMedia: boolean;
  private privacyMaskInputs: boolean;

  private subscribers = new Set<() => void>();

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

    this.emitter = new Emitter(this.logger);
    this.stateMachine = new StateMachine(this.emitter, this.logger);
    this.transport = new Transport(endpoint, options.apiKey, this.logger, fetchTimeout);
    this.eventBuffer = new EventBuffer(this.emitter, this.logger);
    this.flushScheduler = new FlushScheduler(this.emitter, this.logger, {
      interval: flushInterval,
      batchSize,
    });
    // Side-effect-only: registers `addEventListener("visibilitychange"/"beforeunload", ...)`.
    // The wrapper isn't held — listeners are kept alive by the global registry, the singleton
    // outlives the page.
    new VisibilityManager(this.emitter, this.logger, {
      pauseOnHidden: options.pauseOnHidden ?? true,
    });

    this.wireEvents();

    // autoStart preserves `_isHeld` from options; manual `start()` resets it to false.
    if (options.autoStart ?? true) {
      this.logger.log("init: auto-starting recording");
      this.beginSession();
      this.stateMachine.transition("START");
      this.beginRecording();
    }

    this.logger.log("init: complete");
    this.notify();
  }

  private wireEvents(): void {
    const { emitter, logger } = this;

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
              this.eventBuffer.prepend(payload.events);
              logger.warn("flush: re-queued %d events after failed send", payload.events.length);
              emitter.emit("flush:complete", {
                eventCount: payload.events.length,
                success: false,
              });
            }
          })
          .catch((err) => {
            this.eventBuffer.prepend(payload.events);
            logger.warn("flush: re-queued %d events after unexpected error", payload.events.length);
            emitter.emit("error", { source: "transport", error: err });
          });
      }
    });

    emitter.on("visibility:hidden", () => {
      if (this.stateMachine.can("AUTO_PAUSE")) {
        logger.log("visibility: auto-pausing recording");
        this.stateMachine.transition("AUTO_PAUSE");
        this.teardownRecording();
        this.notify();
      }
    });

    // Resume only if the pause was visibility-driven — manual pauses survive a tab-show.
    emitter.on("visibility:visible", () => {
      const { state } = this.stateMachine;
      if (state.status === "paused" && state.pauseReason === "visibility") {
        logger.log("visibility: auto-resuming recording");
        this.stateMachine.transition("RESUME");
        this.beginRecording();
        this.notify();
      }
    });

    emitter.on("error", ({ source, error }) => {
      this.logger.error("error from %s:", source, error);
    });
  }

  /** Singleton — repeat calls return the same instance, ignoring the new options. */
  static init(options: DozorOptions): Dozor {
    if (Dozor.instance) return Dozor.instance;
    Dozor.instance = new Dozor(options);
    return Dozor.instance;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get isRecording(): boolean {
    return this.stateMachine.status === "recording";
  }

  get isPaused(): boolean {
    return this.stateMachine.status === "paused";
  }

  get state(): DozorState {
    return this.stateMachine.status;
  }

  get isHeld(): boolean {
    return this._isHeld;
  }

  get userId(): string | null {
    return this._userIdentity?.userId ?? null;
  }

  get bufferSize(): number {
    return this.eventBuffer.size;
  }

  /** Fires on any observable change (state / sessionId / isHeld / userId / bufferSize). */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener();
    }
  }

  /** Fresh session each call. Only valid from `idle`. */
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

  /** Keeps session ID + buffered events; `resume()` continues. */
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

  /** Flushes buffer; subsequent `start()` creates a fresh session. */
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

  /** Drops buffered events + posts cancel to server. Use to abandon a session. */
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

  /** Recording continues, events buffered locally until `release()` or `cancel()`. No-op when idle / already held. */
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

  /** Flush held events; `{ discard: true }` drops them instead. No-op if not held. */
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

  // Pre-start identity rides on the next batch's metadata; in-recording change additionally lands as a timestamped marker in the event stream.
  identify(userId: string, traits?: UserTraits): void {
    this.logger.log("identify(): userId=%s", userId);
    this._userIdentity = { userId, traits };
    this.eventBuffer.updateIdentity(this._userIdentity);
    if (this.stopRecording) {
      record.addCustomEvent(DOZOR_MARKER_TAG.identity, { userId, traits });
    }
    this.notify();
  }

  private beginSession(): void {
    this._sessionId = getSessionId(this.logger);
    const metadata = collectMetadata(this.logger);
    // identity set BEFORE start() (autoStart:false flow) is the only case `_userIdentity` is non-null here.
    // endSession() owns the cross-session reset; this hop just propagates the pre-set identity into fresh metadata.
    if (this._userIdentity) {
      metadata.userIdentity = this._userIdentity;
    }
    this.eventBuffer.setMetadata(metadata);
    this.urlTracker = new UrlTracker((url, pathname) => {
      record.addCustomEvent(DOZOR_MARKER_TAG.url, { url, pathname });
      record.takeFullSnapshot();
      this.emitter.emit("flush:trigger", { reason: "navigation" });
    }, this.logger);
    this.logger.log("beginSession: %s", this._sessionId);
  }

  private endSession(): void {
    this.logger.log("endSession: %s", this._sessionId);
    this.urlTracker?.destroy();
    this.urlTracker = null;
    clearSessionId(this.logger);
    this._sessionId = null;
    this.eventBuffer.clear();
    this._userIdentity = null;
  }

  private beginRecording(): void {
    this.logger.log("beginRecording: starting rrweb + scheduler");
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

    // Eager bootstrap flush — at this point rrweb's `record()` has emitted
    // Meta + FullSnapshot synchronously into the buffer (when document.readyState
    // is "complete", which any time the user clicks Start it is). Shipping that
    // pair via the regular `send()` path (gzip + retry) gets the replayer-seed
    // events into the database within ~1s, so a fast tab close before the
    // 60s timer ticks can never strand them in the buffer.
    this.emitter.emit("flush:trigger", { reason: "bootstrap" });
  }

  private teardownRecording(): void {
    this.logger.log("teardownRecording: stopping rrweb + scheduler");
    if (this.stopRecording) {
      this.stopRecording();
      this.stopRecording = null;
    }
    this.flushScheduler.dispose();
  }

  private onEvent(event: eventWithTime): void {
    this.eventBuffer.push(event);
  }
}
