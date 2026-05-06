import type { eventWithTime } from "rrweb";
import type { IngestPayload } from "../types";
import type { Logger } from "./logger";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const COMPRESSION_THRESHOLD = 1_024;
/** Stay safely under the browser's 64 KB keepalive body limit. */
const KEEPALIVE_BYTE_LIMIT = 60 * 1024;

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

  // No compression — `CompressionStream` is async and may not flush before page close.
  // Trim policy when payload exceeds `KEEPALIVE_BYTE_LIMIT`: ALWAYS preserve every
  // Meta (type=4) and FullSnapshot (type=2) event — those seed the replayer's DOM,
  // dropping them would leave the server with an unreplayable "incrementals only"
  // stream. Trim the oldest *incremental* events (type=3/5/6) until the payload
  // fits.
  sendKeepalive(payload: IngestPayload): void {
    if (payload.events.length === 0) return;

    this.logger.log("sendKeepalive: %d events", payload.events.length);

    const buildJson = (evts: eventWithTime[]): string => JSON.stringify({ ...payload, events: evts });
    let trimmedEvents = payload.events;
    let json = buildJson(trimmedEvents);

    if (json.length > KEEPALIVE_BYTE_LIMIT && trimmedEvents.length > 1) {
      trimmedEvents = trimToFitKeepalive(payload.events, buildJson, KEEPALIVE_BYTE_LIMIT);
      json = buildJson(trimmedEvents);
      this.logger.warn(
        "sendKeepalive: trimmed to %d/%d events (byte limit, bootstraps preserved)",
        trimmedEvents.length,
        payload.events.length,
      );
    }

    try {
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dozor-Public-Key": this.apiKey,
        },
        body: json,
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
