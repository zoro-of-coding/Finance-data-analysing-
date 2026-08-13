import test from "node:test";
import assert from "node:assert/strict";
import { mapChartRow, symbolsFromInputs } from "../src/realtime.js";

test("symbolsFromInputs parses quote URLs and de-dupes", () => {
  const inputs = [
    { url: "https://finance.yahoo.com/quote/AAPL" },
    { url: "https://finance.yahoo.com/quote/msft" },
    { symbol: "NVDA" },
    { url: "https://finance.yahoo.com/quote/AAPL" },
  ];
  assert.deepEqual(symbolsFromInputs(inputs), ["AAPL", "MSFT", "NVDA"]);
});

test("mapChartRow maps chart meta to collector row shape", () => {
  const result = {
    meta: {
      symbol: "AAPL",
      longName: "Apple Inc.",
      currency: "USD",
      exchangeName: "NMS",
      instrumentType: "EQUITY",
      regularMarketPrice: 302.25,
      chartPreviousClose: 304.91,
      regularMarketVolume: 38820559,
      fiftyTwoWeekHigh: 344.57,
      fiftyTwoWeekLow: 223.78,
      regularMarketTime: 1786564801,
    },
  };
  const row = mapChartRow(result, "https://finance.yahoo.com/quote/AAPL");
  assert.equal(row.symbol, "AAPL");
  assert.equal(row.longName, "Apple Inc.");
  assert.equal(row.regularMarketPrice, 302.25);
  assert.equal(row.regularMarketChange, -2.66);
  assert.ok(Math.abs(row.regularMarketChangePercent - (-0.8727)) < 0.01);
  assert.equal(row.marketCap, null);
  assert.equal(row.fiftyTwoWeekHigh, 344.57);
});

test("mapChartRow tolerates a bare/missing meta", () => {
  const row = mapChartRow({}, null);
  assert.equal(row.symbol, null);
  assert.equal(row.regularMarketChange, null);
  assert.equal(row.regularMarketChangePercent, null);
});
