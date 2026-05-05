import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { FlushScheduler } from "./flush-scheduler";

type FlushTriggerHandler = Handler<DozorEventMap["flush:trigger"]>;

describe("FlushScheduler", () => {
  let emitter: Emitter;
  let scheduler: FlushScheduler;
  let triggerHandler: Mock<FlushTriggerHandler>;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new Emitter(createLogger(false));
    triggerHandler = vi.fn<FlushTriggerHandler>();
    emitter.on("flush:trigger", triggerHandler);
  });

  afterEach(() => {
    scheduler?.dispose();
    vi.useRealTimers();
  });

  it("emits flush:trigger with reason 'timer' on every interval tick", () => {
    scheduler = new FlushScheduler(emitter, createLogger(false), { interval: 1000, batchSize: 100 });
    scheduler.start();

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(triggerHandler).toHaveBeenCalledTimes(2);
    expect(triggerHandler).toHaveBeenNthCalledWith(1, { reason: "timer" });
    expect(triggerHandler).toHaveBeenNthCalledWith(2, { reason: "timer" });
  });

  it("emits flush:trigger with reason 'batch' once the buffer reaches batchSize", () => {
    scheduler = new FlushScheduler(emitter, createLogger(false), { interval: 60_000, batchSize: 3 });
    scheduler.start();

    emitter.emit("event:buffered", { bufferSize: 1 });
    emitter.emit("event:buffered", { bufferSize: 2 });
    expect(triggerHandler).not.toHaveBeenCalled();

    emitter.emit("event:buffered", { bufferSize: 3 });
    expect(triggerHandler).toHaveBeenCalledExactlyOnceWith({ reason: "batch" });
  });

  it("stop() halts the timer and unsubscribes the batch listener", () => {
    scheduler = new FlushScheduler(emitter, createLogger(false), { interval: 1000, batchSize: 5 });
    scheduler.start();
    scheduler.stop();

    vi.advanceTimersByTime(5000);
    emitter.emit("event:buffered", { bufferSize: 100 });

    expect(triggerHandler).not.toHaveBeenCalled();
  });

  it("starting after stop reattaches both timer and batch listener", () => {
    scheduler = new FlushScheduler(emitter, createLogger(false), { interval: 1000, batchSize: 2 });
    scheduler.start();
    scheduler.stop();
    scheduler.start();

    vi.advanceTimersByTime(1000);
    emitter.emit("event:buffered", { bufferSize: 2 });

    expect(triggerHandler).toHaveBeenCalledTimes(2);
  });

  it("dispose() is equivalent to stop() for runtime effects", () => {
    scheduler = new FlushScheduler(emitter, createLogger(false), { interval: 500, batchSize: 5 });
    scheduler.start();
    scheduler.dispose();

    vi.advanceTimersByTime(2000);
    emitter.emit("event:buffered", { bufferSize: 999 });

    expect(triggerHandler).not.toHaveBeenCalled();
  });
});
