import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

export class FlushScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private emitter: Emitter;
  private logger: Logger;
  private interval: number;
  private batchSize: number;
  private unsubscribe: (() => void) | null = null;

  constructor(emitter: Emitter, logger: Logger, options: { interval: number; batchSize: number }) {
    this.emitter = emitter;
    this.logger = logger;
    this.interval = options.interval;
    this.batchSize = options.batchSize;
  }

  start(): void {
    this.stop();
    this.logger.log("FlushScheduler: started (interval: %dms, batchSize: %d)", this.interval, this.batchSize);

    this.unsubscribe = this.emitter.on("event:buffered", ({ bufferSize }) => {
      if (bufferSize >= this.batchSize) {
        this.logger.log("FlushScheduler: batch threshold reached (%d >= %d)", bufferSize, this.batchSize);
        this.emitter.emit("flush:trigger", { reason: "batch" });
      }
    });

    this.timer = setInterval(() => {
      this.logger.log("FlushScheduler: timer flush");
      this.emitter.emit("flush:trigger", { reason: "timer" });
    }, this.interval);
  }

  /** Stops timer + listener; caller drains explicitly if a final flush is needed. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  dispose(): void {
    this.stop();
    this.logger.log("FlushScheduler: disposed");
  }
}
