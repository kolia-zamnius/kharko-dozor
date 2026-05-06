import type { DozorState } from "../../types";
import type { Logger } from "../logger";
import type { Emitter } from "./emitter";

export type RecorderState =
  | { status: "idle" }
  | { status: "recording"; pauseReason: null }
  | { status: "paused"; pauseReason: "user" | "visibility" };

export type Transition = "START" | "PAUSE" | "AUTO_PAUSE" | "RESUME" | "STOP" | "CANCEL";

export class StateMachine {
  private _state: RecorderState = { status: "idle" };
  private emitter: Emitter;
  private logger: Logger;

  constructor(emitter: Emitter, logger: Logger) {
    this.emitter = emitter;
    this.logger = logger;
  }

  get state(): RecorderState {
    return this._state;
  }

  get status(): DozorState {
    return this._state.status;
  }

  can(action: Transition): boolean {
    return this.resolve(action) !== null;
  }

  // Emits `state:change` on success.
  transition(action: Transition): boolean {
    const next = this.resolve(action);
    if (!next) {
      this.logger.warn("StateMachine: transition %s rejected (current: %s)", action, this._state.status);
      return false;
    }

    const from = this._state.status;
    this._state = next;
    this.logger.log("StateMachine: %s → %s (action: %s)", from, next.status, action);
    this.emitter.emit("state:change", { from, to: next.status });
    return true;
  }

  //  From \ Action   START        PAUSE          AUTO_PAUSE         RESUME      STOP   CANCEL
  //  idle            recording    –              –                  –           –      –
  //  recording       –            paused(user)   paused(visibility) –           idle   idle
  //  paused(user)    –            –              –                  recording   idle   idle
  //  paused(vis.)    –            –              –                  recording   idle   idle
  private resolve(action: Transition): RecorderState | null {
    const { status } = this._state;

    switch (action) {
      case "START":
        return status === "idle" ? { status: "recording", pauseReason: null } : null;

      case "PAUSE":
        return status === "recording" ? { status: "paused", pauseReason: "user" } : null;

      case "AUTO_PAUSE":
        return status === "recording" ? { status: "paused", pauseReason: "visibility" } : null;

      case "RESUME":
        return status === "paused" ? { status: "recording", pauseReason: null } : null;

      case "STOP":
      case "CANCEL":
        return status === "recording" || status === "paused" ? { status: "idle" } : null;
    }
  }
}
