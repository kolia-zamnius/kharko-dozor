import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { VisibilityManager } from "./visibility-manager";

type FlushTriggerHandler = Handler<DozorEventMap["flush:trigger"]>;
type VisibilityHiddenHandler = Handler<DozorEventMap["visibility:hidden"]>;
type VisibilityVisibleHandler = Handler<DozorEventMap["visibility:visible"]>;

function setVisibility(state: "hidden" | "visible"): void {
  // jsdom's `Document.prototype.visibilityState` is a Web IDL binding that
  // can't be spied on, but defining a data property on the instance shadows
  // the prototype getter for reads.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    writable: true,
    value: state,
  });
}

function fireVisibilityChange(): void {
  // Real browsers fire visibilitychange on document with bubbles=true; the
  // SDK listens at the window level via the global `addEventListener`, so
  // bubbling is required for the listener to receive the event.
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

describe("VisibilityManager", () => {
  let emitter: Emitter;
  let manager: VisibilityManager;
  let flushHandler: Mock<FlushTriggerHandler>;
  let visibilityHidden: Mock<VisibilityHiddenHandler>;
  let visibilityVisible: Mock<VisibilityVisibleHandler>;

  beforeEach(() => {
    emitter = new Emitter(createLogger(false));
    flushHandler = vi.fn<FlushTriggerHandler>();
    visibilityHidden = vi.fn<VisibilityHiddenHandler>();
    visibilityVisible = vi.fn<VisibilityVisibleHandler>();
    emitter.on("flush:trigger", flushHandler);
    emitter.on("visibility:hidden", visibilityHidden);
    emitter.on("visibility:visible", visibilityVisible);
  });

  afterEach(() => {
    manager?.dispose();
    // Drop the instance-level shadow so the next test starts from jsdom default.
    delete (document as { visibilityState?: unknown }).visibilityState;
    vi.restoreAllMocks();
  });

  describe("with pauseOnHidden: true", () => {
    beforeEach(() => {
      manager = new VisibilityManager(emitter, createLogger(false), { pauseOnHidden: true });
    });

    it("on hidden: emits keepalive flush and visibility:hidden", () => {
      setVisibility("hidden");
      fireVisibilityChange();

      expect(flushHandler).toHaveBeenCalledWith({ reason: "unload" });
      expect(visibilityHidden).toHaveBeenCalledOnce();
      expect(visibilityVisible).not.toHaveBeenCalled();
    });

    it("on visible: emits visibility:visible only (no flush)", () => {
      setVisibility("visible");
      fireVisibilityChange();

      expect(visibilityVisible).toHaveBeenCalledOnce();
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  describe("with pauseOnHidden: false", () => {
    beforeEach(() => {
      manager = new VisibilityManager(emitter, createLogger(false), { pauseOnHidden: false });
    });

    it("on hidden: still flushes (keepalive) but does not emit visibility:hidden", () => {
      setVisibility("hidden");
      fireVisibilityChange();

      expect(flushHandler).toHaveBeenCalledWith({ reason: "unload" });
      expect(visibilityHidden).not.toHaveBeenCalled();
    });

    it("on visible: emits nothing (no auto-resume to undo a manual pause)", () => {
      setVisibility("visible");
      fireVisibilityChange();

      expect(visibilityVisible).not.toHaveBeenCalled();
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  describe("beforeunload", () => {
    beforeEach(() => {
      manager = new VisibilityManager(emitter, createLogger(false), { pauseOnHidden: true });
    });

    it("triggers a keepalive flush", () => {
      window.dispatchEvent(new Event("beforeunload"));

      expect(flushHandler).toHaveBeenCalledWith({ reason: "unload" });
    });
  });

  describe("dispose", () => {
    it("removes both visibility and beforeunload listeners", () => {
      manager = new VisibilityManager(emitter, createLogger(false), { pauseOnHidden: true });
      manager.dispose();

      setVisibility("hidden");
      fireVisibilityChange();
      window.dispatchEvent(new Event("beforeunload"));

      expect(flushHandler).not.toHaveBeenCalled();
      expect(visibilityHidden).not.toHaveBeenCalled();
    });
  });
});
