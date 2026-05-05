import type { DozorOptions, UserTraits } from "@kharko/dozor";
import { Dozor } from "@kharko/dozor";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DozorContext, NOT_INITIALIZED_SNAPSHOT } from "./context";
import type { DozorContextValue, DozorProviderProps, DozorSnapshot } from "./types";

function readSnapshot(instance: Dozor): DozorSnapshot {
  const state = instance.state;
  return {
    state,
    sessionId: instance.sessionId,
    isRecording: state === "recording",
    isPaused: state === "paused",
    isHeld: instance.isHeld,
    userId: instance.userId,
    bufferSize: instance.bufferSize,
  };
}

function snapshotEqual(a: DozorSnapshot, b: DozorSnapshot): boolean {
  return (
    a.state === b.state &&
    a.sessionId === b.sessionId &&
    a.isHeld === b.isHeld &&
    a.userId === b.userId &&
    a.bufferSize === b.bufferSize
  );
}

function getServerSnapshot(): DozorSnapshot {
  return NOT_INITIALIZED_SNAPSHOT;
}

export function DozorProvider({ options, children }: DozorProviderProps) {
  const instanceRef = useRef<Dozor | null>(null);

  // Bumps after `init()` so `subscribe`'s identity changes and `useSyncExternalStore` re-subscribes
  // to the now-real instance. Without this, the first `subscribe` runs while `instanceRef` is null,
  // returns a no-op, and the snapshot stays frozen on `NOT_INITIALIZED_SNAPSHOT` forever.
  const [initTick, setInitTick] = useState(0);

  // `useSyncExternalStore` compares with `Object.is` — returning the same ref when the snapshot
  // is shallow-equal skips downstream re-renders.
  const cachedSnapshotRef = useRef<DozorSnapshot>(NOT_INITIALIZED_SNAPSHOT);

  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    const instance = instanceRef.current;
    if (!instance) return () => {};
    return instance.subscribe(onStoreChange);
  }, [initTick]);

  const getSnapshot = useCallback((): DozorSnapshot => {
    const instance = instanceRef.current;
    if (!instance) return NOT_INITIALIZED_SNAPSHOT;

    const next = readSnapshot(instance);
    if (snapshotEqual(cachedSnapshotRef.current, next)) {
      return cachedSnapshotRef.current;
    }
    cachedSnapshotRef.current = next;
    return next;
  }, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const initInstance = useCallback((opts: DozorOptions): void => {
    if (instanceRef.current) return;
    instanceRef.current = Dozor.init(opts);
    setInitTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (options && !instanceRef.current) {
      initInstance(options);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally mount-only; option changes after init are no-ops by design

  const actions = useMemo(
    () => ({
      init: (opts: DozorOptions) => initInstance(opts),
      start: () => instanceRef.current?.start(),
      pause: () => instanceRef.current?.pause(),
      resume: () => instanceRef.current?.resume(),
      stop: () => instanceRef.current?.stop(),
      cancel: () => instanceRef.current?.cancel(),
      hold: () => instanceRef.current?.hold(),
      release: (opts?: { discard?: boolean }) => instanceRef.current?.release(opts),
      identify: (userId: string, traits?: UserTraits) => instanceRef.current?.identify(userId, traits),
    }),
    [initInstance],
  );

  const value: DozorContextValue = useMemo(() => ({ ...snapshot, ...actions }), [snapshot, actions]);

  return <DozorContext.Provider value={value}>{children}</DozorContext.Provider>;
}
