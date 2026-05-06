import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger";
import { Emitter, type DozorEventMap, type Handler } from "./emitter";

describe("Emitter", () => {
  it("delivers an emitted payload to a registered handler", () => {
    const emitter = new Emitter(createLogger(false));
    const handler = vi.fn<Handler<DozorEventMap["flush:complete"]>>();

    emitter.on("flush:complete", handler);
    emitter.emit("flush:complete", { eventCount: 5, success: true });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ eventCount: 5, success: true });
  });

  it("returns an unsubscribe function from on()", () => {
    const emitter = new Emitter(createLogger(false));
    const handler = vi.fn<Handler<DozorEventMap["visibility:hidden"]>>();

    const unsubscribe = emitter.on("visibility:hidden", handler);
    unsubscribe();
    emitter.emit("visibility:hidden");

    expect(handler).not.toHaveBeenCalled();
  });
});
