import type { eventWithTime } from "rrweb";
import type { IngestPayload, SessionMetadata, UserIdentity } from "../../types";
import type { Emitter } from "../core/emitter";
import type { Logger } from "../logger";

// Hard cap protects memory during extended offline windows; oldest events drop on overflow.
const MAX_BUFFER_SIZE = 10_000;

export class EventBuffer {
  private buffer: eventWithTime[] = [];
  private metadata: SessionMetadata | null = null;
  private metadataSent = false;
  private emitter: Emitter;
  private logger: Logger;

  constructor(emitter: Emitter, logger: Logger) {
    this.emitter = emitter;
    this.logger = logger;
  }

  push(event: eventWithTime): void {
    this.buffer.push(event);
    this.emitter.emit("event:buffered", { bufferSize: this.buffer.length });
  }

  setMetadata(metadata: SessionMetadata): void {
    this.metadata = metadata;
    this.metadataSent = false;
    this.logger.log("EventBuffer: metadata set", { url: metadata.url });
  }

  // Re-arms metadata for the next drain so a mid-session identity change reaches the server.
  updateIdentity(identity: UserIdentity): void {
    if (this.metadata) {
      this.metadata.userIdentity = identity;
    }
    this.metadataSent = false;
    this.logger.log("EventBuffer: identity updated (userId: %s)", identity.userId);
  }

  drain(sessionId: string): IngestPayload | null {
    if (this.buffer.length === 0) {
      return null;
    }

    const eventCount = this.buffer.length;
    const includesMetadata = !this.metadataSent && !!this.metadata;

    const payload: IngestPayload = {
      sessionId,
      events: this.buffer,
    };
    this.buffer = [];

    if (!this.metadataSent && this.metadata) {
      payload.metadata = this.metadata;
      this.metadataSent = true;
    }

    this.logger.log("EventBuffer: drain (%d events%s)", eventCount, includesMetadata ? ", +metadata" : "");

    return payload;
  }

  // Failed send → events go back to the head so retry preserves order.
  prepend(events: eventWithTime[]): void {
    this.buffer = [...events, ...this.buffer];

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
    this.logger.log("EventBuffer: cleared (%d events discarded)", count);
  }

  get size(): number {
    return this.buffer.length;
  }
}
