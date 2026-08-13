#!/usr/bin/env node
/**
 * Interactive terminal launcher for the Finance Self-Healing Scraper.
 *
 * Usage: npm run app
 *
 * Menu-driven TUI that wraps every part of the project: scrape cycles, the
 * self-healing demo, the Llama AI analyst, the web dashboard, the daemon and
 * the collector setup. Ctrl+C quits at the menu or returns from a running
 * subprocess.
 */
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { ROOT_DIR, config } from "../src/config.js";
import { loadStatus } from "../src/state.js";
import { logger } from "../src/logger.js";

const rl = readline.createInterface({ input, output });

const BRIGHT = "\x1b[1;36m";
const GREEN = "\x1b[1;32m";
const RED = "\x1b[1;31m";
const YELLOW = "\x1b[1;33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const BANNER = `${BRIGHT}
    ▄████████ ███    █▄     ▄█   ▄█          ▄██   ▄      ▄▄▄▄███▄▄▄▄
    ███    ███ ███    ███  ███  ███          ███   ██▄   ▄█▀▄▄▄▄█▄▀█▄
    ███    █▀  ███    ███  ███  ███          ███   ██ █ ▄██▀▀██ ██▀
    ███        ███    ███  ███  ███          ███    ██▄ ███    ██
  ▀███████████ ████    ███  ███  ███▄    ▄    ███    ███ ███    ██
           ███ ███    ███  ███  ███▄  ▄██    ███   ████ ███    ██
     ███    ███ ███    ███  ███   ██████     ███ ████   ███    ██
     ██████████ ██████████  █████           ▄████████   ▀████████▀
