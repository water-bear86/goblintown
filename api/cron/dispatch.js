import { timingSafeEqual } from "node:crypto";
import { dispatchTasks } from "../../dist/lib/dispatcher.js";

let inFlight = false;

function authorized(req) {
  const secrets = [process.env.CRON_SECRET, process.env.BL33P_CRON_SECRET]
    .filter((secret) => typeof secret === "string" && secret.length > 0);
  if (secrets.length === 0) return false;

  const header = req.headers?.authorization ?? "";
  const actual = Buffer.from(String(header));

  return secrets.some((secret) => {
    const target = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== target.length) return false;
    return timingSafeEqual(actual, target);
  });
}

function methodAllowed(req) {
  return req.method === "GET" || req.method === "POST";
}

export default async function handler(req, res) {
  if (!methodAllowed(req)) {
    res.setHeader("Allow", "GET, POST");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (!authorized(req)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (inFlight) {
    res.statusCode = 409;
    res.end(JSON.stringify({ error: "dispatch_in_progress" }));
    return;
  }

  inFlight = true;
  try {
    const result = await dispatchTasks();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    console.error("dispatch failed", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "dispatch_failed", ok: false }));
  } finally {
    inFlight = false;
  }
}
