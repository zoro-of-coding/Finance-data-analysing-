/**
 * Free, keyless Yahoo Finance quote source.
 *
 * Uses the public chart API (https://query1.finance.yahoo.com/v8/finance/chart/...)
 * which needs no API key or collector. Returns rows in the same shape the Bright
 * Data collector produces, so the validator, dashboard, analyst and history all
 * work unchanged. `marketCap` is the only field Yahoo omits here.
 */
import { config } from "./config.js";
import { logger } from "./logger.js";

const CHART_URL = (symbol) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=15m&range=1d`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const round = (v) => (Number.isFinite(v) ? Number(Math.round(v * 100) / 100) : null);

function symbolFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("quote");
    const sym = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
    return sym ? decodeURIComponent(sym).toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Normalize scrape inputs into a de-duplicated symbol list. */
export function symbolsFromInputs(inputs) {
  return [
    ...new Set(
      (inputs || [])
        .map((i) => symbolFromUrl(i?.url) || i?.symbol)
        .filter(Boolean)
    ),
  ];
}

/** Map a chart API result to the collector row shape. */
export function mapChartRow(result, url) {
  const m = result?.meta || {};
  const prev = m.chartPreviousClose ?? m.previousClose;
  const price = m.regularMarketPrice;
  const change = price != null && prev != null ? price - prev : null;
  return {
    symbol: m.symbol ?? null,
    longName: m.longName ?? m.shortName ?? null,
    currency: m.currency ?? null,
    exchange: m.exchangeName ?? null,
    quoteType: m.instrumentType ?? null,
    regularMarketPrice: price ?? null,
    regularMarketChange: round(change),
    regularMarketChangePercent: round(change != null && prev ? (change / prev) * 100 : null),
    regularMarketVolume: m.regularMarketVolume ?? null,
    marketCap: null,
    fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: m.fiftyTwoWeekLow ?? null,
    regularMarketTime: m.regularMarketTime ?? null,
    url: url ?? null,
  };
}

export async function fetchChart(symbol, { timeoutMs = 20000 } = {}) {
  const res = await fetch(CHART_URL(symbol), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result || !result.meta) throw new Error(`${symbol}: no quote data returned`);
  return result;
}

/**
 * Fetch live quotes for the configured inputs.
 * @param {Array<{url?: string, symbol?: string}>} [inputs]
 * @returns {Promise<Array<object>>} rows in collector shape
 */
export async function fetchRealtimeQuotes(inputs = config.inputs) {
  const symbols = symbolsFromInputs(inputs);
  if (!symbols.length) {
    throw new Error("No symbols configured. Set SCRAPE_SYMBOLS or SCRAPE_URLS in .env.");
  }

  const settled = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const result = await fetchChart(symbol);
      return mapChartRow(result, `https://finance.yahoo.com/quote/${symbol}`);
    })
  );

  const rows = [];
  for (const [i, r] of settled.entries()) {
    if (r.status === "fulfilled") rows.push(r.value);
    else logger.warn(`Realtime quote failed for ${symbols[i]}`, { error: r.reason.message });
  }

  if (!rows.length) {
    throw new Error(`Realtime fetch failed for all ${symbols.length} symbol(s)`);
  }
  logger.info(`Fetched ${rows.length} realtime quotes`, { symbols });
  return rows;
}