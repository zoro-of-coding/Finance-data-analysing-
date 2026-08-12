import test from "node:test";
import assert from "node:assert/strict";
import { validateRows } from "../src/validator.js";
import { buildHealPrompt } from "../src/healer.js";

const good = [
  {
    symbol: "AAPL", longName: "Apple Inc.", regularMarketPrice: 234.98,
    regularMarketChange: 1.42, regularMarketChangePercent: 0.61,
    regularMarketVolume: 48200000, marketCap: 3520000000000,
    fiftyTwoWeekHigh: 260.1, fiftyTwoWeekLow: 164.08, regularMarketTime: 1723400000,
  },
  {
    symbol: "MSFT", longName: "Microsoft Corporation", regularMarketPrice: 467.5,
    regularMarketChange: -2.35, regularMarketChangePercent: -0.5,
    regularMarketVolume: 19800000, marketCap: 3470000000000,
    fiftyTwoWeekHigh: 468.35, fiftyTwoWeekLow: 362.28, regularMarketTime: 1723400000,
  },
];

const opts = {
  requiredFields: ["symbol", "regularMarketPrice"],
  minFieldFillRate: 0.7,
  maxBadRows: 0,
};

test("healthy dataset passes", () => {
  const report = validateRows(good, opts);
  assert.equal(report.healthy, true);
  assert.equal(report.badRows, 0);
});

test("empty dataset is critical", () => {
  const report = validateRows([], opts);
  assert.equal(report.healthy, false);
  assert.ok(report.summary.includes("zero rows"));
});

test("null required fields fail", () => {
  const rows = good.map((r) => ({ ...r, regularMarketPrice: null }));
  const report = validateRows(rows, opts);
  assert.equal(report.healthy, false);
  assert.ok(report.badRows > 0);
});

test("wrong field types fail", () => {
  const rows = good.map((r) => ({ ...r, regularMarketVolume: "lots" }));
  const report = validateRows(rows, opts);
  assert.equal(report.healthy, false);
  assert.ok(report.checks.some((c) => c.name === "completeness" && !c.pass));
});

test("frozen data flags staleness", () => {
  const report = validateRows(good, { ...opts, prevRows: good });
  assert.ok(report.checks.some((c) => c.name === "staleness" && !c.pass));
  // staleness is a warning, not fatal
  assert.equal(report.healthy, true);
});

test("non-positive prices flagged", () => {
  const rows = good.map((r) => ({ ...r, regularMarketPrice: -5 }));
  const report = validateRows(rows, opts);
  assert.ok(report.checks.some((c) => c.name === "priceSanity" && !c.pass));
});

test("heal prompt is concise and names the broken fields", () => {
  const report = validateRows(
    good.map((r) => ({ ...r, regularMarketPrice: null })),
    opts
  );
  const prompt = buildHealPrompt(report, ["AAPL", "MSFT"]);
  assert.ok(prompt.length <= 1000);
  assert.match(prompt, /regularMarketPrice/);
  assert.match(prompt, /AAPL, MSFT/);
});
