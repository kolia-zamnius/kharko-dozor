import type { SessionMetadata } from "../../types";
import type { Logger } from "../logger";

export function collectMetadata(logger: Logger): SessionMetadata {
  const metadata: SessionMetadata = {
    url: location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    screenWidth: screen.width,
    screenHeight: screen.height,
    language: navigator.language,
  };

  logger.log("Metadata: collected", {
    url: metadata.url,
    screen: `${metadata.screenWidth}×${metadata.screenHeight}`,
    language: metadata.language,
  });

  return metadata;
}
