import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLogger } from "../logger";
import { PageTracker, type PageChangeCallback } from "./page-tracker";

describe("PageTracker", () => {
  let trackers: PageTracker[] = [];

  afterEach(() => {
    trackers.forEach((t) => t.destroy());
    trackers = [];
    history.replaceState(null, "", "/");
  });

  function track(callback: Mock<PageChangeCallback>) {
    const t = new PageTracker(callback, createLogger(false));
    trackers.push(t);
    return t;
  }

  it("invokes the callback on history.pushState navigation", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.pushState(null, "", "/checkout");

    expect(callback).toHaveBeenCalledWith(location.href, "/checkout");
  });

  it("invokes the callback on history.replaceState navigation", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.replaceState(null, "", "/dashboard");

    expect(callback).toHaveBeenCalledWith(location.href, "/dashboard");
  });

  it("registers a popstate listener that destroy() removes (regression)", () => {
    // We can't change location.href in jsdom (Web IDL binding, non-configurable),
    // so we verify popstate handling indirectly: addEventListener was called
    // for "popstate" at construction, and destroy removes it.
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const tracker = track(vi.fn<PageChangeCallback>());
    expect(addSpy).toHaveBeenCalledWith("popstate", expect.any(Function));

    tracker.destroy();
    trackers = trackers.filter((t) => t !== tracker);

    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });

  it("does not invoke the callback when the pathname is unchanged", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.pushState(null, "", location.pathname);

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not invoke the callback on hash-only changes", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.pushState(null, "", `${location.pathname}#section-1`);
    history.pushState(null, "", `${location.pathname}#section-2`);

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not invoke the callback on query-only changes", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.pushState(null, "", `${location.pathname}?utm=email`);
    history.pushState(null, "", `${location.pathname}?utm=email&ref=newsletter`);

    expect(callback).not.toHaveBeenCalled();
  });

  it("invokes the callback on pathname change even when query/hash also change", () => {
    const callback = vi.fn<PageChangeCallback>();
    track(callback);

    history.pushState(null, "", "/checkout?step=1#top");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(location.href, "/checkout");
  });

  it("destroy() restores original history methods and removes popstate listener", () => {
    const callback = vi.fn<PageChangeCallback>();
    const tracker = track(callback);
    const patchedPushState = history.pushState;

    tracker.destroy();
    trackers = trackers.filter((t) => t !== tracker);

    expect(history.pushState).not.toBe(patchedPushState);

    history.pushState(null, "", "/after-destroy");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(callback).not.toHaveBeenCalled();
  });
});
