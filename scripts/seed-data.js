#!/usr/bin/env node
/**
 * Seed data/ with realistic history + snapshots so the dashboard has content
 * for a demo video without waiting for real runs. Offline, no API calls.
 *
 * Usage: npm run seed
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", name), "utf8"));

const baseRows = fixture("yahoo-good.json");
const SYMBOLS = baseRows.map((r) => r.symbol);

// ~7 days of 4-hourly cycles = 42 snapshots, prices drifting over time.
const HOURS = 7 * 24;
const STEP = 4;
const states = ["healthy", "healthy", "healthy", "healed", "healthy", "broken", "healthy"];

function mutate(base, i) {
  return base.map((row, s) => ({
    ...row,
    regularMarketPrice: +(row.regularMarketPrice * (1 + Math.sin(i / 6 + s) * 0.03)).toFixed(2),
    regularMarketChange: +((Math.random() - 0.5) * 4).toFixed(2),
    regularMarketChangePercent: +((Math.random() - 0.5) * 2).toFixed(2),
  }));
}

const snapshotDir = path.join(config.dataDir, "snapshots");
fs.mkdirSync(snapshotDir, { recursive: true });
fs.writeFileSync(path.join(config.dataDir, "history.jsonl"), "");

for (let i = 0; i <= HOURS; i += STEP) {
  const ts = new Date(Date.now() - (HOURS - i) * 3600_000);
  const stamp = ts.toISOString().replace(/[:.]/g, "-");
  const state = states[(i / STEP) % states.length];
  const rows = mutate(baseRows, i / STEP);

  fs.appendFileSync(
    path.join(config.dataDir, "history.jsonl"),
    JSON.stringify({
      ts: ts.toISOString(),
      state,
      summary: state === "healed" ? "healed (3 rows, 0 warnings)" : `healthy (${rows.length} rows)`,
      totalRows: rows.length,
      collectorId: config.collectorId || "c_demo",
      attempts: state === "healed" ? 1 : 0,
    }) + "\n"
  );

  fs.writeFileSync(
    path.join(snapshotDir, `snapshot-${stamp}.json`),
    JSON.stringify({ fetchedAt: ts.toISOString(), meta: { state }, rows }, null, 2)
  );
}

const insights = baseRows.map((r) => ({
  symbol: r.symbol,
  pct: +(Math.random() * 6 - 3).toFixed(2),
}));
fs.writeFileSync(
  config.statusFile,
  JSON.stringify(
    {
      state: "healthy",
      ts: new Date().toISOString(),
      summary: "healthy (3 rows, 0 warnings) — seeded for demo",
      totalRows: 3,
      collectorId: config.collectorId || "c_demo",
      attempts: 0,
      insights: {
        avgChangePct: 0.4,
        topGainers: insights.slice().sort((a, b) => b.pct - a.pct).slice(0, 3),
        topLosers: insights.slice().sort((a, b) => a.pct - b.pct).slice(0, 3),
      },
    },
    null,
    2
  )
);

console.log(`Seeded ${Math.ceil(HOURS / STEP)} snapshots + history + status into ${config.dataDir}`);
console.log("Start the dashboard: npm run dashboard");
