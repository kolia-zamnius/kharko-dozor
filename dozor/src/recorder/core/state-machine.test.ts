import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger";
import { Emitter, type DozorEventMap, type Handler } from "./emitter";
import { StateMachine, type Transition } from "./state-machine";

function makeMachine() {
  const emitter = new Emitter(createLogger(false));
  const machine = new StateMachine(emitter, createLogger(false));
  return { emitter, machine };
}

describe("StateMachine", () => {
  let machine: StateMachine;
  let emitter: Emitter;

  beforeEach(() => {
    ({ machine, emitter } = makeMachine());
  });

  it("starts in idle status", () => {
    expect(machine.status).toBe("idle");
    expect(machine.state).toEqual({ status: "idle" });
  });

  describe("legal transitions", () => {
    it("idle → recording on START", () => {
      expect(machine.transition("START")).toBe(true);
      expect(machine.state).toEqual({ status: "recording", pauseReason: null });
    });

    it("recording → paused(user) on PAUSE", () => {
      machine.transition("START");
      expect(machine.transition("PAUSE")).toBe(true);
      expect(machine.state).toEqual({ status: "paused", pauseReason: "user" });
    });

    it("recording → paused(visibility) on AUTO_PAUSE", () => {
      machine.transition("START");
      expect(machine.transition("AUTO_PAUSE")).toBe(true);
      expect(machine.state).toEqual({ status: "paused", pauseReason: "visibility" });
    });

    it("paused → recording on RESUME (regardless of pauseReason)", () => {
      machine.transition("START");
      machine.transition("AUTO_PAUSE");
      expect(machine.transition("RESUME")).toBe(true);
      expect(machine.state).toEqual({ status: "recording", pauseReason: null });
    });

    it("recording → idle on STOP", () => {
      machine.transition("START");
      expect(machine.transition("STOP")).toBe(true);
      expect(machine.status).toBe("idle");
    });

    it("paused → idle on STOP", () => {
      machine.transition("START");
      machine.transition("PAUSE");
      expect(machine.transition("STOP")).toBe(true);
      expect(machine.status).toBe("idle");
    });

    it("recording → idle on CANCEL", () => {
      machine.transition("START");
      expect(machine.transition("CANCEL")).toBe(true);
      expect(machine.status).toBe("idle");
    });
  });

  describe("illegal transitions", () => {
    it("PAUSE from idle is rejected", () => {
      expect(machine.can("PAUSE")).toBe(false);
      expect(machine.transition("PAUSE")).toBe(false);
      expect(machine.status).toBe("idle");
    });

    it("RESUME from idle is rejected", () => {
      expect(machine.transition("RESUME")).toBe(false);
      expect(machine.status).toBe("idle");
    });

    it("STOP from idle is rejected", () => {
      expect(machine.transition("STOP")).toBe(false);
    });

    it("START from recording is rejected", () => {
      machine.transition("START");
      expect(machine.transition("START")).toBe(false);
    });

    it("PAUSE from paused is rejected", () => {
      machine.transition("START");
      machine.transition("PAUSE");
      expect(machine.transition("PAUSE")).toBe(false);
    });
  });

  describe("emission", () => {
    it("emits state:change with from/to on a successful transition", () => {
      const handler = vi.fn<Handler<DozorEventMap["state:change"]>>();
      emitter.on("state:change", handler);

      machine.transition("START");

      expect(handler).toHaveBeenCalledWith({ from: "idle", to: "recording" });
    });

    it("does not emit when a transition is rejected", () => {
      const handler = vi.fn<Handler<DozorEventMap["state:change"]>>();
      emitter.on("state:change", handler);

      machine.transition("PAUSE");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("can()", () => {
    it("agrees with transition() outcome", () => {
      const actions: Transition[] = ["START", "PAUSE", "AUTO_PAUSE", "RESUME", "STOP", "CANCEL"];
      for (const action of actions) {
        const expected = machine.can(action);
        const actual = machine.transition(action);
        expect(actual).toBe(expected);
        if (actual) {
          // reset for the next iteration
          ({ machine } = makeMachine());
        }
      }
    });
  });
});
