type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/** Tiny structured logger. One line per event, greppable, no deps. */
export function createLogger(level: Level = "info", scope = "rail"): Logger {
  const emit = (l: Level, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[l] < ORDER[level]) return;
    const ts = new Date().toISOString();
    const extra = data ? " " + JSON.stringify(data, bigintReplacer) : "";
    const line = `${ts} ${l.toUpperCase().padEnd(5)} [${scope}] ${msg}${extra}`;
    (l === "error" || l === "warn" ? console.error : console.log)(line);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
    child: (s) => createLogger(level, `${scope}:${s}`),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};

export function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
