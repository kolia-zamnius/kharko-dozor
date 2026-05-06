import type { Logger } from "../logger";

export type UrlChangeCallback = (url: string, pathname: string) => void;

// Hash-only and query-only changes don't fire the callback — `#section` jumps and `?utm=` rewrites aren't real navigations.
export class UrlTracker {
  private callback: UrlChangeCallback;
  private lastPathname: string;
  private origPushState: typeof history.pushState;
  private origReplaceState: typeof history.replaceState;
  private logger: Logger;

  constructor(callback: UrlChangeCallback, logger: Logger) {
    this.callback = callback;
    this.logger = logger;
    this.lastPathname = location.pathname;

    this.logger.log("UrlTracker: initialized (pathname: %s)", this.lastPathname);

    this.origPushState = history.pushState.bind(history);
    this.origReplaceState = history.replaceState.bind(history);

    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      this.origPushState(...args);
      this.check();
    };

    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      this.origReplaceState(...args);
      this.check();
    };

    addEventListener("popstate", this.onPopState);
  }

  destroy(): void {
    history.pushState = this.origPushState;
    history.replaceState = this.origReplaceState;
    removeEventListener("popstate", this.onPopState);
    this.logger.log("UrlTracker: destroyed");
  }

  private onPopState = (): void => {
    this.check();
  };

  private check(): void {
    const pathname = location.pathname;
    if (pathname === this.lastPathname) return;
    this.logger.log("UrlTracker: navigation detected (%s → %s)", this.lastPathname, pathname);
    this.lastPathname = pathname;
    this.callback(location.href, pathname);
  }
}
