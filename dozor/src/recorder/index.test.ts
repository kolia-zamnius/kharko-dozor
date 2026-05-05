import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { DozorOptions } from "../types";
import { Dozor } from "./index";

vi.mock("rrweb", () => ({
  record: Object.assign(
    vi.fn(() => vi.fn() /* stop fn */),
    { takeFullSnapshot: vi.fn() },
  ),
}));

vi.mock("@rrweb/rrweb-plugin-console-record", () => ({
  getRecordConsolePlugin: vi.fn(() => ({ name: "console" })),
}));

const BASE_OPTIONS: DozorOptions = {
  apiKey: "dp_test",
  endpoint: "https://api.example.com/api/ingest",
};

function resetSingleton(): void {
  (Dozor as unknown as { instance: Dozor | null }).instance = null;
}

describe("Dozor facade", () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    sessionStorage.clear();
    resetSingleton();
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSingleton();
  });

  describe("singleton", () => {
    it("returns the same instance on repeated init() calls", () => {
      const a = Dozor.init({ ...BASE_OPTIONS });
      const b = Dozor.init({ ...BASE_OPTIONS, debug: true });
      expect(a).toBe(b);
    });
  });

  describe("autoStart option", () => {
    it("auto-starts recording by default and creates a session", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });

      expect(dozor.state).toBe("recording");
      expect(dozor.isRecording).toBe(true);
      expect(dozor.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("stays idle when autoStart is false (no session yet)", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, autoStart: false });

      expect(dozor.state).toBe("idle");
      expect(dozor.sessionId).toBeNull();
    });
  });

  describe("lifecycle", () => {
    it("start() from idle moves to recording", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, autoStart: false });
      dozor.start();

      expect(dozor.state).toBe("recording");
      expect(dozor.sessionId).not.toBeNull();
    });

    it("pause() from recording moves to paused", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });
      const sidBefore = dozor.sessionId;

      dozor.pause();

      expect(dozor.state).toBe("paused");
      expect(dozor.isPaused).toBe(true);
      expect(dozor.sessionId).toBe(sidBefore);
    });

    it("resume() from paused returns to recording with the same session", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });
      const sid = dozor.sessionId;
      dozor.pause();
      dozor.resume();

      expect(dozor.state).toBe("recording");
      expect(dozor.sessionId).toBe(sid);
    });

    it("stop() returns to idle and clears the session", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });

      dozor.stop();

      expect(dozor.state).toBe("idle");
      expect(dozor.sessionId).toBeNull();
    });

    it("ignores invalid transitions (start while already recording)", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });
      const sid = dozor.sessionId;

      dozor.start();

      expect(dozor.sessionId).toBe(sid);
      expect(dozor.state).toBe("recording");
    });
  });

  describe("identify", () => {
    it("stores the user identity on the instance", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });

      dozor.identify("user_42", { plan: "pro" });

      expect(dozor.userId).toBe("user_42");
    });

    it("returns null userId before identify() is called", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });
      expect(dozor.userId).toBeNull();
    });
  });

  describe("hold / release", () => {
    it("hold() sets isHeld but recording state is unchanged", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });

      dozor.hold();

      expect(dozor.isHeld).toBe(true);
      expect(dozor.state).toBe("recording");
    });

    it("constructor with hold:true starts in held state", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, hold: true });

      expect(dozor.isHeld).toBe(true);
      expect(dozor.state).toBe("recording");
    });

    it("release() clears isHeld", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, hold: true });

      dozor.release();

      expect(dozor.isHeld).toBe(false);
    });

    it("release({ discard: true }) clears isHeld without flushing the buffer", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, hold: true });
      const fetchCallsBefore = fetchMock.mock.calls.length;

      dozor.release({ discard: true });

      expect(dozor.isHeld).toBe(false);
      // No new flush fetch should have been queued by release(discard).
      expect(fetchMock.mock.calls.length).toBe(fetchCallsBefore);
    });
  });

  describe("cancel", () => {
    it("returns to idle, clears session, and POSTs to the cancel endpoint", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS });
      const sid = dozor.sessionId!;

      dozor.cancel();

      expect(dozor.state).toBe("idle");
      expect(dozor.sessionId).toBeNull();

      const cancelCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === "string" && url.includes("/sessions/cancel"),
      );
      expect(cancelCall).toBeDefined();
      expect(cancelCall![1]!.body).toBe(JSON.stringify({ sessionId: sid }));
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers when state changes via lifecycle methods", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, autoStart: false });
      const listener = vi.fn<() => void>();
      dozor.subscribe(listener);

      dozor.start();

      expect(listener).toHaveBeenCalled();
    });

    it("the unsubscribe function stops further notifications", () => {
      const dozor = Dozor.init({ ...BASE_OPTIONS, autoStart: false });
      const listener = vi.fn<() => void>();
      const unsubscribe = dozor.subscribe(listener);

      unsubscribe();
      dozor.start();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
