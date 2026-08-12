import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Fire a JSON webhook alert (Slack / Discord / Make / Zapier compatible).
 * Non-fatal: alerting must never crash the pipeline.
 */
export async function sendAlert(payload) {
  if (!config.alertWebhookUrl) {
    logger.debug("Alert suppressed (ALERT_WEBHOOK_URL not set)", {
      text: payload.text,
    });
    return false;
  }
  try {
    const res = await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn(`Alert webhook returned ${res.status}`);
    return res.ok;
  } catch (err) {
    logger.warn("Alert webhook failed", { error: err.message });
    return false;
  }
}

export function buildAlertPayload(status) {
  const emoji =
    status.state === "healthy" ? ":green_circle:" : status.state === "healed" ? ":recycle:" : ":red_circle:";
  return {
    text: `${emoji} Finance scraper status: ${status.state.toUpperCase()}`,
    attachments: [
      {
        color: status.state === "healthy" ? "good" : "danger",
        fields: [
          { title: "State", value: status.state, short: true },
          { title: "Rows", value: String(status.totalRows ?? 0), short: true },
          { title: "Summary", value: status.summary || "-", short: false },
          { title: "Collector", value: config.collectorId, short: true },
          { title: "Time", value: new Date(status.ts).toISOString(), short: true },
        ],
      },
    ],
  };
}
