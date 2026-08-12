import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSnapshotText } from "../src/analyst.js";

async function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = overrides[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function seedSnapshot(dir, rows, ts = new Date().toISOString()) {
  const snapDir = path.join(dir, "snapshots");
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapDir, `snapshot-${ts.replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ fetchedAt: ts, meta: { state: "healthy" }, rows })
  );
}

const rows = [
  {
    symbol: "AAPL",
    longName: "Apple Inc.",
    regularMarketPrice: 234.98,
    regularMarketChange: 1.42,
    regularMarketChangePercent: 0.61,
    regularMarketVolume: 48200000,
    marketCap: 3520000000000,
    fiftyTwoWeekHigh: 260.1,
    fiftyTwoWeekLow: 164.08,
  },
];

test("buildSnapshotText includes the scraped numbers", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "analyst-test-"));
  seedSnapshot(tmp, rows);
  await withEnv(
    { DATA_DIR: tmp },
    async () => {
      const text = buildSnapshotText("Which ticker is strongest?");
      assert.match(text, /AAPL/);
      assert.match(text, /234\.98/);
      assert.match(text, /0\.61%/);
      assert.match(text, /Which ticker is strongest\?/);
    }
  );
});

test("buildSnapshotText handles missing data gracefully", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "analyst-test-"));
  await withEnv(
    { DATA_DIR: tmp },
    async () => {
      const text = buildSnapshotText();
      assert.match(text, /No market data yet/);
    }
  );
});
