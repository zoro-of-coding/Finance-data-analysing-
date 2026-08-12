/**
 * Self-healing detection engine.
 *
 * Turns a raw Scraper Studio dataset into a `ValidationReport`. The pipeline
 * uses this report to decide whether to trigger `heal`:
 *
 *   healthy                    -> keep going, record the snapshot
 *   soft failures (warnings)   -> record but flag; optional heal
 *   hard failures              -> run the self-healing flow
 */

export const DEFAULT_FIELD_TYPES = {
  symbol: "string",
  longName: "string",
  currency: "string",
  exchange: "string",
  quoteType: "string",
  regularMarketPrice: "number",
  regularMarketChange: "number",
  regularMarketChangePercent: "number",
  regularMarketVolume: "number",
  marketCap: "number",
  regularMarketTime: "number",
  fiftyTwoWeekHigh: "number",
  fiftyTwoWeekLow: "number",
};

const isFilled = (v) =>
  v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

const matchesType = (v, type) => {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "string") return typeof v === "string" && v.trim().length > 0;
  if (type === "integer") return Number.isInteger(v);
  if (type === "boolean") return typeof v === "boolean";
  return true;
};

function check(name, pass, severity, detail) {
  return { name, pass, severity, detail };
}

/**
 * @param {Array<object>} rows     dataset returned by the collector
 * @param {object} opts
 * @returns {ValidationReport}
 */
export function validateRows(rows, opts = {}) {
  const {
    requiredFields = [],
    minFieldFillRate = 0.7,
    maxBadRows = 0,
    fieldTypes = DEFAULT_FIELD_TYPES,
    prevRows = null,
  } = opts;

  const checks = [];
  let badRows = 0;
  const rowIssues = [];

  // ---- 1. Empty dataset ----------------------------------------------------
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      healthy: false,
      summary: "Dataset returned zero rows",
      checks: [check("rowCount", false, "critical", "collector returned no rows")],
      badRows: 0,
      totalRows: 0,
      rowIssues: [],
    };
  }

  // ---- 2. Schema drift -----------------------------------------------------
  // Keys expected: those present in the majority of rows (robust to optional
  // fields that some rows legitimately omit).
  const keyCounts = new Map();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }
  }
  const expectedKeys = [...keyCounts.entries()]
    .filter(([, count]) => count >= Math.ceil(rows.length / 2))
    .map(([key]) => key);

  const schemaOk = expectedKeys.length > 0;
  checks.push(
    check("schema", schemaOk, "critical",
      schemaOk
        ? `expected ${expectedKeys.length} keys: ${expectedKeys.join(", ")}`
        : "no stable keys detected across rows")
  );

  // ---- 3. Per-row completeness + types --------------------------------------
  for (const row of rows) {
    const missing = requiredFields.filter((f) => !isFilled(row[f]));
    const typeIssues = expectedKeys
      .filter((k) => fieldTypes[k] && isFilled(row[k]))
      .filter((k) => !matchesType(row[k], fieldTypes[k]));

    const present = expectedKeys.filter((k) => isFilled(row[k])).length;
    const fillRate = expectedKeys.length ? present / expectedKeys.length : 0;
    const label = row.symbol || row.ticker || row.url || "(unknown row)";

    if (missing.length || typeIssues.length || fillRate < minFieldFillRate) {
      badRows++;
      rowIssues.push({
        label,
        missing,
        typeIssues: typeIssues.map((k) => `${k}=${row[k]}`),
        fillRate: Number(fillRate.toFixed(2)),
      });
    }
  }

  checks.push(
    check("completeness", badRows === 0, "critical",
      `${badRows}/${rows.length} rows unusable`)
  );

  if (badRows > maxBadRows) {
    checks.push(
      check("badRowLimit", false, "critical",
        `maxBadRows=${maxBadRows}, saw ${badRows}`)
    );
  }

  // ---- 4. Value sanity -------------------------------------------------------
  const priceIssues = rows.filter(
    (r) => isFilled(r.regularMarketPrice) && r.regularMarketPrice <= 0
  );
  if (priceIssues.length) {
    checks.push(
      check("priceSanity", false, "warning",
        `${priceIssues.length} row(s) have non-positive price`)
    );
  }

  // ---- 5. Staleness vs previous snapshot ------------------------------------
  // If the market moved but every tracked field is byte-identical across a
  // full run, the scraper is almost certainly serving a cached/stale page.
  if (prevRows && Array.isArray(prevRows) && prevRows.length === rows.length) {
    const trackKeys = Object.keys(DEFAULT_FIELD_TYPES);
    const frozen = rows.every((row, i) => {
      const prev = prevRows[i];
      return trackKeys.every((k) => (isFilled(prev[k]) ? row[k] === prev[k] : true));
    });
    if (frozen) {
      checks.push(
        check("staleness", false, "warning",
          "all tracked fields identical to previous run — possible stale/cached page")
      );
    }
  }

  // ---- Aggregate --------------------------------------------------------------
  const hard = checks.filter((c) => !c.pass && c.severity === "critical");
  const warnings = checks.filter((c) => !c.pass && c.severity === "warning");
  const healthy = hard.length === 0;

  return {
    healthy,
    summary: healthy
      ? `healthy (${rows.length} rows, ${warnings.length} warning${warnings.length === 1 ? "" : "s"})`
      : `unhealthy (${hard.length} critical check${hard.length === 1 ? "" : "s"} failed, ${badRows}/${rows.length} bad rows)`,
    checks,
    badRows,
    totalRows: rows.length,
    rowIssues,
  };
}
