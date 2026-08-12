import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolve(p, fallback) {
  return process.env[p] ? path.resolve(process.env[p]) : path.resolve(ROOT_DIR, fallback);
}

/**
 * Configuration, read lazily so tests can vary environment variables per run
 * without re-importing a cached singleton.
 */
export const config = {
  get apiKey() {
    return process.env.BRIGHTDATA_API_KEY || "";
  },
  get collectorId() {
    return process.env.COLLECTOR_ID || "";
  },

  get symbols() {
    return csv(process.env.SCRAPE_SYMBOLS);
  },
  get urls() {
    return csv(process.env.SCRAPE_URLS);
  },
  get inputs() {
    const quoteUrl = (s) => `https://finance.yahoo.com/quote/${s.toUpperCase()}`;
    return [
      ...this.urls,
      ...this.symbols.map((s) => quoteUrl(s)),
    ].map((url) => ({ url }));
  },

  get autoHeal() {
    return bool(process.env.AUTO_HEAL, true);
  },
  get autoApprove() {
    return bool(process.env.AUTO_APPROVE, true);
  },
  get maxHealAttempts() {
    return num(process.env.MAX_HEAL_ATTEMPTS, 2);
  },

  get requiredFields() {
    return csv(process.env.REQUIRED_FIELDS);
  },
  get minFieldFillRate() {
    return num(process.env.MIN_FIELD_FILL_RATE, 0.7);
  },
  get maxBadRows() {
    return num(process.env.MAX_BAD_ROWS, 0);
  },

  get alertWebhookUrl() {
    return process.env.ALERT_WEBHOOK_URL || "";
  },
  get statusFile() {
    return resolve(process.env.STATUS_FILE ? process.env.STATUS_FILE : null, "data/status.json");
  },
  get dataDir() {
    return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, "data");
  },

  get daemonIntervalSeconds() {
    return num(process.env.DAEMON_INTERVAL_SECONDS, 3600);
  },
  get dashboardPort() {
    return num(process.env.DASHBOARD_PORT, 4173);
  },

  get pollIntervalMs() {
    return num(process.env.POLL_INTERVAL_MS, 5000);
  },
  get pollTimeoutMs() {
    return num(process.env.POLL_TIMEOUT_MS, 15 * 60 * 1000);
  },

  // Local Llama 3.2-1B analyst
  get llmModelDir() {
    return process.env.LLM_MODEL_DIR
      ? path.resolve(process.env.LLM_MODEL_DIR)
      : path.join(ROOT_DIR, "llama3.2-1b");
  },
  get pythonBin() {
    return process.env.PYTHON || "python";
  },
};

export function requireCredentials() {
  if (!config.apiKey) {
    throw new Error("BRIGHTDATA_API_KEY is not set. See .env.example.");
  }
}

export function requireCollector() {
  requireCredentials();
  if (!config.collectorId) {
    throw new Error(
      "COLLECTOR_ID is not set. Run `npm run create-collector` first, or paste an existing collector id into .env."
    );
  }
}

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  return config.dataDir;
}
