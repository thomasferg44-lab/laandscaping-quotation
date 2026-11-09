// Tool health, shared by the Netlify Function (netlify/functions/health.mjs)
// and the dashboard status line. Pure: fetch, env and config are passed in.
//
// Reports booleans only: never a key, URL, number or address.
//   ok            the endpoint answered (always true when you get a body)
//   healthy       database reachable AND required config present
//   database      the database answered a read-only probe in time
//   config.*      which settings are present (true/false)
//
// The database probe calls the public read function get_public_quote with an
// all-zero token: a SELECT that matches nothing and writes nothing. It
// proves PostgREST and Postgres both answer with the anon key.
import { normaliseWhatsAppNumber } from "./shareLinks.js";
import { safePaymentLink } from "./payment.js";

export const PROBE_TOKEN = "00000000-0000-4000-8000-000000000000";
const present = (v) => typeof v === "string" && v.trim().length > 0;

export function configPresence(config, env = {}) {
  return {
    businessName: present(config?.businessName),
    logo: present(config?.logoUrl),
    whatsappNumber: Boolean(normaliseWhatsAppNumber(config?.whatsappNumber)),
    contactEmail: present(config?.contactEmail) && !/\.invalid$/i.test(config.contactEmail.trim()),
    paymentInstructions: present(config?.paymentInstructions),
    paymentLink: Boolean(safePaymentLink(config?.paymentLink)),
    supabaseUrl: /^https:\/\//.test(env.supabaseUrl ?? ""),
    supabaseAnonKey: present(env.supabaseAnonKey),
  };
}

// The settings a deploy cannot work without.
export const REQUIRED_CONFIG = ["businessName", "supabaseUrl", "supabaseAnonKey"];

export async function probeDatabase({ supabaseUrl, supabaseAnonKey, fetchImpl, timeoutMs = 4000, now = () => Date.now() }) {
  if (!/^https:\/\//.test(supabaseUrl ?? "") || !present(supabaseAnonKey)) return { reachable: false, latencyMs: null };
  const started = now();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_public_quote`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: PROBE_TOKEN }),
      signal: ctrl?.signal,
    });
    return { reachable: res.ok, latencyMs: now() - started };
  } catch {
    return { reachable: false, latencyMs: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkHealth({ config, env, fetchImpl, timeoutMs, now = () => Date.now() }) {
  const presence = configPresence(config, env);
  const db = await probeDatabase({ ...env, fetchImpl, timeoutMs, now });
  const configComplete = REQUIRED_CONFIG.every((k) => presence[k]);
  return {
    ok: true,
    healthy: db.reachable && configComplete,
    database: db.reachable,
    databaseLatencyMs: db.latencyMs,
    configComplete,
    config: presence,
    checkedAt: new Date(now()).toISOString(),
  };
}

// One short line for the dashboard shell.
export function healthSummary(h) {
  if (!h) return { tone: "unknown", text: "Checking status…" };
  if (h.error) return { tone: "unknown", text: "Status check unavailable" };
  if (!h.database) return { tone: "bad", text: "Database not reachable" };
  if (!h.configComplete) return { tone: "bad", text: "Setup incomplete" };
  const missing = [];
  if (!h.config.paymentInstructions && !h.config.paymentLink) missing.push("payment details");
  if (!h.config.whatsappNumber) missing.push("WhatsApp number");
  if (missing.length) return { tone: "warn", text: `Connected · add ${missing.join(" and ")}` };
  return { tone: "good", text: "All systems normal" };
}
