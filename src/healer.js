import { healCollector, healProgress, resumeHeal } from "./brightdata.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { HealFailure } from "./errors.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DONE = new Set(["done", "ready", "completed", "success", "finished"]);
const FAILED = new Set(["failed", "error", "cancelled"]);

/**
 * Build a concise, specific heal prompt from a validation report.
 * Kept <= 1000 chars per the API contract. Includes concrete field names and
 * the URL(s) being scraped so the AI re-targets the right selectors.
 */
export function buildHealPrompt(report, symbols) {
  const parts = [
    "The Yahoo Finance scraper stopped returning valid data.",
  ];

  for (const c of report.checks.filter((c) => !c.pass)) {
    parts.push(`- ${c.name}: ${c.detail}`);
  }
  for (const issue of report.rowIssues.slice(0, 3)) {
    parts.push(
      `- row ${issue.label}: missing=[${issue.missing.join(", ")}]` +
        (issue.typeIssues.length ? ` type=[${issue.typeIssues.join(", ")}]` : "")
    );
  }

  const target = symbols.length ? symbols.join(", ") : "the configured quote pages";
  parts.push(
    `Please re-capture the quote fields (symbol, longName, regularMarketPrice, regularMarketChange, regularMarketChangePercent, regularMarketVolume, marketCap, fiftyTwoWeekHigh, fiftyTwoWeekLow) from the current markup of ${target}. Keep the output schema identical.`
  );

  return parts.join("\n").slice(0, 1000);
}

export function extractSymbolsFromInputs(inputs) {
  const symbols = [];
  for (const input of inputs || []) {
    const m = String(input.url || "").match(/quote\/([A-Za-z.\-^]+)/);
    if (m) symbols.push(m[1]);
  }
  return symbols;
}

/**
 * Run the full self-healing flow against a collector.
 * @returns {Promise<{healed: boolean, reason: string}>}
 */
export async function runHealing(collectorId, report, inputs) {
  const symbols = extractSymbolsFromInputs(inputs);
  const prompt = buildHealPrompt(report, symbols);

  logger.warn("Triggering self-healing", { collectorId, promptLength: prompt.length });
  await healCollector(collectorId, prompt, inputs);

  const deadline = Date.now() + config.pollTimeoutMs;
  while (Date.now() < deadline) {
    const progress = await healProgress(collectorId);
    const status = String(progress?.status || "").toLowerCase();
    const step = String(progress?.step || "").toLowerCase();

    if (DONE.has(status)) {
      logger.info("Self-healing completed");
      return { healed: true, reason: "heal completed" };
    }
    if (FAILED.has(status)) {
      throw new HealFailure(`heal job ${status}: ${progress?.error || "unknown error"}`);
    }
    if (status === "pending_answer" || step === "user_approval") {
      if (config.autoApprove) {
        logger.info("Approving proposed fix (AUTO_APPROVE=true)");
        await resumeHeal(collectorId, true, true);
        continue;
      }
      // Stop and wait for a human to approve in the Scraper Studio UI.
      return { healed: false, reason: "awaiting_user_approval" };
    }

    await sleep(config.pollIntervalMs);
  }

  throw new HealFailure("heal job timed out");
}
