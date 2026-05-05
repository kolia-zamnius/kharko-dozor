import type { eventWithTime } from "rrweb";
import type { IngestPayload, SessionMetadata, SliceMarker, UserIdentity } from "../../types";
import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

/** Hard cap protects memory during extended offline windows; oldest events drop on overflow. */
const MAX_BUFFER_SIZE = 10_000;

export class EventBuffer {
  private buffer: eventWithTime[] = [];
  private metadata: SessionMetadata | null = null;
  private metadataSent = false;
  private sliceMarkers: SliceMarker[] = [];
  private emitter: Emitter;
  private logger: Logger;

  constructor(emitter: Emitter, logger: Logger) {
    this.emitter = emitter;
    this.logger = logger;
  }

  push(event: eventWithTime, sliceIndex: number): void {
    (event as eventWithTime & { sliceIndex: number }).sliceIndex = sliceIndex;
    this.buffer.push(event);
    this.emitter.emit("event:buffered", { bufferSize: this.buffer.length });
  }

  addSliceMarker(marker: SliceMarker): void {
    this.sliceMarkers.push(marker);
    this.logger.log("EventBuffer: slice marker added (index: %d, reason: %s)", marker.index, marker.reason);
  }

  /** Sent once on the next drain. */
  setMetadata(metadata: SessionMetadata): void {
    this.metadata = metadata;
    this.metadataSent = false;
    this.logger.log("EventBuffer: metadata set", { url: metadata.url });
  }

  /** Forces metadata re-send on the next drain so the server learns the userId mid-session. */
  updateIdentity(identity: UserIdentity): void {
    if (this.metadata) {
      this.metadata.userIdentity = identity;
    }
    this.metadataSent = false;
    this.logger.log("EventBuffer: identity updated (userId: %s)", identity.userId);
  }

  drain(sessionId: string): IngestPayload | null {
    if (this.buffer.length === 0 && this.sliceMarkers.length === 0) {
      return null;
    }

    const eventCount = this.buffer.length;
    const markerCount = this.sliceMarkers.length;
    const includesMetadata = !this.metadataSent && !!this.metadata;

    const payload: IngestPayload = {
      sessionId,
      events: this.buffer,
    };
    this.buffer = [];

    if (this.sliceMarkers.length > 0) {
      payload.sliceMarkers = this.sliceMarkers;
      this.sliceMarkers = [];
    }

    if (!this.metadataSent && this.metadata) {
      payload.metadata = this.metadata;
      this.metadataSent = true;
    }

    this.logger.log(
      "EventBuffer: drain (%d events, %d markers%s)",
      eventCount,
      markerCount,
      includesMetadata ? ", +metadata" : "",
    );

    return payload;
  }

  /** Re-queue at the head after a failed send. Drops oldest if `MAX_BUFFER_SIZE` exceeded. */
  prepend(events: eventWithTime[], markers?: SliceMarker[]): void {
    this.buffer = [...events, ...this.buffer];
    if (markers?.length) {
      this.sliceMarkers = [...markers, ...this.sliceMarkers];
    }

    this.logger.log("EventBuffer: prepended %d events (buffer: %d)", events.length, this.buffer.length);

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      const dropped = this.buffer.length - MAX_BUFFER_SIZE;
      this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE);
      this.logger.warn("EventBuffer: dropped %d oldest events (buffer overflow)", dropped);
    }
  }

  clear(): void {
    const count = this.buffer.length;
    this.buffer = [];
    this.sliceMarkers = [];
    this.logger.log("EventBuffer: cleared (%d events discarded)", count);
  }

  get size(): number {
    return this.buffer.length;
  }
}
