import type { DozorOptions, DozorState, UserTraits } from "@kharko/dozor";

/** Adds `"not_initialized"` for the pre-init / SSR snapshot — core `DozorState` is `idle | recording | paused`. */
export type DozorContextState = DozorState | "not_initialized";

export interface DozorSnapshot {
  state: DozorContextState;
  sessionId: string | null;
  isRecording: boolean;
  isPaused: boolean;
  isHeld: boolean;
  userId: string | null;
  bufferSize: number;
}

export interface DozorActions {
  /** No-op if already initialized — `Dozor.init()` itself is a singleton. */
  init: (options: DozorOptions) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  cancel: () => void;
  hold: () => void;
  /** `{ discard: true }` drops held events instead of flushing them. */
  release: (options?: { discard?: boolean }) => void;
  identify: (userId: string, traits?: UserTraits) => void;
}

export type DozorContextValue = DozorSnapshot & DozorActions;

export interface DozorProviderProps {
  /** Provided → auto-init on mount. Omit → consumer calls `actions.init(options)` manually. */
  options?: DozorOptions;
  children: React.ReactNode;
}
