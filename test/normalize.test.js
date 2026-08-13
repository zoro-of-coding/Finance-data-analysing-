import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRow, normalizeRows } from "../src/normalize.js";

test("normalizes nested value objects to plain numbers", () => {
  const row = normalizeRow({
    symbol: "MSFT",
    longName: "Microsoft Corporation (MSFT)",
    regularMarketPrice: { value: 492.43, currency: "USD", symbol: "$" },
    regularMarketChange: { value: -11.38, currency: "USD", symbol: "$" },
    regularMarketChangePercent: "(-2.26%)",
    regularMarketVolume: 27275247,
    marketCap: "3.657T",
    currency: "USD",
    fiftyTwoWeekHigh: { value: 553.72, currency: "USD", symbol: "$" },
    fiftyTwoWeekLow: { value: 349.2, currency: "USD", symbol: "$" },
    regularMarketTime: "At close: August 12 at 4:00:01 PM EDT",
    input: { url: "https://finance.yahoo.com/quote/MSFT" },
  });

  assert.equal(row.symbol, "MSFT");
  assert.equal(row.regularMarketPrice, 492.43);
  assert.equal(row.regularMarketChange, -11.38);
  assert.equal(row.regularMarketChangePercent, -2.26);
  assert.equal(row.regularMarketVolume, 27275247);
  assert.equal(row.marketCap, 3657000000000);
  assert.equal(row.fiftyTwoWeekHigh, 553.72);
  assert.equal(row.url, "https://finance.yahoo.com/quote/MSFT");
  assert.ok(typeof row.regularMarketTime === "number");
});

test("normalizeRows maps every row", () => {
  const rows = normalizeRows([
    { symbol: "A", regularMarketPrice: { value: 1 } },
    { symbol: "B", regularMarketPrice: null },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].regularMarketPrice, 1);
  assert.equal(rows[1].regularMarketPrice, null);
});

test("strips parens from symbol like the collector's \"(NVDA)\"", () => {
  const row = normalizeRow({ symbol: "(NVDA)", regularMarketPrice: 224.09 });
  assert.equal(row.symbol, "NVDA");
  assert.equal(normalizeRow({ symbol: "  " }).symbol, null);
  assert.equal(normalizeRow({}).symbol, null);
});

test("handles already-plain and missing values", () => {
  const row = normalizeRow({ symbol: "AAPL", regularMarketPrice: 302.25 });
  assert.equal(row.regularMarketPrice, 302.25);
  assert.equal(row.marketCap, null);
  assert.equal(row.regularMarketChangePercent, null);
});