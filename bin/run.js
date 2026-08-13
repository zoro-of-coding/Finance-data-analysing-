#!/usr/bin/env node
import { runCycle } from "../src/pipeline.js";
import { logger } from "../src/logger.js";

// Exit codes: 0 healthy/healed, 1 workflow error, 2 broken after heal
async function main() {
  const result = await runCycle();
  logger.info("FINAL", { state: result.state, summary: result.summary, attempts: result.attempts });
  process.exitCode = result.state === "broken" ? 2 : 0;
}

main().catch((err) => {
  logger.error("Cycle failed", {
    error: err instanceof Error ? err.message : String(err),
    code: err?.code,
  });
  process.exitCode = 1;
});
