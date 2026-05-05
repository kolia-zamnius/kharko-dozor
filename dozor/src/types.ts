import type { eventWithTime } from "rrweb";

export type DozorState = "idle" | "recording" | "paused";

export type UserTraits = Record<string, unknown>;

export interface DozorOptions {
  /** Public key, format `dp_*`. */
  apiKey: string;
  /**
   * Full URL or same-origin relative path. Relative paths are the ad-blocker /
   * CORS workaround: SDK posts to `/api/monitor` (or similar), the consumer's
   * server proxies to the real ingest endpoint.
   */
  endpoint: string;
  /** ms. Default 60000. */
  flushInterval?: number;
  /** Max events before auto-flush. Default 2000. */
  batchSize?: number;
  /** Default true. */
  autoStart?: boolean;
  /** Buffer locally without sending until `release()`. Default false. */
  hold?: boolean;
  /** Default true. */
  pauseOnHidden?: boolean;
  /** Default true. */
  recordConsole?: boolean;
  /** Text under elements with this attr replaced with asterisks. Default `data-dozor-mask`. */
  privacyMaskAttribute?: string;
  /** Elements with this attr replaced by same-size placeholder (no children recorded). Default `data-dozor-block`. */
  privacyBlockAttribute?: string;
  /** Replace all `img`/`video`/`audio`/`picture`/`canvas`/`embed`/`object` with placeholders — for sites that block cross-origin media at replay time. Default false. */
  privacyBlockMedia?: boolean;
  /** Mask all input/textarea/select values. Default true. */
  privacyMaskInputs?: boolean;
  /** ms. Applies to `send()`; keepalive sends are fire-and-forget. Default 10000. */
  fetchTimeout?: number;
  /** Verbose console logging via `[dozor]` prefix. Default false. */
  debug?: boolean;
}

export interface UserIdentity {
  userId: string;
  traits?: UserTraits;
}

/** Collected once at session start, sent with the first batch. */
export interface SessionMetadata {
  url: string;
  referrer: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  language: string;
  userIdentity?: UserIdentity;
}

export type SliceReason = "init" | "idle" | "navigation";

/** Independently replayable segment — viewport + URL captured at start so the dashboard can render each slice without preceding context. */
export interface SliceMarker {
  index: number;
  reason: SliceReason;
  startedAt: number;
  url: string;
  pathname: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface IngestPayload {
  sessionId: string;
  events: eventWithTime[];
  /** First batch only. */
  metadata?: SessionMetadata;
  sliceMarkers?: SliceMarker[];
}
