import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const REPO = process.argv[2];
const here = new URL(".", import.meta.url).pathname;
const { buildAcceptanceSnapshot } = await import(REPO + "/src/lib/quoteMath.js");
const db = new PGlite();
await db.exec(readFileSync(here + "stubs.sql", "utf8"));
await db.exec(readFileSync(REPO + "/supabase/schema.sql", "utf8"));
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cents = () => Math.floor(rnd() * 5_000_000) / 100;
let mismatches = 0, N = 300;
for (let n = 0; n < N; n++) {
  const mkItems = (p) => Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => ({ id: `${p}${i}`, description: "x", mode: "plain", qty: 1, rate: 0, total: cents(), ...(rnd() < 0.35 ? { optional: true } : {}) }));
  const tiered = rnd() < 0.5;
  const tiers = tiered ? Array.from({ length: 2 + Math.floor(rnd() * 2) }, (_, t) => ({ id: `t${t}`, name: rnd() < 0.2 ? "" : `Tier ${t}`, line_items: mkItems(`t${t}-`) })) : null;
  const line_items = tiered ? tiers[0].line_items : mkItems("s");
  const depType = [null, "percent", "fixed"][Math.floor(rnd() * 3)];
  const depValue = depType === "percent" ? Math.round(rnd() * 10000) / 100 : depType === "fixed" ? cents() : null;
  const q = { status: "sent", tiers, line_items, deposit_type: depType, deposit_value: depValue };
  const tier = tiered ? tiers[Math.floor(rnd() * tiers.length)] : { line_items };
  const opts = tier.line_items.filter((i) => i.optional && rnd() < 0.5).map((i) => i.id);
  const tierId = tiered ? tier.id : null;
  const js = buildAcceptanceSnapshot(q, { tierId, optionalIds: opts }).snapshot;
  const id = (await db.query(`insert into public.quotes (customer_name, status, line_items, tiers, deposit_type, deposit_value) values ('p', 'sent', $1, $2, $3, $4) returning id`, [JSON.stringify(line_items), tiers && JSON.stringify(tiers), depType, depValue])).rows[0].id;
  await db.exec(`set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);`);
  const r = (await db.query(`select public.accept_public_quote_v2($1, 'Test Customer', true, $2, $3) as r`, [id, tierId, opts])).rows[0].r;
  await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  const sql = (await db.query(`select accepted_selection s from public.quotes where id = $1`, [id])).rows[0].s;
  const same = r === "accepted" && ["total", "deposit_amount", "balance_amount"].every((k) => Number(sql[k]) === js[k])
    && JSON.stringify(sql.line_items.map((i) => i.id)) === JSON.stringify(js.line_items.map((i) => i.id))
    && (sql.tier_name ?? null) === (js.tier_name ?? null);
  if (!same) { mismatches++; if (mismatches < 5) console.log("MISMATCH", r, { js, sql }); }
}
console.log(`parity: ${N - mismatches}/${N} random quotes identical (totals, deposit, balance, items, tier name)`);
process.exit(mismatches ? 1 : 0);
