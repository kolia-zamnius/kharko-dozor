import { gzipSync } from "fflate";
import type { eventWithTime } from "rrweb";
import type { IngestPayload } from "../types";
import type { Logger } from "./logger";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const COMPRESSION_THRESHOLD = 1_024;
/** Stay safely under the browser's 64 KB keepalive body limit. */
const KEEPALIVE_BYTE_LIMIT = 60 * 1024;
/**
 * Conservative raw-JSON ceiling used when even the gzipped keepalive payload
 * overshoots the byte cap. Empirically rrweb event streams compress 4–10×, so
 * 4× the keepalive cap is a safe headroom — trim to this raw size, re-gzip,
 * and the result virtually always fits.
 */
const KEEPALIVE_RAW_CEILING = KEEPALIVE_BYTE_LIMIT * 4;
const TEXT_ENCODER = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

async function gzipCompress(input: string): Promise<Blob> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

const supportsCompression = typeof CompressionStream !== "undefined";

export class Transport {
  private endpoint: string;
  private apiKey: string;
  private logger: Logger;
  private timeout: number;

  constructor(endpoint: string, apiKey: string, logger: Logger, timeout: number) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.logger = logger;
    this.timeout = timeout;
    this.logger.log("Transport created", { endpoint, timeout: this.timeout });
  }

  async send(payload: IngestPayload): Promise<boolean> {
    const json = JSON.stringify(payload);

    let body: BodyInit;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Dozor-Public-Key": this.apiKey,
    };

    if (supportsCompression && json.length > COMPRESSION_THRESHOLD) {
      body = await gzipCompress(json);
      headers["Content-Encoding"] = "gzip";
      this.logger.log("send: compressed %d bytes → gzip", json.length);
    } else {
      body = json;
      this.logger.log("send: %d bytes (uncompressed)", json.length);
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          this.logger.log("send: success (attempt %d, %d events)", attempt + 1, payload.events.length);
          return true;
        }

        // 4xx is the server saying "your payload is wrong" — retrying won't fix it.
        if (res.status >= 400 && res.status < 500) {
          this.logger.warn("send: client error %d — not retrying", res.status);
          return false;
        }

        this.logger.warn("send: server error %d (attempt %d/%d)", res.status, attempt + 1, MAX_RETRIES);
      } catch {
        clearTimeout(timeoutId);
        this.logger.warn("send: network error or timeout (attempt %d/%d)", attempt + 1, MAX_RETRIES);
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        this.logger.log("send: retrying in %dms", delay);
        await sleep(delay);
      }
    }

    this.logger.warn("send: failed after %d retries", MAX_RETRIES);
    return false;
  }

  /** Cancel URL is derived from the ingest URL by path replacement — works for canonical `/api/ingest` routes. */
  deleteSession(sessionId: string): void {
    this.logger.log("deleteSession: %s", sessionId);
    const cancelUrl = this.endpoint.replace("/ingest", "/sessions/cancel");
    try {
      fetch(cancelUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dozor-Public-Key": this.apiKey,
        },
        body: JSON.stringify({ sessionId }),
      }).catch((err) => {
        this.logger.warn("deleteSession: failed", err);
      });
    } catch {
      // fire-and-forget
    }
  }

  // Sync-gzip via `fflate` so the body fits the browser's 64KB keepalive cap even
  // when the buffered FullSnapshot of a CSS-heavy page (Tailwind v4, etc.) would
  // run uncompressed at 200–400KB. CompressionStream isn't an option here — its
  // async drain can't complete inside `beforeunload` / `visibilitychange:hidden`.
  //
  // Trim policy when even the gzipped payload overshoots the cap: iteratively
  // halve the raw-JSON budget while preserving every Meta(4) + FullSnapshot(2)
  // bootstrap event and dropping the oldest incrementals. Stops when trim makes
  // no further progress (only bootstraps left).
  sendKeepalive(payload: IngestPayload): void {
    if (payload.events.length === 0) return;

    this.logger.log("sendKeepalive: %d events", payload.events.length);

    const buildJson = (evts: eventWithTime[]): string => JSON.stringify({ ...payload, events: evts });

    let trimmedEvents: readonly eventWithTime[] = payload.events;
    let json = buildJson([...trimmedEvents]);
    let compressed = gzipString(json);

    let rawCap = KEEPALIVE_RAW_CEILING;
    while (compressed.byteLength > KEEPALIVE_BYTE_LIMIT) {
      const next = trimToFitKeepalive(payload.events, buildJson, rawCap);
      if (next.length === trimmedEvents.length) break; // bootstraps-only floor — can't shrink further.
      trimmedEvents = next;
      json = buildJson([...trimmedEvents]);
      compressed = gzipString(json);
      rawCap = Math.floor(rawCap / 2);
    }

    if (trimmedEvents.length < payload.events.length) {
      this.logger.warn(
        "sendKeepalive: trimmed to %d/%d events (gzip still over cap; bootstraps preserved)",
        trimmedEvents.length,
        payload.events.length,
      );
    }

    this.logger.log(
      "sendKeepalive: %d events / raw %d → gzip %d bytes",
      trimmedEvents.length,
      json.length,
      compressed.byteLength,
    );

    try {
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "X-Dozor-Public-Key": this.apiKey,
        },
        // `Uint8Array` body sent verbatim; the gzip is what the server's parse-body
        // helper decompresses transparently via DecompressionStream.
        body: compressed,
        keepalive: true,
      }).catch((err) => {
        this.logger.warn("sendKeepalive: failed", err);
      });
    } catch {
      // fire-and-forget on unload
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gzipString(input: string): Uint8Array {
  // `TextEncoder` is part of the WHATWG spec and ships in every modern browser; the
  // SSR path of frameworks like Next.js polyfills it via Node 18+. The `?? new ...()`
  // fallback covers oddball runtimes where the global isn't constructed yet.
  const encoder = TEXT_ENCODER ?? new TextEncoder();
  return gzipSync(encoder.encode(input));
}

const RRWEB_FULL_SNAPSHOT_TYPE = 2;
const RRWEB_META_TYPE = 4;

function isBootstrapEvent(event: eventWithTime): boolean {
  return event.type === RRWEB_META_TYPE || event.type === RRWEB_FULL_SNAPSHOT_TYPE;
}

// Keeps every bootstrap event (Meta + FullSnapshot), drops oldest incrementals first.
// Falls back to "bootstraps-only" if even those exceed the cap — replay is degraded
// but at least openable.
function trimToFitKeepalive(
  events: readonly eventWithTime[],
  buildJson: (evts: eventWithTime[]) => string,
  cap: number,
): eventWithTime[] {
  const bootstraps = events.filter(isBootstrapEvent);
  const incrementals = events.filter((e) => !isBootstrapEvent(e));

  if (buildJson(bootstraps).length > cap) {
    return bootstraps;
  }

  // Binary-search the largest tail of incrementals that still fits with all bootstraps.
  let lo = 0;
  let hi = incrementals.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = mergeChronological(bootstraps, incrementals.slice(-mid));
    if (buildJson(candidate).length <= cap) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return mergeChronological(bootstraps, incrementals.slice(-lo));
}

function mergeChronological(a: readonly eventWithTime[], b: readonly eventWithTime[]): eventWithTime[] {
  return [...a, ...b].sort((x, y) => x.timestamp - y.timestamp);
}
