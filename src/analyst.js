import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { ROOT_DIR, config, ensureDataDir } from "./config.js";
import { loadSnapshots, loadLastSnapshot } from "./state.js";
import { logger } from "./logger.js";

const ANALYSES_FILE = "analyses.jsonl";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = (v) => fmt.format(v ?? 0);
const sign = (v) => (v > 0 ? "+" : "") + fmt.format(v ?? 0);

function priceSeries(snapshots, symbol, limit = 6) {
  return snapshots
    .slice(0, limit)
    .reverse()
    .map((s) => {
      const row = s.rows.find((r) => r.symbol === symbol);
      return row && row.regularMarketPrice != null ? row.regularMarketPrice : null;
    })
    .filter((v) => v !== null);
}

/**
 * Build a token-efficient textual market snapshot from the latest scraped data.
 * @param {string|null} question
 */
export function buildSnapshotText(question = null) {
  const latest = loadLastSnapshot();
  const history = loadSnapshots(30);
  if (!latest || !latest.length) {
    return "No market data yet. Run the scraper first (`npm start`).";
  }

  const lines = [];
  const asOf = history[0]?.fetchedAt || new Date().toISOString();
  lines.push(`MARKET SNAPSHOT (collected ${asOf})`);
  lines.push("");

  for (const row of latest) {
    const sym = row.symbol || row.url?.split("/").pop();
    const series = priceSeries(history, row.symbol);
    const trend = series.length
      ? series.map((p) => compact(p)).join(" -> ")
      : "n/a";
    lines.push(
      [
        `- ${sym || "?"}`,
        row.longName ? `"${row.longName}"` : null,
        `price=${compact(row.regularMarketPrice)}`,
        `change=${sign(row.regularMarketChange)} (${sign(row.regularMarketChangePercent)}%)`,
        `volume=${compact(row.regularMarketVolume)}`,
        `marketCap=${compact(row.marketCap)}`,
        `52wk=${compact(row.fiftyTwoWeekLow)}-${compact(row.fiftyTwoWeekHigh)}`,
        `recent=${trend}`,
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  if (question) {
    lines.push("");
    lines.push("QUESTION:");
    lines.push(question);
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are a quantitative market analyst. Be direct and specific. Base every claim on " +
  "the actual numbers in the snapshot (price, change %, volume, 52-week range). Structure " +
  "your answer with short sections: Momentum, Standouts, Risks, Verdict. Keep the whole " +
  "answer under 200 words. Never invent figures that are not in the snapshot. If data is " +
  "missing, say so. End with a one-line disclaimer that this is not financial advice.";

/**
 * Persistent, lazy Llama 3.2-1B subprocess client.
 */
export class Analyst {
  constructor() {
    this.child = null;
    this.lines = null;
    this.readyPromise = null;
    this.busy = false;
    this.pending = new Map();
    this.modelDir = config.llmModelDir;
  }

  _spawn() {
    const args = ["llm/analyst.py", "--model", this.modelDir, "--server"];
    this.child = spawn(config.pythonBin, args, {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.child.stderr.on("data", (d) => logger.debug("analyst[stderr]", { line: String(d).trim() }));
    this.child.on("exit", (code) => {
      logger.warn("Analyst process exited", { code });
      this.child = null;
      this.busy = false;
      // Fail any in-flight request instead of hanging.
      for (const [, resolve] of this.pending) resolve({ text: "", tokens: 0, elapsed_s: 0, error: "process exited" });
      this.pending.clear();
    });
  }

  _waitReady() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      this.lines.once("line", (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.status === "ready") resolve();
          else reject(new Error("Analyst failed to start: " + line));
        } catch (err) {
          reject(err);
        }
      });
      this.child.once("exit", () => reject(new Error("Analyst exited before ready")));
    });
    return this.readyPromise;
  }

  /** Ensure the model process is up; returns once the model is resident. */
  async ensureReady() {
    if (this.child) {
      try {
        await this.readyPromise;
        return;
      } catch {
        this._reset();
      }
    }
    this._spawn();
    return this._waitReady();
  }

  _reset() {
    if (this.child) this.child.kill();
    this.child = null;
    this.lines = null;
    this.readyPromise = null;
    this.busy = false;
  }

  /**
   * Ask the model to analyze the latest snapshot.
   * @param {object} opts { question?, maxTokens?, timeoutMs? }
   */
  async analyze(opts = {}) {
    const { question = null, maxTokens = 220, timeoutMs = 5 * 60 * 1000 } = opts;
    await this.ensureReady();

    const snapshot = buildSnapshotText(question);
    const request = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: snapshot },
      ],
      max_tokens: maxTokens,
    };

    const result = await new Promise((resolve, reject) => {
      const requestId = Symbol();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Analyst timed out"));
      }, timeoutMs);
      this.pending.set(requestId, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      this.lines.once("line", (line) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        try {
          const parsed = JSON.parse(line);
          resolve(parsed.error ? { ...parsed, error: parsed.error } : parsed);
        } catch {
          resolve({ error: "invalid model response" });
        }
      });
      this.child.stdin.write(JSON.stringify(request) + "\n");
    });

    if (result.error) throw new Error("Analyst error: " + result.error);
    return { ...result, snapshot };
  }

  /** One-shot convenience without a persistent process. */
  static async oneShot(opts = {}) {
    const a = new Analyst();
    try {
      return await a.analyze(opts);
    } finally {
      a._reset();
    }
  }

  stop() {
    this._reset();
  }
}

// ---- Persistence --------------------------------------------------------------

export function appendAnalysis(record) {
  fs.appendFileSync(path.join(ensureDataDir(), ANALYSES_FILE), JSON.stringify(record) + "\n");
}

export function latestAnalysis() {
  const target = path.join(ensureDataDir(), ANALYSES_FILE);
  if (!fs.existsSync(target)) return null;
  const lines = fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
}
