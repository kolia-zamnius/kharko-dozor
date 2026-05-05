import type { Logger } from "../logger";

export type PageChangeCallback = (url: string, pathname: string) => void;

/**
 * Monkey-patches `pushState` / `replaceState` + listens to `popstate`. Hash-only and
 * query-only changes are ignored — `#section` jumps and `?utm=` rewrites aren't real
 * navigations and would otherwise produce spurious slice markers.
 */
export class PageTracker {
  private callback: PageChangeCallback;
  private lastPathname: string;
  private origPushState: typeof history.pushState;
  private origReplaceState: typeof history.replaceState;
  private logger: Logger;

  constructor(callback: PageChangeCallback, logger: Logger) {
    this.callback = callback;
    this.logger = logger;
    this.lastPathname = location.pathname;

    this.logger.log("PageTracker: initialized (pathname: %s)", this.lastPathname);

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
    this.logger.log("PageTracker: destroyed");
  }

  private onPopState = (): void => {
    this.check();
  };

  private check(): void {
    const pathname = location.pathname;
    if (pathname === this.lastPathname) return;
    this.logger.log("PageTracker: navigation detected (%s → %s)", this.lastPathname, pathname);
    this.lastPathname = pathname;
    this.callback(location.href, pathname);
  }
}
