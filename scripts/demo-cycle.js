#!/usr/bin/env node
/**
 * Offline demo of the full self-healing cycle.
 *
 * Simulates: site breaks -> validation fails -> healer fixes it -> re-scrape
 * returns healthy data -> pipeline reports "healed". Uses fixtures, no API
 * calls, no credits.
 *
 * Usage: npm run demo
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCycle } from "../src/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Offline demo: no real credentials, scratch data dir, one symbol each for AAPL/MSFT/NVDA.
process.env.BRIGHTDATA_API_KEY = "demo";
process.env.COLLECTOR_ID = "c_demo";
process.env.SCRAPE_SYMBOLS = "AAPL,MSFT,NVDA";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scraper-demo-"));
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));

function demoDeps() {
  let phase = "broken"; // first scrape returns broken data
  let healCalls = 0;
  return {
    triggerCollector: async () => `j_demo_${Date.now()}`,
    fetchDataset: async () => (phase === "broken" ? fixture("yahoo-broken.json") : fixture("yahoo-good.json")),
    runHealing: async (collectorId, report) => {
      healCalls++;
      phase = "healed"; // heal worked; next scrape returns good data
      return { healed: true, reason: `demo heal #${healCalls}` };
    },
    _healCalls: () => healCalls,
  };
}

async function main() {
  console.log("=== Self-healing pipeline demo (offline) ===\n");
  console.log("Phase 1: site breaks -> collector returns null prices everywhere");
  console.log("Phase 2: validation flags the breakage -> self-heal triggers");
  console.log("Phase 3: healed collector re-scrapes -> data healthy again\n");

  const deps = demoDeps();
  const result = await runCycle({ deps });

  console.log("\n=== Result ===");
  console.log(JSON.stringify(
    {
      state: result.state,
      summary: result.summary,
      healAttempts: result.attempts,
      healInvocations: deps._healCalls(),
      rowsRecovered: result.totalRows,
    },
    null,
    2
  ));

  if (result.state !== "healed") {
    console.error("Demo expected state=healed but got", result.state);
    process.exit(2);
  }
  console.log("\nDemo passed: pipeline detected breakage, healed the collector, recovered data.");
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
