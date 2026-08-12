/**
 * Turn raw Scraper Studio rows into dashboard-friendly insights.
 * Pure functions: no I/O, trivially testable.
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function enrichRow(row) {
  const price = num(row.regularMarketPrice);
  const change = num(row.regularMarketChange);
  const pct = num(row.regularMarketChangePercent);
  return {
    ...row,
    _price: price,
    _change: change,
    _changePct: pct,
    _name: row.longName || row.symbol || row.url || "Unknown",
    _symbol: (row.symbol || row.ticker || "").toUpperCase() || (row.url || "").split("/").pop(),
  };
}

export function buildInsights(rows) {
  const enriched = rows.map(enrichRow);

  const withChange = enriched.filter((r) => r._changePct !== null);
  const sorted = [...withChange].sort((a, b) => b._changePct - a._changePct);

  const avgPct = withChange.length
    ? withChange.reduce((s, r) => s + r._changePct, 0) / withChange.length
    : null;

  return {
    fetchedAt: new Date().toISOString(),
    totalTickers: enriched.length,
    avgChangePct: avgPct,
    topGainers: sorted.slice(0, 5),
    topLosers: sorted.slice(-5).reverse(),
    rows: enriched,
  };
}

export function summarize(insights) {
  return {
    totalTickers: insights.totalTickers,
    avgChangePct: insights.avgChangePct,
    gainers: insights.topGainers.map((r) => `${r._symbol} ${r._changePct?.toFixed?.(2) ?? "-"}%`),
    losers: insights.topLosers.map((r) => `${r._symbol} ${r._changePct?.toFixed?.(2) ?? "-"}%`),
  };
}
