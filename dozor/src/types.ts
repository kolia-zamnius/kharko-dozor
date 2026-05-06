import type { eventWithTime } from "rrweb";

export type DozorState = "idle" | "recording" | "paused";

export type UserTraits = Record<string, unknown>;

export interface DozorOptions {
  apiKey: string;
  // Relative paths are the ad-blocker / CORS workaround — consumer proxies `/api/monitor` (or similar) to the real ingest endpoint.
  endpoint: string;
  flushInterval?: number;
  batchSize?: number;
  autoStart?: boolean;
  hold?: boolean;
  pauseOnHidden?: boolean;
  recordConsole?: boolean;
  privacyMaskAttribute?: string;
  privacyBlockAttribute?: string;
  // Replaces all media elements with placeholders — for replays where cross-origin media would 403 at playback time.
  privacyBlockMedia?: boolean;
  privacyMaskInputs?: boolean;
  // Applies to retried `send()` only — keepalive on unload is fire-and-forget.
  fetchTimeout?: number;
  debug?: boolean;
}

export interface UserIdentity {
  userId: string;
  traits?: UserTraits;
}

export interface SessionMetadata {
  url: string;
  referrer: string;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  language: string;
  userIdentity?: UserIdentity;
}

export interface IngestPayload {
  sessionId: string;
  events: eventWithTime[];
  // Ships on first batch, then re-ships after `identify()` to deliver the updated `userIdentity`.
  metadata?: SessionMetadata;
}

// Tags for in-stream timeline markers — emitted as rrweb custom events (type=5).
// Server / dashboard reads `event.data.tag` to dispatch to the right marker handler.
export const DOZOR_MARKER_TAG = {
  url: "dozor:url",
  identity: "dozor:identity",
} as const;

export type DozorMarkerTag = (typeof DOZOR_MARKER_TAG)[keyof typeof DOZOR_MARKER_TAG];

export interface DozorUrlMarker {
  url: string;
  pathname: string;
}
