import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { IdleDetector } from "./idle-detector";

describe("IdleDetector", () => {
  let emitter: Emitter;
  let detector: IdleDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new Emitter(createLogger(false));
  });

  afterEach(() => {
    detector?.dispose();
    vi.useRealTimers();
  });

  it("starts not idle and reports idle once threshold elapses without activity", () => {
    detector = new IdleDetector(emitter, createLogger(false), 5_000);
    const handler = vi.fn<Handler<DozorEventMap["idle:start"]>>();
    emitter.on("idle:start", handler);

    detector.start();
    expect(detector.isIdle).toBe(false);

    vi.advanceTimersByTime(5_000);

    expect(detector.isIdle).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("resets the timer when activity arrives before the threshold", () => {
    detector = new IdleDetector(emitter, createLogger(false), 5_000);
    const handler = vi.fn<Handler<DozorEventMap["idle:start"]>>();
    emitter.on("idle:start", handler);

    detector.start();
    vi.advanceTimersByTime(4_000);
    // activity > 1s after the initial reset → timer is rescheduled
    emitter.emit("event:buffered", { bufferSize: 1 });
    vi.advanceTimersByTime(4_000);

    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("clears isIdle immediately on any activity, even when timer reset is throttled", () => {
    detector = new IdleDetector(emitter, createLogger(false), 5_000);
    detector.start();
    vi.advanceTimersByTime(5_000);
    expect(detector.isIdle).toBe(true);

    // Activity within 1s of the last reset is throttled (no setTimeout churn),
    // but the idle flag must clear immediately.
    emitter.emit("event:buffered", { bufferSize: 1 });
    expect(detector.isIdle).toBe(false);
  });

  it("dispose() unsubscribes from activity and cancels the pending timer", () => {
    detector = new IdleDetector(emitter, createLogger(false), 5_000);
    const handler = vi.fn<Handler<DozorEventMap["idle:start"]>>();
    emitter.on("idle:start", handler);

    detector.start();
    detector.dispose();

    vi.advanceTimersByTime(10_000);
    emitter.emit("event:buffered", { bufferSize: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(detector.isIdle).toBe(false);
  });
});
