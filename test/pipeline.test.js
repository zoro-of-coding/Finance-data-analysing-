import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateRows } from "../src/validator.js";
import { buildInsights } from "../src/analytics.js";
import { runCycle } from "../src/pipeline.js";

const rows = [
  { symbol: "A", regularMarketPrice: 10, regularMarketChangePercent: 1 },
  { symbol: "B", regularMarketPrice: 20, regularMarketChangePercent: -3 },
  { symbol: "C", regularMarketPrice: 30, regularMarketChangePercent: 5 },
];

test("insights rank gainers and losers", () => {
  const insights = buildInsights(rows);
  assert.equal(insights.topGainers[0]._symbol, "C");
  assert.equal(insights.topGainers.at(-1)._symbol, "B");
  assert.equal(insights.topLosers[0]._symbol, "B");
  assert.equal(insights.totalTickers, 3);
  assert.ok(Math.abs(insights.avgChangePct - 1) < 1e-9);
});

// ---- Pipeline end-to-end with injected deps (offline) ----------------------

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

const healthyRows = () => [
  { symbol: "AAPL", regularMarketPrice: 234.98, regularMarketChangePercent: 0.61 },
  { symbol: "MSFT", regularMarketPrice: 467.5, regularMarketChangePercent: -0.5 },
  { symbol: "NVDA", regularMarketPrice: 131.26, regularMarketChangePercent: 3.04 },
];
const brokenRows = () => [
  { url: "https://finance.yahoo.com/quote/AAPL", regularMarketPrice: null },
  { url: "https://finance.yahoo.com/quote/MSFT", regularMarketPrice: null },
  { url: "https://finance.yahoo.com/quote/NVDA", regularMarketPrice: null },
];

const base = {
  BRIGHTDATA_API_KEY: "test-key",
  COLLECTOR_ID: "c_test",
  SCRAPE_SYMBOLS: "AAPL,MSFT,NVDA",
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "scraper-test-")),
};

test("cycle: healthy data -> no heal needed", async () => {
  await withEnv(base, async () => {
    const deps = {
      triggerCollector: async () => "j_test",
      fetchDataset: async () => healthyRows(),
      runHealing: async () => {
        throw new Error("should not heal");
      },
    };
    const result = await runCycle({ deps });
    assert.equal(result.state, "healthy");
    assert.equal(result.attempts, 0);
  });
});

test("cycle: broken data -> heal -> recovered = healed", async () => {
  await withEnv(base, async () => {
    let phase = "broken";
    const deps = {
      triggerCollector: async () => "j_test",
      fetchDataset: async () => (phase === "broken" ? brokenRows() : healthyRows()),
      runHealing: async () => {
        phase = "ok";
        return { healed: true };
      },
    };
    const result = await runCycle({ deps });
    assert.equal(result.state, "healed");
    assert.equal(result.attempts, 1);
  });
});

test("cycle: broken data, heal keeps failing -> broken", async () => {
  await withEnv(
    { ...base, AUTO_HEAL: "true", MAX_HEAL_ATTEMPTS: "2" },
    async () => {
      const deps = {
        triggerCollector: async () => "j_test",
        fetchDataset: async () => brokenRows(),
        runHealing: async () => {
          throw new Error("heal failed");
        },
      };
      await assert.rejects(() => runCycle({ deps }), { code: "VALIDATION_FAILED" });
    }
  );
});

test("cycle: awaiting approval when auto-approve disabled", async () => {
  await withEnv(
    { ...base, AUTO_HEAL: "true", AUTO_APPROVE: "false" },
    async () => {
      const deps = {
        triggerCollector: async () => "j_test",
        fetchDataset: async () => brokenRows(),
        runHealing: async () => ({ healed: false, reason: "awaiting_user_approval" }),
      };
      const result = await runCycle({ deps });
      assert.equal(result.state, "awaiting_approval");
    }
  );
});

test("validator sanity", () => {
  assert.equal(validateRows(healthyRows(), { requiredFields: ["symbol", "regularMarketPrice"] }).healthy, true);
  assert.equal(validateRows(brokenRows(), { requiredFields: ["symbol", "regularMarketPrice"] }).healthy, false);
});
