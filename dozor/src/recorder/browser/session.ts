import type { Logger } from "../logger";

const SESSION_KEY = "dozor_session_id";

// `sessionStorage` (not `localStorage`) — SPA navigations keep one session, new tab starts fresh.
export function getSessionId(logger: Logger): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      logger.log("Session: restored existing (%s)", existing);
      return existing;
    }
  } catch {
    // SSR or sandbox iframe — fall through to a fresh in-memory ID.
    logger.warn("Session: sessionStorage unavailable — ID will not persist");
  }

  const id = crypto.randomUUID();
  logger.log("Session: created new (%s)", id);

  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // best-effort
  }

  return id;
}

export function clearSessionId(logger: Logger): void {
  logger.log("Session: cleared");
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // best-effort
  }
}
