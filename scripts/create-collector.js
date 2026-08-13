#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_PROMPT =
  "Extract real-time Yahoo Finance quote data from each quote page: symbol, longName, regularMarketPrice, regularMarketChange, regularMarketChangePercent, regularMarketVolume, marketCap, currency, fiftyTwoWeekHigh, fiftyTwoWeekLow, regularMarketTime. Output one row per URL.";

const TARGET_URL = process.env.COLLECTOR_TARGET_URL || "https://finance.yahoo.com/quote/AAPL";
const PROMPT = process.env.COLLECTOR_PROMPT || DEFAULT_PROMPT;

function run(cmd, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: true,
      env: { ...process.env, BRIGHTDATA_API_KEY: process.env.BRIGHTDATA_API_KEY || "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let errOut = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out after ${timeoutMs / 60000} minutes`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      errOut += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, errOut });
    });
    child.on("error", reject);
  });
}

function writeEnvVar(key, value) {
  const envPath = path.join(ROOT, ".env");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  } else {
    fs.copyFileSync(path.join(ROOT, ".env.example"), envPath);
    content = fs.readFileSync(envPath, "utf8");
  }
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  content = re.test(content) ? content.replace(re, line) : content + `\n${line}`;
  fs.writeFileSync(envPath, content);
  return envPath;
}

async function main() {
  if (!process.env.BRIGHTDATA_API_KEY && !process.env.BRIGHTDATA_LOGGED_IN) {
    console.log(
      [
        "No BRIGHTDATA_API_KEY set.",
        "Run `npx -p @brightdata/cli bdata login` once to authenticate, then re-run this script.",
        "or set BRIGHTDATA_API_KEY in .env and re-run.",
      ].join("\n")
    );
  }

  console.log("Building Yahoo Finance scraper via Bright Data AI Agent...");
  console.log(`Target: ${TARGET_URL}`);
  console.log("This takes 5-15 minutes. Watching progress...\n");

  const { code } = await run("npx", ["-y", "-p", "@brightdata/cli", "bdata", "scraper", "create", TARGET_URL, PROMPT]);

  if (code !== 0) {
    console.error("\nCollector creation failed.");
    process.exit(1);
  }

  console.log("\nCollector built. Find the Collector ID (c_...) in the output above.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
