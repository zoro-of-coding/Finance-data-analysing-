import { triggerCollector, fetchDataset } from "./brightdata.js";
import { runHealing } from "./healer.js";
import { validateRows } from "./validator.js";
import { config, requireCollector } from "./config.js";
import { logger } from "./logger.js";
import { PipelineError, ValidationFailure } from "./errors.js";
import { appendCycle, writeStatus, saveSnapshot, loadLastSnapshot } from "./state.js";
import { sendAlert, buildAlertPayload } from "./alert.js";
import { buildInsights } from "./analytics.js";

const defaultDeps = { triggerCollector, fetchDataset, runHealing };

const validatorOpts = () => ({
  requiredFields: config.requiredFields,
  minFieldFillRate: config.minFieldFillRate,
  maxBadRows: config.maxBadRows,
  prevRows: loadLastSnapshot(),
});

async function scrapeOnce(deps, collectorId) {
  const snapshotId = await deps.triggerCollector(collectorId, config.inputs);
  return deps.fetchDataset(snapshotId);
}

/**
 * One full cycle: scrape -> validate -> heal (if needed) -> re-verify.
 *
 * @param {object} [opts.deps] injected I/O for offline demo/tests
 * @returns {Promise<CycleResult>}
 */
export async function runCycle(opts = {}) {
  const deps = { ...defaultDeps, ...(opts.deps || {}) };
  requireCollector();
  const collectorId = config.collectorId;

  logger.info(`Cycle started for collector ${collectorId}`, { inputs: config.inputs.length });

  // ---- 1. Initial scrape ------------------------------------------------------
  let rows;
  try {
    rows = await scrapeOnce(deps, collectorId);
  } catch (err) {
    const result = {
      state: "error",
      ts: new Date().toISOString(),
      summary: `trigger/fetch failed: ${err.message}`,
      totalRows: 0,
      collectorId,
      attempts: 0,
    };
    persist(result, rows ?? []);
    throw new PipelineError(err.message, "FETCH_FAILED", err);
  }

  // ---- 2. Validate -------------------------------------------------------------
  let report = validateRows(rows, validatorOpts());
  logger.info("Initial validation", { healthy: report.healthy, summary: report.summary });

  let attempts = 0;

  // ---- 3. Self-heal loop ---------------------------------------------------------
  if (!report.healthy && config.autoHeal) {
    while (attempts < config.maxHealAttempts && !report.healthy) {
      attempts++;
      logger.warn(`Heal attempt ${attempts}/${config.maxHealAttempts}`);

      let healOutcome;
      try {
        healOutcome = await deps.runHealing(collectorId, report, config.inputs);
      } catch (err) {
        logger.error("Healing threw", { error: err instanceof Error ? err.message : String(err) });
        break;
      }

      if (!healOutcome.healed) {
        const result = {
          state: "awaiting_approval",
          ts: new Date().toISOString(),
          summary: healOutcome.reason,
          totalRows: rows.length,
          collectorId,
          attempts,
        };
        persist(result, rows);
        return result;
      }

      try {
        rows = await scrapeOnce(deps, collectorId);
      } catch (err) {
        logger.error("Re-scrape after heal failed", { error: err.message });
        break;
      }

      report = validateRows(rows, validatorOpts());
      logger.info("Post-heal validation", { healthy: report.healthy, summary: report.summary });
    }
  }

  // ---- 4. Finalize ----------------------------------------------------------------
  const state = report.healthy ? (attempts ? "healed" : "healthy") : "broken";
  const result = {
    state,
    ts: new Date().toISOString(),
    summary: report.summary,
    totalRows: rows.length,
    collectorId,
    attempts,
    healedAttempts: attempts,
  };
  persist(result, rows);

  if (state === "broken") {
    throw new ValidationFailure(report);
  }

  logger.info(`Cycle finished: ${state}`, { summary: report.summary, attempts });
  return { ...result, rows, report };
}

function persist(result, rows) {
  const insights = buildInsights(rows);
  const status = {
    ...result,
    insights: summarizeInsights(insights),
  };
  writeStatus(status);
  appendCycle(status);
  if (rows.length) saveSnapshot(rows, { state: result.state });
  if (result.state !== "healthy") {
    sendAlert(buildAlertPayload(status)).catch(() => {});
  }
}

function summarizeInsights(insights) {
  return {
    avgChangePct: insights.avgChangePct,
    topGainers: insights.topGainers.map((r) => ({ symbol: r._symbol, pct: r._changePct })),
    topLosers: insights.topLosers.map((r) => ({ symbol: r._symbol, pct: r._changePct })),
  };
}

export { buildInsights };
