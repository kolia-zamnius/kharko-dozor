import type { eventWithTime } from "rrweb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMetadata, SliceMarker, UserIdentity } from "../../types";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { EventBuffer } from "./event-buffer";

function makeEvent(timestamp = Date.now()): eventWithTime {
  return { type: 3, data: {}, timestamp } as unknown as eventWithTime;
}

function makeMarker(index: number, reason: SliceMarker["reason"] = "init"): SliceMarker {
  return {
    index,
    reason,
    startedAt: Date.now(),
    url: "https://example.com/",
    pathname: "/",
    viewportWidth: 1024,
    viewportHeight: 768,
  };
}

function makeMetadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    url: "https://example.com/",
    referrer: "",
    userAgent: "ua",
    screenWidth: 1024,
    screenHeight: 768,
    language: "en",
    ...overrides,
  };
}

describe("EventBuffer", () => {
  let buffer: EventBuffer;
  let emitter: Emitter;

  beforeEach(() => {
    emitter = new Emitter(createLogger(false));
    buffer = new EventBuffer(emitter, createLogger(false));
  });

  describe("push", () => {
    it("stores the event and stamps it with the current sliceIndex", () => {
      const event = makeEvent();
      buffer.push(event, 7);

      expect(buffer.size).toBe(1);
      expect((event as eventWithTime & { sliceIndex: number }).sliceIndex).toBe(7);
    });

    it("emits event:buffered with the new buffer size", () => {
      const handler = vi.fn<Handler<DozorEventMap["event:buffered"]>>();
      emitter.on("event:buffered", handler);

      buffer.push(makeEvent(), 0);
      buffer.push(makeEvent(), 0);

      expect(handler).toHaveBeenNthCalledWith(1, { bufferSize: 1 });
      expect(handler).toHaveBeenNthCalledWith(2, { bufferSize: 2 });
    });
  });

  describe("drain", () => {
    it("returns null when there are no events and no markers", () => {
      expect(buffer.drain("session-1")).toBeNull();
    });

    it("returns the buffered events keyed by sessionId and clears the buffer", () => {
      buffer.push(makeEvent(), 0);
      buffer.push(makeEvent(), 0);

      const payload = buffer.drain("session-42");

      expect(payload).not.toBeNull();
      expect(payload?.sessionId).toBe("session-42");
      expect(payload?.events).toHaveLength(2);
      expect(buffer.size).toBe(0);
    });

    it("includes metadata only on the first drain after setMetadata", () => {
      buffer.setMetadata(makeMetadata());
      buffer.push(makeEvent(), 0);

      const first = buffer.drain("s");
      buffer.push(makeEvent(), 0);
      const second = buffer.drain("s");

      expect(first?.metadata).toEqual(makeMetadata());
      expect(second?.metadata).toBeUndefined();
    });

    it("re-includes metadata after updateIdentity()", () => {
      buffer.setMetadata(makeMetadata());
      buffer.push(makeEvent(), 0);
      buffer.drain("s"); // first drain consumes metadata

      const identity: UserIdentity = { userId: "u1", traits: { plan: "pro" } };
      buffer.updateIdentity(identity);
      buffer.push(makeEvent(), 0);

      const next = buffer.drain("s");

      expect(next?.metadata?.userIdentity).toEqual(identity);
    });

    it("attaches accumulated slice markers to the next payload and clears them", () => {
      buffer.addSliceMarker(makeMarker(0));
      buffer.addSliceMarker(makeMarker(1, "navigation"));

      const first = buffer.drain("s");
      const second = buffer.drain("s");

      expect(first?.sliceMarkers).toHaveLength(2);
      expect(second).toBeNull();
    });

    it("returns a payload with markers even when there are no events", () => {
      buffer.addSliceMarker(makeMarker(0));

      const payload = buffer.drain("s");

      expect(payload).not.toBeNull();
      expect(payload?.events).toEqual([]);
      expect(payload?.sliceMarkers).toHaveLength(1);
    });
  });

  describe("prepend", () => {
    it("re-queues events at the front of the buffer", () => {
      const newer = makeEvent(2);
      buffer.push(newer, 0);

      const older = makeEvent(1);
      buffer.prepend([older]);

      const payload = buffer.drain("s");
      expect(payload?.events[0]).toBe(older);
      expect(payload?.events[1]).toBe(newer);
    });

    it("re-queues markers at the front when provided", () => {
      buffer.addSliceMarker(makeMarker(2));
      buffer.prepend([], [makeMarker(1)]);

      const payload = buffer.drain("s");
      expect(payload?.sliceMarkers?.map((m) => m.index)).toEqual([1, 2]);
    });

    it("trims the oldest events when prepend pushes the buffer past MAX_BUFFER_SIZE (10000)", () => {
      // 9000 already in buffer (will be the "newer" tail), prepend 2000 "older" ones → 11000 total → drop 1000 oldest
      for (let i = 0; i < 9000; i++) buffer.push(makeEvent(i + 10000), 0);
      const older = Array.from({ length: 2000 }, (_, i) => makeEvent(i));

      buffer.prepend(older);

      expect(buffer.size).toBe(10000);
      const payload = buffer.drain("s");
      // first kept event must be the 1001st of the prepended batch (1000 oldest dropped)
      expect(payload?.events[0]?.timestamp).toBe(1000);
    });
  });

  describe("clear", () => {
    it("removes events and markers", () => {
      buffer.push(makeEvent(), 0);
      buffer.addSliceMarker(makeMarker(0));

      buffer.clear();

      expect(buffer.size).toBe(0);
      expect(buffer.drain("s")).toBeNull();
    });
  });
});
