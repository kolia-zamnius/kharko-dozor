import { beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { SliceManager } from "./slice-manager";

vi.mock("rrweb", () => ({
  record: { takeFullSnapshot: vi.fn() },
}));

describe("SliceManager", () => {
  let emitter: Emitter;
  let manager: SliceManager;

  beforeEach(() => {
    emitter = new Emitter(createLogger(false));
    manager = new SliceManager(emitter, createLogger(false));
  });

  it("starts at index 0 and not snapshotting", () => {
    expect(manager.index).toBe(0);
    expect(manager.isSnapshotting).toBe(false);
  });

  it("createInitialMarker returns an index-0 marker with reason 'init'", () => {
    const marker = manager.createInitialMarker();
    expect(marker.index).toBe(0);
    expect(marker.reason).toBe("init");
    expect(marker.url).toBe(location.href);
    expect(marker.pathname).toBe(location.pathname);
  });

  it("startNewSlice increments index and emits slice:new", () => {
    const handler = vi.fn<Handler<DozorEventMap["slice:new"]>>();
    emitter.on("slice:new", handler);

    manager.startNewSlice("idle");

    expect(manager.index).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
    const arg = handler.mock.calls[0]?.[0];
    expect(arg.index).toBe(1);
    expect(arg.reason).toBe("idle");
    expect(arg.marker.index).toBe(1);
  });

  it("uses provided url/pathname when given (used by PageTracker)", () => {
    const handler = vi.fn<Handler<DozorEventMap["slice:new"]>>();
    emitter.on("slice:new", handler);

    manager.startNewSlice("navigation", "https://app.example.com/checkout?x=1", "/checkout");

    const marker = handler.mock.calls[0]?.[0].marker;
    expect(marker.url).toBe("https://app.example.com/checkout?x=1");
    expect(marker.pathname).toBe("/checkout");
  });

  it("isSnapshotting is false after startNewSlice returns", () => {
    manager.startNewSlice("navigation");
    expect(manager.isSnapshotting).toBe(false);
  });

  it("reset returns index to 0 and clears isSnapshotting", () => {
    manager.startNewSlice("idle");
    manager.startNewSlice("navigation");
    expect(manager.index).toBe(2);

    manager.reset();
    expect(manager.index).toBe(0);
    expect(manager.isSnapshotting).toBe(false);
  });
});
