import fs from "node:fs";
import path from "node:path";
import { config, ensureDataDir } from "./config.js";
import { logger } from "./logger.js";

const SNAPSHOT_DIR = "snapshots";
const HISTORY_FILE = "history.jsonl";

function file(name) {
  return path.join(ensureDataDir(), name);
}

function safeWrite(target, data) {
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
}

/** Append a cycle record to the append-only history log. */
export function appendCycle(record) {
  fs.appendFileSync(file(HISTORY_FILE), JSON.stringify(record) + "\n");
}

export function writeStatus(status) {
  fs.mkdirSync(path.dirname(config.statusFile), { recursive: true });
  safeWrite(config.statusFile, status);
  return config.statusFile;
}

export function saveSnapshot(rows, meta = {}) {
  const dir = path.join(ensureDataDir(), SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `snapshot-${stamp}.json`);
  safeWrite(target, { fetchedAt: new Date().toISOString(), meta, rows });
  logger.info(`Snapshot saved: ${target}`);
  return target;
}

export function loadLastSnapshot() {
  const dir = path.join(ensureDataDir(), SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const rows = raw.rows || [];
    // Skip snapshots with no usable data (e.g. persisted broken rows).
    if (rows.some((r) => (r.symbol || "").trim() && r.regularMarketPrice != null)) {
      return rows;
    }
  }
  return null;
}

export function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync(config.statusFile, "utf8"));
  } catch {
    return null;
  }
}

export function loadHistory(limit = 100) {
  const target = file(HISTORY_FILE);
  if (!fs.existsSync(target)) return [];
  const lines = fs
    .readFileSync(target, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit);
  return lines.map((l) => JSON.parse(l));
}

/** Newest-first list of snapshots with their rows. */
export function loadSnapshots(limit = 60) {
  const dir = path.join(ensureDataDir(), SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return { file: f, fetchedAt: raw.fetchedAt, meta: raw.meta || {}, rows: raw.rows || [] };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
