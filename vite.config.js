import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { companyConfig } from "./companyConfig.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// index.html carries the client's name (tab title, link previews) straight
// from companyConfig.js, so a config swap rebrands it too.
// On /quote/:token, start the one data call while the HTML is still being
// parsed, in parallel with the JS download (publicPrefetch.js picks it up).
// The anon key is already public in the JS bundle; it grants only what RLS
// and the granted RPCs allow. The test backend gets a timing marker instead.
const TOKEN_RE = "^\\/quote\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\/?$";
function earlyFetch(env) {
  if (env.VITE_MOCK_BACKEND === "1") return `<script>window.__qpStart=performance.now()</script>`;
  if (!/^https:\/\//.test(env.VITE_SUPABASE_URL ?? "") || !env.VITE_SUPABASE_ANON_KEY) return "";
  const url = JSON.stringify(`${new URL(env.VITE_SUPABASE_URL).origin}/rest/v1/rpc/get_public_quote`);
  const key = JSON.stringify(env.VITE_SUPABASE_ANON_KEY);
  return `<script>(function(){var m=location.pathname.match(new RegExp(${JSON.stringify(TOKEN_RE)},"i"));if(!m||!window.fetch)return;var k=${key};var p=fetch(${url},{method:"POST",headers:{apikey:k,Authorization:"Bearer "+k,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({p_token:m[1]})}).then(function(r){return r.text().then(function(t){return{ok:r.ok,status:r.status,text:t}})});p.catch(function(){});window.__qp={token:m[1].toLowerCase(),promise:p}})()</script>`;
}

// The customer's page needs one Supabase call before it can show the quote:
// preconnect so DNS/TLS overlap the JS download. Skipped for the local test
// backend, which never talks to Supabase.
const brandHtml = (env) => ({
  name: "brand-html",
  transformIndexHtml: (html) => html
    .replace("%PRECONNECT%", env.VITE_MOCK_BACKEND !== "1" && /^https:\/\//.test(env.VITE_SUPABASE_URL ?? "")
      ? `<link rel="preconnect" href="${esc(new URL(env.VITE_SUPABASE_URL).origin)}" crossorigin />` : "")
    .replace("%EARLY_FETCH%", earlyFetch(env))
    .replaceAll("%BUSINESS_NAME%", esc(companyConfig.businessName))
    .replaceAll("%LOGO_URL%", esc(companyConfig.logoUrl || "data:,")),
});

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("VITE_"))) };
  return { plugins: [react(), brandHtml(env)] };
});
