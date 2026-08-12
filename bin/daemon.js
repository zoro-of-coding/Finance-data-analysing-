#!/usr/bin/env node
import { runCycle } from "../src/pipeline.js";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  logger.info(`Daemon started: cycle every ${config.daemonIntervalSeconds}s`);
  while (true) {
    const startedAt = Date.now();
    try {
      const result = await runCycle();
      logger.info("Cycle done", { state: result.state });
    } catch (err) {
      logger.error("Cycle failed", { error: err.message, code: err.code });
    }
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, config.daemonIntervalSeconds * 1000 - elapsed);
    await sleep(wait);
  }
}

loop();
