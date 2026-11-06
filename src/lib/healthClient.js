// Dashboard side of the health check. Production: GET /api/health (the
// Netlify Function). Local test backend: the same checkHealth() against a
// stand-in fetch that honours the mock's failure switch, so the status line
// can be exercised without a network.
import { companyConfig } from "../../companyConfig.js";
import { checkHealth } from "./health.js";

const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";

export async function fetchHealth(fetchImpl = (...a) => fetch(...a)) {
  if (MOCK) {
    let fail = null;
    try { fail = localStorage.getItem("dropstack-mock-fail"); } catch { /* ignore */ }
    return checkHealth({
      config: companyConfig,
      env: { supabaseUrl: "https://local-test-backend.invalid", supabaseAnonKey: "local" },
      fetchImpl: async () => { if (fail === "all" || fail === "db") throw new TypeError("Failed to fetch"); return { ok: true }; },
    });
  }
  try {
    const res = await fetchImpl("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("json")) return { error: "unavailable" }; // e.g. plain `vite dev`: use `netlify dev`
    return await res.json();
  } catch {
    return { error: "unavailable" };
  }
}
