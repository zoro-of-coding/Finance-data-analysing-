import { config } from "./config.js";
import { logger } from "./logger.js";
import { ApiError } from "./errors.js";

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
 * Trigger the collector for a batch of inputs.
 * @param {string} collectorId c_...
 * @param {Array<object>} inputs  e.g. [{ url: "..." }]
 * @returns {Promise<string>} snapshot id (j_...)
 */
export async function triggerCollector(collectorId, inputs) {
  const body = inputs && inputs.length ? inputs : config.inputs;
  const res = await request(
    `/dca/trigger?collector=${collectorId}&queue_next=1`,
    { method: "POST", body }
  );
  if (!res?.collection_id) {
    throw new ApiError("Trigger did not return a collection_id", 200, res);
  }
  logger.info(`Triggered collector ${collectorId}, snapshot ${res.collection_id}`, {
    inputs: body.length,
  });
  return res.collection_id;
}

/**
 * Fetch the dataset for a snapshot, polling until ready.
 * @returns {Promise<Array<object>>} result rows
 */
export async function fetchDataset(snapshotId) {
  const deadline = Date.now() + config.pollTimeoutMs;
  while (Date.now() < deadline) {
    const data = await request(`/dca/dataset?id=${snapshotId}`);
    if (Array.isArray(data)) {
      logger.info(`Dataset ready (${data.length} rows)`);
      return data;
    }
    await sleep(config.pollIntervalMs);
  }
  throw new ApiError(`Dataset poll timed out for snapshot ${snapshotId}`, 0, null);
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