${RESET}`;

const title = `${BOLD}Finance Self-Healing Scraper${RESET}  ·  Bright Data Scraper Studio + Llama 3.2-1B`;

function stateColor(state) {
  if (state === "healthy") return GREEN;
  if (state === "healed") return BRIGHT;
  if (state === "broken" || state === "error") return RED;
  return YELLOW;
}

function statusLine() {
  const s = loadStatus();
  if (!s) return `${YELLOW}status:${RESET} no runs yet (run a scrape cycle or seed demo data)`;
  const color = stateColor(s.state);
  const when = s.ts ? new Date(s.ts).toLocaleString() : "?";
  return `${color}status: ${s.state}${RESET} ${DIM}· ${s.totalRows ?? 0} rows · ${when}${RESET} ${
    s.summary ? `\n${DIM}  ${s.summary}${RESET}` : ""
  }`;
}

function collectorLine() {
  const key = config.apiKey ? "key set" : "no API key";
  const cid = config.collectorId || "not created yet";
  const ok = config.apiKey && config.collectorId;
  const dot = ok ? GREEN : RED;
  return `${dot}●${RESET} collector: ${BRIGHT}${cid}${RESET} ${DIM}(${key})${RESET}`;
}

function banner() {
  console.clear();
  console.log(BANNER);
  console.log(title);
  console.log(DIM + "─".repeat(60) + RESET);
  console.log(statusLine());
  console.log(collectorLine());
  console.log(DIM + "─".repeat(60) + RESET);
}

const MENU = [
  "Run a scrape cycle  (validate + self-heal)",
  "AI analyst  (ask the Llama model)",
  "Start web dashboard",
  "Start scheduled daemon",
  "Offline self-healing demo",
  "Seed demo data  (fake history for the dashboard)",
  "Show latest status",
  "Create the Yahoo Finance collector",
  "Quit",
];

function menu() {
  banner();
  MENU.forEach((label, i) => console.log(`  ${BRIGHT}${i + 1}${RESET}) ${label}`));
}

async function pause() {
  await rl.question(`${DIM}Press Enter to continue…${RESET}`);
}

/** Run a child process full-screen; Ctrl+C returns to the menu. */
function runChild(args, label) {
  return new Promise((resolve) => {
    console.clear();
    console.log(`${BRIGHT}── ${label} ──${RESET}`);
    console.log(`${DIM}Press Ctrl+C to stop and return to the menu.${RESET}\n`);

    const child = spawn("node", args, { cwd: ROOT_DIR, stdio: "inherit" });

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      process.removeListener("SIGINT", onSigint);
      child.kill();
      resolve();
    };
    const onSigint = () => stop();
    process.on("SIGINT", onSigint);

    child.on("exit", (code) => {
      process.removeListener("SIGINT", onSigint);
      console.log(`\n${DIM}process exited (code ${code})${RESET}`);
      resolve();
    });
  });
}

async function runScrapeCycle() {
  try {
    const { runCycle } = await import("../src/pipeline.js");
    const source = config.apiKey && config.collectorId ? "Bright Data collector" : "Yahoo realtime (free, no key)";
    console.log(`${DIM}source: ${source}${RESET}\n`);
    const result = await runCycle();
    const color = stateColor(result.state);
    console.log(`\n${color}── cycle: ${result.state} ──${RESET}`);
    console.log(`${result.summary}  ${DIM}(attempts: ${result.attempts})${RESET}`);
  } catch (err) {
    console.log(`\n${RED}── failed ──${RESET}`);
    console.log(`${err.message}`);
    if (err.message.includes("BRIGHTDATA_API_KEY") || err.message.includes("COLLECTOR_ID")) {
      console.log(`${YELLOW}Tip:${RESET} option 8 creates a collector, or leave creds unset to use the free Yahoo realtime source.`);
    }
  }
  await pause();
}

async function askAnalyst() {
  const defaultQ =
    "Which ticker looks strongest and which weakest today? Summarize the market tone with specific numbers.";
  const q = await rl.question(
    `\n${BRIGHT}Your question${RESET} ${DIM}(Enter for default)${RESET}:\n> `
  );
  const question = (q || "").trim() || defaultQ;

  console.log(`${DIM}Loading Llama 3.2-1B… first run takes ~30-60s.${RESET}`);
  try {
    const { Analyst, appendAnalysis } = await import("../src/analyst.js");
    const result = await Analyst.oneShot({ question });
    const record = { ts: new Date().toISOString(), question, ...result };
    appendAnalysis(record);
    console.log(`\n${GREEN}── analysis ──${RESET}`);
    console.log(result.text);
    console.log(`${DIM}\n(${result.tokens} tokens · generated in ${result.elapsed_s}s)${RESET}`);
  } catch (err) {
    console.log(`${RED}Analyst failed: ${err.message}${RESET}`);
    if (!process.env.SKIP_HINT)
      console.log(`${YELLOW}Tip:${RESET} run ${BOLD}npm run setup-llm${RESET} first, then place the model in ./llama3.2-1b`);
  }
  await pause();
}

async function createCollector() {
  const { spawn: _spawn } = await import("node:child_process");
  const npxArgs = ["-y", "-p", "@brightdata/cli", "bdata", "scraper", "create"];
  await new Promise((resolve) => {
    console.clear();
    console.log(`${BRIGHT}── Building collector with the Bright Data AI Agent ──${RESET}`);
    console.log(`${DIM}This takes 5-15 minutes. Log in first with: npx -p @brightdata/cli bdata login${RESET}\n`);
    const child = _spawn("npx", npxArgs, {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, BRIGHTDATA_API_KEY: config.apiKey },
    });
    child.on("exit", () => resolve());
  });
  console.log(`${YELLOW}\nCopy the c_... Collector ID printed above into .env as COLLECTOR_ID=${RESET}`);
  await pause();
}

const ACTIONS = {
  1: runScrapeCycle,
  2: askAnalyst,
  3: () => runChild(["dashboard/server.js"], "Web dashboard — http://localhost:" + config.dashboardPort),
  4: () => runChild(["bin/daemon.js"], `Scheduled daemon (every ${config.daemonIntervalSeconds}s)`),
  5: () => runChild(["scripts/demo-cycle.js"], "Offline self-healing demo"),
  6: () => runChild(["scripts/seed-data.js"], "Seeding demo data"),
  7: () => {
    banner();
    pause();
  },
  8: createCollector,
};

async function loop() {
  while (true) {
    menu();
    const raw = await rl.question(`\n${BRIGHT}Choose [1-${MENU.length}]${RESET}: `);
    const choice = parseInt(raw, 10);
    const action = ACTIONS[choice];
    if (!action) {
      console.log(`${RED}Invalid choice.${RESET}`);
      continue;
    }
    if (choice === MENU.length) break;
    try {
      await action();
    } catch (err) {
      logger.error("Menu action failed", { error: err.message });
      await pause();
    }
  }
  rl.close();
  console.log("\nBye!");
}

loop();
