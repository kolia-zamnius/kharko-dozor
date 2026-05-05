import type { DozorState, SliceMarker, SliceReason } from "../../types";
import type { Logger } from "../logger";

export interface DozorEventMap {
  "state:change": { from: DozorState; to: DozorState };
  "event:buffered": { bufferSize: number };
  "idle:start": void;
  "slice:new": { index: number; reason: SliceReason; marker: SliceMarker };
  "flush:trigger": { reason: "timer" | "batch" | "unload" | "manual" | "navigation" };
  "flush:complete": { eventCount: number; success: boolean };
  "visibility:hidden": void;
  "visibility:visible": void;
  error: { source: string; error: unknown };
}

export type Handler<T> = T extends void ? () => void : (data: T) => void;

/** Skipped from `logger.log` — `event:buffered` fires on every rrweb event and would flood the console. */
const SILENT_EVENTS = new Set<keyof DozorEventMap>(["event:buffered"]);

export class Emitter {
  private handlers = new Map<keyof DozorEventMap, Set<Function>>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  on<K extends keyof DozorEventMap>(event: K, handler: Handler<DozorEventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof DozorEventMap>(
    event: K,
    ...args: DozorEventMap[K] extends void ? [] : [DozorEventMap[K]]
  ): void {
    if (!SILENT_EVENTS.has(event)) {
      this.logger.log("emit: %s", event, ...args);
    }
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Function)(...args);
    }
  }
}
