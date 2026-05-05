import { record } from "rrweb";
import type { SliceMarker, SliceReason } from "../../types";
import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

export class SliceManager {
  private _index = 0;
  private _isSnapshotting = false;
  private emitter: Emitter;
  private logger: Logger;

  constructor(emitter: Emitter, logger: Logger) {
    this.emitter = emitter;
    this.logger = logger;
  }

  get index(): number {
    return this._index;
  }

  get isSnapshotting(): boolean {
    return this._isSnapshotting;
  }

  /** `_isSnapshotting` guard prevents the snapshot's own events from re-entering `onEvent` and triggering another slice. */
  startNewSlice(reason: SliceReason, url?: string, pathname?: string): void {
    this._index++;

    const marker: SliceMarker = {
      index: this._index,
      reason,
      startedAt: Date.now(),
      url: url ?? location.href,
      pathname: pathname ?? location.pathname,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };

    this.logger.log("SliceManager: new slice #%d (reason: %s, url: %s)", this._index, reason, marker.url);

    this.emitter.emit("slice:new", {
      index: this._index,
      reason,
      marker,
    });

    this._isSnapshotting = true;
    record.takeFullSnapshot();
    this._isSnapshotting = false;
  }

  createInitialMarker(): SliceMarker {
    this.logger.log("SliceManager: initial marker created (url: %s)", location.href);
    return {
      index: 0,
      reason: "init",
      startedAt: Date.now(),
      url: location.href,
      pathname: location.pathname,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }

  reset(): void {
    this._index = 0;
    this._isSnapshotting = false;
  }

  dispose(): void {
    this.reset();
  }
}
