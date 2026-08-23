<div align="center">

# 🏦 Finance Self-Healing Scraper

https://github.com/user-attachments/assets/71091bee-d0d8-470b-ba27-1c133d3b2604

A self-healing web-data pipeline for Yahoo Finance quotes, built on
[Bright Data Scraper Studio](https://brightdata.com) and its Self-Healing tool.

![Node](https://img.shields.io/badge/Node-18%2B-339933?style=flat-square&logo=node.js)
![Type](https://img.shields.io/badge/Type-ES%20Modules-0277bd?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
![Hackathon](https://img.shields.io/badge/Into%20the%20Scrape--Verse-2025-ff6f00?style=flat-square)

**A self-healing web-data pipeline for Yahoo Finance quotes, built on [Bright Data Scraper Studio](https://brightdata.com) and its Self-Healing tool.**

</div>

---

## 💡 What This Does

Bright Data is the data engine. Every scrape cycle runs your collector through Bright Data's realtime API (`/dca/trigger_immediate`), pulls the rows it extracts, normalizes them, validates every field, and — when the site changes and data goes bad — triggers Scraper Studio's self-healing AI to rebuild the scraper, auto-approves the fix and re-verifies. Clean data then flows to a live dashboard and a local Llama 3.2-1B analyst.

A scraper works at 9am. The site ships a redesign at 10am. By noon you're silently ingesting `null`s. This project closes that loop: it **runs the collector, validates every row, detects breakage, triggers Scraper Studio's self-healing AI, approves the fix and re-verifies** — then hands the clean data to a live dashboard.

Built for the [Into the Scrape-Verse](https://www.wemakedevs.org/hackathons/scrape-verse) hackathon (WeMakeDevs × Bright Data). Scraper Studio is the data engine; everything else is orchestration that keeps it honest.

---

## 🧠 How It Works

```
                  ┌────────────────────────────────────────────────┐
                  │            Bright Data Scraper Studio           │
                  │  (collector c_..., built by the AI Agent)       │
                  └────────────────────────────────────────────────┘
                    ▲                        ▲                 │
       POST /dca/trigger_immediate   heal + approve       get_result rows
                    │               (AI refactor)              ▼
   ┌───────────────┴───────────┐         │        ┌───────────────────┐
   │   src/pipeline.js         │         │        │  src/normalize.js │
   │   trigger → poll →         │         │        │  nested {value}  │
   │   validate → heal → verify │────────┘        │  → plain numbers  │
   └───────────────────────────┘                  │  + validator.js   │
             │                                    │  row completeness │
             ▼                                    │  schema drift     │
   ┌──────────────────────┐                       │  type checks      │
   │  data/  (history,    │   ──►  dashboard  ──►  │  staleness (frozen)│
   │  snapshots, status)  │                       └───────────────────┘
   └──────────────────────┘
```

The cycle (`npm start`) is:

1. **🔍 Scrape** — for each configured Yahoo Finance quote URL, `src/brightdata.js` triggers the Scraper Studio collector over the **realtime API** (`POST /dca/trigger_immediate`) and polls `GET /dca/get_result` until rows arrive.
2. **🔄 Normalize** — the AI-built collector returns pretty shapes like `regularMarketPrice: {value: 302.25}`, `regularMarketChangePercent: "(-2.26%)"` and `marketCap: "3.657T"`. `src/normalize.js` flattens these into plain numbers so the validator and dashboard can reason about them uniformly.
3. **✅ Validate** — every row is checked for missing required fields, low fill rate, wrong value types, non-positive prices, and **staleness** (all tracked fields byte-identical to the previous run = the scraper is serving a cached page).
4. **🩺 Heal** — if validation fails, `src/healer.js` builds a targeted plain-language prompt (under the 1000-char limit, naming the broken fields and symbols) and calls `POST /dca/collectors/{id}/refactor_template`. It polls progress and, with `AUTO_APPROVE=true`, resumes the job with `{"message": true, "auto_save": true}`. The Collector ID never changes, so nothing downstream breaks.
5. **🔁 Re-verify** — the healed collector re-scrapes and the same validation runs again. State becomes `healed` only if the data is provably good now.
6. **💾 Persist + alert** — every cycle is appended to `data/history.jsonl`, the latest snapshot is stored, `data/status.json` is rewritten, and a webhook alert fires on any non-healthy state.

Repeated failures are bounded by `MAX_HEAL_ATTEMPTS`, and a broken result raises a typed `ValidationFailure` so scheduled jobs exit non-zero instead of quietly succeeding.

---

## 🔬 How We Use Bright Data to Scrape Data

Bright Data Scraper Studio is the data engine of this project — it builds the scraper, runs it against Yahoo Finance, and repairs it when the site changes. Everything else (validation, orchestration, monitoring, the AI analyst) is code we wrote on top of it.

### 1. Build the collector — Scraper Studio AI Agent

The scraper itself is a Scraper Studio collector. We describe the data we want in plain language and the AI Agent writes the output schema and the extraction code:

```bash
npx -p @brightdata/cli bdata scraper create https://finance.yahoo.com/quote/AAPL \
  "Extract symbol, longName, regularMarketPrice, regularMarketChange,
   regularMarketChangePercent, regularMarketVolume, marketCap, currency,
   fiftyTwoWeekHigh, fiftyTwoWeekLow, regularMarketTime."
```

Under the hood that maps to two API calls (`src/brightdata.js` does the same directly): `POST /dca/collector` creates the template, then `POST /dca/collectors/{c_...}/automate_template` runs the AI generation pipeline (`planner`, `code_generator`, `output_schema_generator`, …). The result is a stable Collector ID (`c_...`) — the handle every later step uses.

Bright Data owns everything else about "scraping": proxies, IP rotation, anti-bot / CAPTCHA handling, JavaScript rendering and retries. Our code never touches a proxy or parses raw HTML.

### 2. Run it — Realtime Collection API

Each cycle triggers the collector for each quote URL over the **realtime API**, then polls for results:

```
POST /dca/trigger_immediate?collector=c_...       body: {"url":"https://finance.yahoo.com/quote/AAPL"}
GET  /dca/get_result?response_id=...              (poll until it returns a JSON array)
```

The response is structured rows matching the collector's output schema — one row per quote. The AI-built collector returns pretty-printed values (`regularMarketPrice: {value: 302.25}`, `regularMarketChangePercent: "(-2.26%)"`, `marketCap: "3.657T"`), which `src/normalize.js` flattens into plain numbers so the validator, dashboard and analyst can use them directly.

### 3. Repair it — Self-Healing AI Flow

When a site redesign makes the extraction return `null`s, our validator detects it and the healer calls the Self-Healing AI:

```
POST /dca/collectors/{c_...}/refactor_template     body: { prompt, custom_input }
GET  /dca/collectors/{c_...}/refactor_template/progress   (poll)
POST /dca/collectors/{c_...}/resume_automation_job
     body: { "message": true, "auto_save": true }          (approve + persist)
```

The AI rewrites the extraction from our prompt (which names the broken fields and the symbols, ≤ 1000 chars). Because healing edits the existing template in place, the **Collector ID never changes** — every schedule, webhook and dashboard integration keeps working across a heal.

### Summary of Bright Data touchpoints

| Bright Data surface                        | Where we use it                      |
| ------------------------------------------ | ------------------------------------ |
| Scraper Studio AI Agent (`bdata scraper create`) | Builds the Yahoo Finance collector  |
| Collection API (`/dca/trigger`, `/dca/dataset`) | Every scrape cycle                |
| Self-Healing tool + AI Flow API            | Automatic repair on validation failure |
| CLI (`bdata scraper heal/approve`)         | Manual / interactive fallback        |
| Web Unlocker / zones (via the collector)   | Unblocking + proxies, transparent to us |

> The same flow is documented in the official CLI tutorial:
> https://docs.brightdata.com/datasets/scraper-studio/build-with-the-cli

---

## 🚀 Setup (≈10 minutes)

1. **Claim the free credits** — sign up at Bright Data and enter promo code `wemakedevs` in Billing. That's $50 on top of the 5,000 free monthly credits. https://brdta.com/wemakedevs
2. **Auth** — `npm install`, then log the CLI in once (browser OAuth):
   ```bash
   npx -p @brightdata/cli bdata login
   ```
   For headless environments, export `BRIGHTDATA_API_KEY` (from Account Settings → API tokens) instead.
3. **Create the Yahoo Finance collector** (5–15 min, runs in the background):
   ```bash
   npm run create-collector
   ```
   This drives the Bright Data AI Agent to generate the scraper. Grab the `c_...` Collector ID it prints and put it in `.env`:
   ```bash
   cp .env.example .env
   # fill in BRIGHTDATA_API_KEY and COLLECTOR_ID
   ```

---

## 🎮 Run It

Get real Yahoo Finance quotes via Bright Data in three commands:

```bash
npm run app        # terminal launcher — pick options from the menu
```

or directly:

```bash
npm start          # one full scrape → validate → heal → verify cycle
npm run dashboard  # live dashboard  http://localhost:4173  (LAN: http://<PC-IP>:4173)
```

The dashboard and the local AI analyst (below) read `data/` written by the last cycle, so you can run the scrape once and explore from any device on your network.

### The launcher menu (`npm run app`)

| Option | What it does |
| ------ | ------------ |
| 1 | Run a scrape cycle (Bright Data) |
| 2 | AI analyst — ask the Llama 3.2-1B model a question |
| 3 | Start the web dashboard |
| 4 | Start the scheduled daemon (repeat cycles) |
| 5 | Offline self-healing demo (no API calls) |
| 6 | Seed demo data for a video/offline demo |
| 7 | Show the latest cycle status |
| 8 | Create a new collector (`npm run create-collector`) |
| 9 | Quit |

Ctrl+C stops a running tool and returns to the menu.

---

## 🤖 Local AI Analyst (Llama 3.2-1B)

Beyond healing, the pipeline feeds the scraped snapshot to a **local Llama 3.2-1B Instruct** model so the dashboard can answer questions about the market, grounded in the actual scraped numbers — not general boilerplate.

```
scraped rows ──► buildSnapshotText() ──► Llama 3.2-1B (local, CPU) ──► analysis
                    symbol, price, Δ%, volume, mktcap, 52wk, trend
```

1. **Install the Python deps once** (CPU-only torch + transformers, ~1 GB):
   ```bash
   npm run setup-llm
   ```
2. Drop the model folder at `./llama3.2-1b` (or point `LLM_MODEL_DIR` at it).
3. Ask it anything:
   ```bash
   npm run analyst -- --question "Which ticker is strongest today?"
   ```
   or hit **Analyze** in the dashboard.

How it works:

- `llm/analyst.py` loads the model once and keeps it resident in **server mode**, answering JSON requests over stdin/stdout. `src/analyst.js` manages that process (lazy spawn, readiness handshake, timeout + auto-restart) so the model is loaded once instead of on every question.
- The prompt is a compact textual snapshot built from the latest rows **plus the recent price trend across the last snapshots**, so the model reasons over momentum, not just one frame. A strict system prompt forbids inventing figures and ends with a "not financial advice" disclaimer.
- Every answer is appended to `data/analyses.jsonl` and surfaced in the dashboard (cached, with a regenerate button). Runs fully offline once the model is installed.

> Note: 1B is a small model — it's a demonstrator, not a Bloomberg terminal. Treat its verdicts as illustrative and always validate against the underlying data.

---

## ⚙️ Commands

| Command                  | What it does                                                        |
| ------------------------ | ------------------------------------------------------------------- |
| `npm run app`            | Interactive terminal launcher — menu for every command below        |
| `npm start` / `npm run`  | One full scrape → validate → heal → verify cycle                    |
| `npm run daemon`         | Same cycle on a schedule (`DAEMON_INTERVAL_SECONDS`)                |
| `npm run create-collector` | Build the Yahoo Finance collector via the Bright Data AI Agent    |
| `npm run dashboard`      | Local dashboard for health + prices + sparklines + AI analyst       |
| `npm run analyst`        | One-shot Llama 3.2-1B analysis of the latest snapshot               |
| `npm run setup-llm`      | Install torch (CPU) + transformers for the analyst                  |
| `npm run demo`           | Offline demo of a breakage → heal → recovery (no API calls)         |
| `npm run seed`           | Generate 42 snapshots of fake history for a demo video              |
| `npm test`               | Run the test suite (`node --test`)                                  |

### Config (`.env`)

| Variable                    | Default               | Meaning                                              |
| --------------------------- | --------------------- | ---------------------------------------------------- |
| `BRIGHTDATA_API_KEY`        | —                     | API token from Bright Data Account Settings (required) |
| `COLLECTOR_ID`              | —                     | The `c_...` scraper handle (required — from `npm run create-collector`) |
| `SCRAPE_SYMBOLS`            | `AAPL,MSFT,NVDA`      | Symbols to turn into quote URLs (default when `.env` has none) |
| `SCRAPE_URLS`               | —                     | Or provide full URLs directly                        |
| `AUTO_HEAL`                 | `true`                | Run self-healing on validation failure               |
| `AUTO_APPROVE`              | `true`                | Approve the AI's fix without a human gate            |
| `MAX_HEAL_ATTEMPTS`         | `2`                   | Stop after N consecutive failed heals                |
| `REQUIRED_FIELDS`           | `symbol,regularMarketPrice` | Fields that must be non-empty in every row     |
| `MIN_FIELD_FILL_RATE`       | `0.7`                 | Min fraction of expected fields that must be filled  |
| `ALERT_WEBHOOK_URL`         | —                     | Slack/Discord/Make-style webhook for status changes  |
| `DAEMON_INTERVAL_SECONDS`   | `3600`                | Daemon cycle interval                                |
| `DASHBOARD_PORT`            | `4173`                | Dashboard port                                       |
| `DASHBOARD_HOST`            | `0.0.0.0`             | Bind host — `0.0.0.0` exposes it on the LAN         |

---

## 🔬 What the Validator Detects

| Check        | Severity | Why it matters for finance                         |
| ------------ | -------- | -------------------------------------------------- |
| Empty dataset | critical | Site layout changed so hard nothing extracts       |
| Schema drift  | critical | Keys vanished or were renamed across rows          |
| Missing required fields | critical | `regularMarketPrice` came back `null`     |
| Type violations | critical | `regularMarketVolume` is a string like `"lots"` |
| Low fill rate | critical | Rows mostly empty — partial extraction             |
| Non-positive price | warning | Sanity guard                                      |
| **Staleness** | warning | All fields identical to last run → cached page    |

---

## 📁 Project Layout

```
bin/                 CLI entry points (run, daemon)
src/
  brightdata.js      Scraper Studio HTTP client (trigger, dataset, heal, approve)
  validator.js       Self-healing detection engine
  healer.js          Prompt building + heal/approve workflow
  pipeline.js        Orchestration: scrape → validate → heal → verify
  analyst.js         Local Llama process manager + snapshot prompting
  state.js           history.jsonl / snapshots / status.json persistence
  alert.js           Webhook alerts
  analytics.js       Dashboard insights (pure functions)
  config.js          Lazy env config (test-friendly)
llm/
  analyst.py         Python server that runs the model (load once, serve many)
  requirements.txt   CPU torch + transformers for `npm run setup-llm`
scripts/             create-collector, analyst, demo-cycle, seed-data
dashboard/           Zero-dependency HTTP dashboard (server + static UI)
llama3.2-1b/         The local Llama 3.2-1B-Instruct model (gitignored by size)
fixtures/            Sample good/broken datasets for tests + demo
test/                Node test runner tests
```

Dependency policy: one runtime dependency (`dotenv`). HTTP, files, JSON and the test runner are all Node built-ins.

---

## 🎭 Self-Healing Demo

`npm run demo` proves the loop without spending credits: it injects a *broken* dataset (every price `null`), watches validation fail, invokes the heal step, then re-scrapes *healthy* data and reports `state: healed`.

```text
Phase 1: site breaks -> collector returns null prices everywhere
Phase 2: validation flags the breakage -> self-heal triggers
Phase 3: healed collector re-scrapes -> data healthy again
{
  "state": "healed",
  "summary": "healthy (3 rows, 0 warnings)",
  "healAttempts": 1,
  "healInvocations": 1,
  "rowsRecovered": 3
}
```

---

## 📡 Notes on the Bright Data APIs Used

- **Realtime Collection API**: `POST /dca/trigger_immediate?collector={id}` (per input URL) → `GET /dca/get_result?response_id=…` polls until a JSON array is returned.
- **AI Flow — Self-Healing**: `POST /dca/collectors/{id}/refactor_template` starts a refactor; `GET …/refactor_template/progress` is polled until `done` or `pending_answer`/`user_approval`; `POST …/resume_automation_job` with `{"message": true, "auto_save": true}` approves and persists the fix in one step.

You can also run the whole thing through the official CLI (`bdata scraper heal … --auto-approve`), which wraps the same three-call loop.

---

## 🤝 Contributing

Contributions are welcome — the codebase is small on purpose and designed to be reasoned about in one sitting.

### Development setup

```bash
git clone <your-fork>
cd finance-self-healing-scraper
npm install
npm test          # node --test, 15 tests
npm run demo      # offline self-healing cycle (no API needed)
```

Create a `.env` from `.env.example`. You only need `BRIGHTDATA_API_KEY` + `COLLECTOR_ID` to run against real data; the demo, tests and dashboard all work without them.

### Where things live

| You want to change…                    | Start here                        |
| -------------------------------------- | --------------------------------- |
| A validation rule (new check, threshold) | `src/validator.js`               |
| The heal prompt wording                | `src/healer.js` → `buildHealPrompt` |
| The scrape/heal HTTP calls             | `src/brightdata.js`               |
| The AI analyst prompt or snapshot text | `src/analyst.js`                  |
| The pipeline state machine             | `src/pipeline.js`                 |
| Dashboard UI/API                       | `dashboard/` (`public/` + `server.js`) |

### Guidelines

- **Node 18+**, ES modules, no build step. Keep the runtime dependency list at exactly one (`dotenv`) unless there's a strong reason — that keeps installs fast and the review diff small.
- **Lazy config**: add any new setting as a getter in `src/config.js` (reads `process.env` at access time). It's what keeps the test suite hermetic.
- **Pure where possible**: validation and analytics are pure functions over rows. Keep I/O (files, network, subprocesses) in the modules that already own it.
- **Test what you touch**: add a case in `test/` using the Node built-in runner. Pipeline tests inject fake `deps` so they never hit the network.
- **Type the failures**: throw `PipelineError` / `ApiError` / `ValidationFailure` / `HealFailure` with a `code` — callers rely on exit codes and `code` matching.

### Pull request checklist

- [ ] `npm test` passes
- [ ] `npm run demo` still reports `state: healed`
- [ ] No new runtime dependencies without a documented reason
- [ ] `.env.example` and this README updated if config changed
- [ ] `data/` and `llama3.2-1b/` stay out of git

### Reporting issues

Open an issue with the collector ID, the failing `data/status.json` contents and the output of `npm test` if relevant. Because the pipeline logs everything to `data/history.jsonl`, most bugs come with a full trace already attached.

---

## 📜 License

MIT. The `llama3.2-1b/` model is not part of this repository (gitignored, 2.5 GB); it is governed by Meta's Llama 3.2 Community License.
