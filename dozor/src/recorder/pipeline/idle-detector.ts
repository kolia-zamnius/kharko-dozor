import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

export class IdleDetector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReset = 0;
  private _isIdle = false;
  private threshold: number;
  private emitter: Emitter;
  private logger: Logger;
  private unsubscribe: (() => void) | null = null;

  constructor(emitter: Emitter, logger: Logger, threshold = 30_000) {
    this.emitter = emitter;
    this.logger = logger;
    this.threshold = threshold;
  }

  get isIdle(): boolean {
    return this._isIdle;
  }

  start(): void {
    this.dispose();
    this.logger.log("IdleDetector: started (threshold: %dms)", this.threshold);
    this.unsubscribe = this.emitter.on("event:buffered", () => this.resetTimer());
    this.resetTimer();
  }

  /**
   * Throttled at 1 s — high-frequency rrweb events (mouse moves, mutations)
   * shouldn't churn the timer on every tick. Idle flag clears immediately so
   * any activity reads as "not idle" without waiting for the throttle window.
   */
  private resetTimer(): void {
    this._isIdle = false;

    const now = Date.now();
    if (now - this.lastReset < 1000 && this.timer) return;
    this.lastReset = now;

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this._isIdle = true;
      this.logger.log("IdleDetector: idle detected (%dms of inactivity)", this.threshold);
      this.emitter.emit("idle:start");
    }, this.threshold);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this._isIdle = false;
    this.lastReset = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
