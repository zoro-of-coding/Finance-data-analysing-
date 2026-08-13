/**
 * Normalize raw Bright Data collector rows into the plain flat schema the
 * validator, dashboard and analyst expect.
 *
 * The AI-built Yahoo Finance collector returns pretty-printed shapes such as:
 *
 *   regularMarketPrice: { value: 492.43, currency: "USD", symbol: "$" }
 *   regularMarketChangePercent: "(-2.26%)"
 *   marketCap: "3.657T"
 *   regularMarketTime: "At close: August 12 at 4:00:01 PM EDT"
 *
 * This turns every numeric field into a plain number (or null) so validation
 * type rules can be applied uniformly.
 */

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** Strip wrapping parens/spaces the collector sometimes adds, e.g. "(NVDA)". */
function symbol(v) {
  if (typeof v !== "string") return v ?? null;
  const cleaned = v.trim().replace(/^\(+|\)+$/g, "");
  return cleaned || null;
}

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "value" in v) return num(v.value);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\(?\s*[+-]?\d+(?:\.\d+)?\s*%?\s*\)?\s*$/.test(s)) {
    const n = Number(s.replace(/[()%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  // "$12.34", "-5.6%" style already covered; "3.657T" / "882.3B" style:
  const suff = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([KMBTkmbt])$/);
  if (suff) return Number(suff[1]) * (SUFFIX[suff[2].toLowerCase()] ?? 1);
  const comma = Number(s.replace(/,/g, ""));
  return Number.isFinite(comma) ? comma : null;
}

/** Turn a "At close: August 12 at 4:00:01 PM EDT"-style string into a unix ts. */
function timeSec(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    // "At close: August 12 at 4:00:01 PM EDT" — rebuild a parseable date.
    const m = v.match(
      /(\w+)\s+(\d{1,2})\s+at\s+(\d{1,2}:\d{2}:\d{2})\s+([AP]M)/i
    );
    if (m) {
      const year = new Date().getFullYear();
      const rebuilt = `${m[1]} ${m[2]}, ${year} ${m[3]} ${m[4].toUpperCase()}`;
      const p = Date.parse(rebuilt);
      if (!Number.isNaN(p)) return Math.floor(p / 1000);
    }
    // Fall back to the collector's numeric time if it was stringified.
    const n = num(v);
    return n !== null && n > 0 ? n : null;
  }
  return null;
}

/** one raw collector row -> flat row */
export function normalizeRow(raw) {
  return {
    symbol: symbol(raw.symbol),
    longName: raw.longName ?? raw.shortName ?? null,
    currency: raw.currency ?? null,
    exchange: raw.exchange ?? raw.exchangeName ?? null,
    quoteType: raw.quoteType ?? raw.instrumentType ?? null,
    regularMarketPrice: num(raw.regularMarketPrice),
    regularMarketChange: num(raw.regularMarketChange),
    regularMarketChangePercent: num(raw.regularMarketChangePercent),
    regularMarketVolume: num(raw.regularMarketVolume),
    marketCap: num(raw.marketCap),
    fiftyTwoWeekHigh: num(raw.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(raw.fiftyTwoWeekLow),
    regularMarketTime: timeSec(raw.regularMarketTime),
    url: raw.url ?? raw.input?.url ?? null,
  };
}

/** normalize every row; preserves array order */
export function normalizeRows(rows) {
  return (rows || []).map(normalizeRow);
}