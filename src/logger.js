const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const level = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function emit(sev, msg, meta) {
  if (LEVELS[sev] < level) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: sev,
    msg,
    ...(meta && Object.keys(meta).length ? { ...meta } : {}),
  });
  process[sev === "error" ? "stderr" : "stdout"].write(line + "\n");
}

export const logger = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
};
