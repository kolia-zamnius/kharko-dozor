const PREFIX = "[dozor]";

export interface Logger {
  log(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export function createLogger(enabled: boolean): Logger {
  if (!enabled) {
    const noop = () => {};
    return { log: noop, warn: noop, error: noop };
  }

  return {
    log: (msg, ...args) => console.log(PREFIX, msg, ...args),
    warn: (msg, ...args) => console.warn(PREFIX, msg, ...args),
    error: (msg, ...args) => console.error(PREFIX, msg, ...args),
  };
}
