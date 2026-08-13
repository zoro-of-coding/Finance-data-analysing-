import { config } from "./config.js";
import { logger } from "./logger.js";
import { ApiError } from "./errors.js";
import { normalizeRows } from "./normalize.js";

const BASE = "https://api.brightdata.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, { method = "GET", body, attempts = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (res.status >= 500) {
        const delay = 1000 * 2 ** (attempt - 1);
        logger.warn(`Bright Data API ${res.status} (attempt ${attempt}/${attempts}), retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (res.status >= 400) {
        throw new ApiError(`Bright Data API ${res.status} on ${path}`, res.status, data);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiError) throw err; // non-transient: stop retrying
      if (attempt === attempts) throw err;
      await sleep(1000 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Trigger an immediate (realtime) collection for each input URL.
 *
 * Uses /dca/trigger_immediate per URL and returns the response ids to poll.
 * The batch /dca/trigger -> /dca/dataset path is avoided because fresh,
 * AI-built collectors returned empty datasets there, while the immediate
 * path reliably returns rows within seconds.
 *
 * @param {string} collectorId c_...
 * @param {Array<object>} inputs  e.g. [{ url: "..." }]
 * @returns {Promise<Array<string>>} response ids, one per input
 */
export async function triggerCollector(collectorId, inputs) {
  const body = inputs && inputs.length ? inputs : config.inputs;
  const ids = [];
  for (const input of body) {
    const url = input.url;
    if (!url) continue;
    const res = await request(
      `/dca/trigger_immediate?collector=${collectorId}`,
      { method: "POST", body: { url } }
    );
    if (!res?.response_id) {
      throw new ApiError("trigger_immediate did not return a response_id", 200, res);
    }
    ids.push(res.response_id);
  }
  if (!ids.length) throw new ApiError("No triggerable inputs", 200, null);
  logger.info(`Triggered collector ${collectorId} (immediate, ${ids.length} inputs)`);
  return ids;
}

/**
 * Fetch the dataset for immediate response ids, polling until ready.
 * @param {Array<string>} responseIds
 * @returns {Promise<Array<object>>} normalized result rows
 */
export async function fetchDataset(responseIds) {
  const deadline = Date.now() + config.pollTimeoutMs;
  const remaining = new Set(responseIds);
  const rowsByInput = new Map();

  while (remaining.size && Date.now() < deadline) {
    for (const id of [...remaining]) {
      const data = await request(`/dca/get_result?response_id=${encodeURIComponent(id)}`);
      if (
        Array.isArray(data) &&
        data.length &&
        !(data[0] && typeof data[0] === "object" && data[0].pending === true)
      ) {
        rowsByInput.set(id, data);
        remaining.delete(id);
      } else if (Array.isArray(data) && data.length === 0) {
        // finished but empty for this URL
        remaining.delete(id);
      }
    }
    if (remaining.size) await sleep(config.pollIntervalMs);
  }

  if (remaining.size) {
    throw new ApiError(`Dataset poll timed out for ${remaining.size}/${responseIds.length} inputs`, 0, null);
  }

  const raw = [...rowsByInput.values()].flat();
  const rows = normalizeRows(raw);
  logger.info(`Dataset ready (${rows.length} rows from ${responseIds.length} inputs)`);
  return rows;
}

/**
 * Start a self-healing refactor job.
 * @param {string} collectorId
 * @param {string} prompt  what to fix, <=1000 chars
 * @returns {Promise<object>} job/progress payload
 */
export async function healCollector(collectorId, prompt, customInput) {
  const body = { prompt };
  if (customInput && customInput.length) body.custom_input = customInput;
  const res = await request(`/dca/collectors/${collectorId}/refactor_template`, {
    method: "POST",
    body,
  });
  logger.info("Self-healing job started", { collectorId });
  return res;
}

export async function healProgress(collectorId) {
  const res = await request(`/dca/collectors/${collectorId}/refactor_template/progress`);
  logger.debug("Heal progress", { status: res?.status, step: res?.step });
  return res;
}

/**
 * Approve (message=true) or reject (message=false) a healing diff.
 * auto_save persists the approved template once the job completes.
 */
export async function resumeHeal(collectorId, message, autoSave = true) {
  const res = await request(`/dca/collectors/${collectorId}/resume_automation_job`, {
    method: "POST",
    body: { message, auto_save: autoSave },
  });
  logger.info(`Self-healing ${message ? "approved" : "rejected"}`);
  return res;
}
