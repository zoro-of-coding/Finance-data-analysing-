# 2-Minute Demo Walkthrough

**Pitch:** a self-healing web scraper — when the site you scrape changes and your
data goes bad, it fixes its own scraper and hands you clean data. Built on
Bright Data Scraper Studio + its Self-Healing AI.

Filmed on a 1920×1080 terminal at a readable font, one take, no cuts longer than
a beat. Total: ~2:00.

---

## 0:00 – Hook (20s)

> "Every scraper breaks. The site ships a redesign — you don't notice — and for
> days you're silently ingesting `null`s. This is a scraper that heals itself."

Show this on screen (the README story):

```
A scraper works at 9am. The site ships a redesign at 10am.
By noon you're silently ingesting nulls.
```

---

## 0:20 – The agent builds the scraper (15s)

> "I told Bright Data's AI Agent what I want — a Yahoo Finance quote scraper —
> in plain language. It wrote the extractor and gave me a Collector ID."

```bash
npm run create-collector
# ... AI Agent generates the scraper ...
# Collector ID: c_msrarja313zlv6dq6c
```

*(Flash this — you don't need to show the whole run.)*

---

## 0:35 – Live scrape (25s)

> "Now one command triggers the collector and pulls real prices."

```bash
npm start
```

Show the real output (trim to the interesting lines):

```
Triggered collector c_msrarja313zlv6dq6c (immediate, 3 inputs)
Dataset ready (3 rows from 3 inputs)
Initial validation   healthy (3 rows, 0 warnings)
Cycle finished: healthy
```

> "Real quotes: AAPL $302.25, MSFT $492.43, NVDA $224.09 — normalized from the
> collector's pretty output into plain numbers."

---

## 1:00 – The breakage (20s)

> "Then the site changes. The collector starts returning `null`s everywhere."

Show a snippet (from a spot-check snapshot / the demo fixtures):

```
regularMarketPrice: null
regularMarketChangePercent: null
marketCap: null
```

> "If this ran silently, that void would flow straight into your dashboard.
> Every other scraper story ends here."

---

## 1:20 – It heals itself (35s) ⭐ THE MONEY SHOT

Run it live:

```bash
npm run demo
```

> "Offline demo — same pipeline, no API calls, no credits."

Show it detect → heal → re-verify in one block:

```
Phase 1: site breaks -> collector returns null prices everywhere
Phase 2: validation flags the breakage -> self-heal triggers
Phase 3: healed collector re-scrapes -> data healthy again

Initial validation   unhealthy (2 critical checks failed, 3/3 bad rows)
Heal attempt 1/2
Post-heal validation healthy (3 rows, 0 warnings)

state: healed
healInvocations: 1
rowsRecovered: 3
```

> "Validation caught the breakage, prompted Bright Data's Self-Healing AI to
> rebuild the extractor, auto-approved the fix, and re-verified the data — the
> Collector ID never changed, so nothing downstream broke."

---

## 1:55 – Close (5s)

> "It's open source: `github.com/zoro-of-coding/Finance-data-analysing-`."

---

## Pro tips

- **Pre-warm the dashboard** (`npm run dashboard`) before the demo and have a tab
  at the ready to flash at the end if you're tight on time.
- Record in one take; if a command fails, cut and re-record that shot — don't
  ad-lib live.
- The `data/` snapshots + `data/history.jsonl` are the receipts. Mention "every
  cycle is logged" — judges love persistence.