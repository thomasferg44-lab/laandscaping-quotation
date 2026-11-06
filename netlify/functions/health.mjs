// GET /api/health (redirect in netlify.toml). Read-only, no secrets in the
// response: booleans for database reachability and config presence.
import { companyConfig } from "../../companyConfig.js";
import { checkHealth } from "../../src/lib/health.js";

export default async function handler() {
  const env = {
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  };
  const body = await checkHealth({ config: companyConfig, env, fetchImpl: fetch, timeoutMs: 4000 });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
