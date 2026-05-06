import type { eventWithTime } from "rrweb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMetadata, UserIdentity } from "../../types";
import { Emitter, type DozorEventMap, type Handler } from "../core/emitter";
import { createLogger } from "../logger";
import { EventBuffer } from "./event-buffer";

function makeEvent(timestamp = Date.now()): eventWithTime {
  return { type: 3, data: {}, timestamp } as unknown as eventWithTime;
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
    it("stores the event without mutation", () => {
      const event = makeEvent();
      buffer.push(event);

      expect(buffer.size).toBe(1);
    });

    it("emits event:buffered with the new buffer size", () => {
      const handler = vi.fn<Handler<DozorEventMap["event:buffered"]>>();
      emitter.on("event:buffered", handler);

      buffer.push(makeEvent());
      buffer.push(makeEvent());

      expect(handler).toHaveBeenNthCalledWith(1, { bufferSize: 1 });
      expect(handler).toHaveBeenNthCalledWith(2, { bufferSize: 2 });
    });
  });

  describe("drain", () => {
    it("returns null when the buffer is empty", () => {
      expect(buffer.drain("session-1")).toBeNull();
    });

    it("returns the buffered events keyed by sessionId and clears the buffer", () => {
      buffer.push(makeEvent());
      buffer.push(makeEvent());

      const payload = buffer.drain("session-42");

      expect(payload).not.toBeNull();
      expect(payload?.sessionId).toBe("session-42");
      expect(payload?.events).toHaveLength(2);
      expect(buffer.size).toBe(0);
    });

    it("includes metadata only on the first drain after setMetadata", () => {
      buffer.setMetadata(makeMetadata());
      buffer.push(makeEvent());

      const first = buffer.drain("s");
      buffer.push(makeEvent());
      const second = buffer.drain("s");

      expect(first?.metadata).toEqual(makeMetadata());
      expect(second?.metadata).toBeUndefined();
    });

    it("re-includes metadata after updateIdentity()", () => {
      buffer.setMetadata(makeMetadata());
      buffer.push(makeEvent());
      buffer.drain("s");

      const identity: UserIdentity = { userId: "u1", traits: { plan: "pro" } };
      buffer.updateIdentity(identity);
      buffer.push(makeEvent());

      const next = buffer.drain("s");

      expect(next?.metadata?.userIdentity).toEqual(identity);
    });
  });

  describe("prepend", () => {
    it("re-queues events at the front of the buffer", () => {
      const newer = makeEvent(2);
      buffer.push(newer);

      const older = makeEvent(1);
      buffer.prepend([older]);

      const payload = buffer.drain("s");
      expect(payload?.events[0]).toBe(older);
      expect(payload?.events[1]).toBe(newer);
    });

    it("trims the oldest events when prepend pushes the buffer past MAX_BUFFER_SIZE (10000)", () => {
      for (let i = 0; i < 9000; i++) buffer.push(makeEvent(i + 10000));
      const older = Array.from({ length: 2000 }, (_, i) => makeEvent(i));

      buffer.prepend(older);

      expect(buffer.size).toBe(10000);
      const payload = buffer.drain("s");
      expect(payload?.events[0]?.timestamp).toBe(1000);
    });
  });

  describe("clear", () => {
    it("removes events", () => {
      buffer.push(makeEvent());

      buffer.clear();

      expect(buffer.size).toBe(0);
      expect(buffer.drain("s")).toBeNull();
    });
  });
});
