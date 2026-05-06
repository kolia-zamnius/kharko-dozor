import { createContext } from "react";
import type { DozorContextValue, DozorSnapshot } from "./types.js";

// Returned pre-init and from `getServerSnapshot` during SSR.
export const NOT_INITIALIZED_SNAPSHOT: DozorSnapshot = {
  state: "not_initialized",
  sessionId: null,
  isRecording: false,
  isPaused: false,
  isHeld: false,
  userId: null,
  bufferSize: 0,
};

export const DozorContext = createContext<DozorContextValue | null>(null);
