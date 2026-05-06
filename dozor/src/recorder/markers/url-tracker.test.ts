import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLogger } from "../logger";
import { UrlTracker, type UrlChangeCallback } from "./url-tracker";

describe("UrlTracker", () => {
  let trackers: UrlTracker[] = [];

  afterEach(() => {
    trackers.forEach((t) => t.destroy());
    trackers = [];
    history.replaceState(null, "", "/");
  });

  function track(callback: Mock<UrlChangeCallback>) {
    const t = new UrlTracker(callback, createLogger(false));
    trackers.push(t);
    return t;
  }

  it("invokes the callback on history.pushState navigation", () => {
    const callback = vi.fn<UrlChangeCallback>();
    track(callback);

    history.pushState(null, "", "/checkout");

    expect(callback).toHaveBeenCalledWith(location.href, "/checkout");
  });

  it("invokes the callback on history.replaceState navigation", () => {
    const callback = vi.fn<UrlChangeCallback>();
    track(callback);

    history.replaceState(null, "", "/dashboard");

    expect(callback).toHaveBeenCalledWith(location.href, "/dashboard");
  });

  it("registers a popstate listener that destroy() removes (regression)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const tracker = track(vi.fn<UrlChangeCallback>());
    expect(addSpy).toHaveBeenCalledWith("popstate", expect.any(Function));

    tracker.destroy();
    trackers = trackers.filter((t) => t !== tracker);

    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("does not invoke the callback when the pathname is unchanged", () => {
    const callback = vi.fn<UrlChangeCallback>();
    track(callback);

    history.pushState(null, "", location.pathname);

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not invoke the callback on hash-only changes", () => {
    const callback = vi.fn<UrlChangeCallback>();
    track(callback);

    history.pushState(null, "", `${location.pathname}#section-1`);
    history.pushState(null, "", `${location.pathname}#section-2`);

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not invoke the callback on query-only changes", () => {
    const callback = vi.fn<UrlChangeCallback>();
    track(callback);

    history.pushState(null, "", `${location.pathname}?utm=email`);
    history.pushState(null, "", `${location.pathname}?utm=email&ref=newsletter`);

    expect(callback).not.toHaveBeenCalled();
  });

});
