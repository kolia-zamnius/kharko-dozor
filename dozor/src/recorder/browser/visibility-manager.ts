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
        // `unload` reason routes flush through `sendKeepalive`. Regular `send()` would race
        // tab-close and get cancelled, dropping the user's last actions. iOS Safari skips
        // `beforeunload` entirely on tab close — `visibilitychange:hidden` is the only
        // reliable "page going away" hook there.
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
      // Belt-and-braces: `visibilitychange:hidden` already drained on most browsers, this
      // catches the rare path where `beforeunload` fires without a prior hidden transition.
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
