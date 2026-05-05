import type { eventWithTime } from "rrweb";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { IngestPayload } from "../types";
import { createLogger } from "./logger";
import { Transport } from "./transport";

const ENDPOINT = "https://api.example.com/api/ingest";
const API_KEY = "dp_test";
const TIMEOUT = 1_000;

function makePayload(eventCount = 1, eventSize = 50): IngestPayload {
  // Each event ≈ `eventSize` bytes after JSON.stringify, so callers can target a payload size.
  const events: eventWithTime[] = Array.from({ length: eventCount }, (_, i) => ({
    type: 3,
    data: { padding: "x".repeat(eventSize) },
    timestamp: 1_700_000_000_000 + i,
  })) as unknown as eventWithTime[];

  return { sessionId: "session-1", events };
}

function mockResponse(status: number): Response {
  return new Response(null, { status });
}

describe("Transport", () => {
  let transport: Transport;
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    transport = new Transport(ENDPOINT, API_KEY, createLogger(false), TIMEOUT);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("send (success path)", () => {
    it("returns true and sends a single fetch on a 2xx response", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      const result = await transport.send(makePayload());

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("targets the configured endpoint with POST + auth header", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      await transport.send(makePayload());

      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe("POST");
      expect(init.headers["X-Dozor-Public-Key"]).toBe(API_KEY);
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("send (retry on 5xx)", () => {
    it("retries up to 3 times then succeeds when server recovers", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(503))
        .mockResolvedValueOnce(mockResponse(502))
        .mockResolvedValueOnce(mockResponse(200));

      const promise = transport.send(makePayload());
      // Drain microtasks + run backoff sleeps (1s, 2s).
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("returns false after MAX_RETRIES (3) consecutive 5xx", async () => {
      fetchMock.mockResolvedValue(mockResponse(500));

      const promise = transport.send(makePayload());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("send (no retry on 4xx)", () => {
    it("returns false immediately on 401 without retrying", async () => {
      fetchMock.mockResolvedValue(mockResponse(401));

      const result = await transport.send(makePayload());

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("returns false immediately on 400", async () => {
      fetchMock.mockResolvedValue(mockResponse(400));

      const result = await transport.send(makePayload());

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe("send (network errors)", () => {
    it("retries on rejected fetch and eventually returns false", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      const promise = transport.send(makePayload());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("send (compression threshold)", () => {
    it("sends uncompressed JSON when payload is below the 1KB threshold", async () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      await transport.send(makePayload(1, 10));

      const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
      expect(init.headers["Content-Encoding"]).toBeUndefined();
      expect(typeof init.body).toBe("string");
    });

    // The over-threshold gzip path uses `new Blob([json]).stream().pipeThrough(new CompressionStream(...))`,
    // which jsdom does not implement (Blob.stream() is missing). The threshold logic itself is covered
    // above; the gzip code path is exercised by real-browser smoke tests via `pnpm link`.
  });

  describe("deleteSession", () => {
    it("derives the cancel URL from the ingest endpoint and POSTs the sessionId", () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      transport.deleteSession("session-42");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/api/sessions/cancel",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Dozor-Public-Key": API_KEY,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ sessionId: "session-42" }),
        }),
      );
    });
  });

  describe("sendKeepalive", () => {
    it("does nothing when there are no events and no markers", () => {
      transport.sendKeepalive(makePayload(0));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends with keepalive: true and Content-Type JSON", () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      transport.sendKeepalive(makePayload(1));

      const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
      expect(init.keepalive).toBe(true);
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("trims oldest events when payload exceeds the 60KB browser keepalive cap, keeping the most recent", () => {
      fetchMock.mockResolvedValue(mockResponse(200));

      // 200 events × ~500 bytes ≈ 100KB JSON — well above the 60KB cap.
      const payload = makePayload(200, 500);
      transport.sendKeepalive(payload);

      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      // Trimmed payload must fit under the cap and preserve order from the tail.
      expect(body.events.length).toBeLessThan(200);
      expect((init.body as string).length).toBeLessThanOrEqual(60 * 1024);
      const last = body.events.at(-1) as { timestamp: number };
      const original = payload.events.at(-1) as eventWithTime;
      expect(last.timestamp).toBe(original.timestamp);
    });
  });
});
