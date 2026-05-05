import { useContext } from "react";
import { DozorContext } from "./context";
import type { DozorContextValue } from "./types";

export function useDozor(): DozorContextValue {
  const ctx = useContext(DozorContext);
  if (!ctx) {
    throw new Error("useDozor must be used within a <DozorProvider>");
  }
  return ctx;
}
