#!/usr/bin/env node
/**
 * Run a one-shot analysis of the latest scraped data with the local Llama model.
 *
 * Usage: npm run analyst -- --question "Which ticker looks strongest today?"
 */
import { Analyst, appendAnalysis } from "../src/analyst.js";
import { logger } from "../src/logger.js";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const DEFAULT_QUESTION =
  "Which ticker in this snapshot looks the strongest and which the weakest today? " +
  "Summarize the overall market tone in 2-3 sentences with specific numbers.";

async function main() {
  const question = flag("--question") || flag("-q") || DEFAULT_QUESTION;
  const maxTokens = Number(flag("--max-tokens") || 220);

  logger.info("Starting local analyst (model loads once, this can take ~30-60s)...");
  const result = await Analyst.oneShot({ question, maxTokens });

  const record = {
    ts: new Date().toISOString(),
    question,
    ...result,
  };
  appendAnalysis(record);

  console.log("\n--- QUESTION ---");
  console.log(question);
  console.log("\n--- ANALYSIS ---");
  console.log(result.text);
  console.log(`\n(tokens: ${result.tokens}, generation: ${result.elapsed_s}s)`);
}

main().catch((err) => {
  logger.error("Analyst failed", { error: err.message });
  process.exitCode = 1;
});
