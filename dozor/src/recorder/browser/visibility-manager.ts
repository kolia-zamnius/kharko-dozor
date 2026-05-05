import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

export class VisibilityManager {
  private onVisibilityChange: () => void;
  private onBeforeUnload: () => void;

  constructor(emitter: Emitter, logger: Logger, options: { pauseOnHidden: boolean }) {
    const { pauseOnHidden } = options;

    logger.log("VisibilityManager: initialized (pauseOnHidden: %s)", pauseOnHidden);

    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        logger.log("VisibilityManager: tab hidden → keepalive flush");
        // Use `unload` reason so the flush goes through `sendKeepalive`.
        // Regular `send()` would race the tab close and get cancelled, dropping
        // the user's last actions. iOS Safari skips `beforeunload` entirely on
        // tab close, so this is the only reliable hook for "page going away".
        emitter.emit("flush:trigger", { reason: "unload" });
        if (pauseOnHidden) {
          logger.log("VisibilityManager: tab hidden → auto-pausing");
          emitter.emit("visibility:hidden");
        }
      } else if (pauseOnHidden) {
        logger.log("VisibilityManager: tab visible → resuming");
        emitter.emit("visibility:visible");
      }
    };

    this.onBeforeUnload = () => {
      logger.log("VisibilityManager: beforeunload → keepalive flush");
      // `visibilitychange:hidden` already drained the buffer via keepalive on
      // most browsers. Kept as a belt-and-braces hook for the rare path where
      // beforeunload fires without a prior hidden transition.
      emitter.emit("flush:trigger", { reason: "unload" });
    };

    addEventListener("visibilitychange", this.onVisibilityChange);
    addEventListener("beforeunload", this.onBeforeUnload);
  }

  dispose(): void {
    removeEventListener("visibilitychange", this.onVisibilityChange);
    removeEventListener("beforeunload", this.onBeforeUnload);
  }
}
