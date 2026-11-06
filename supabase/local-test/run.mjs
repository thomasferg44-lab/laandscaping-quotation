import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const REPO = process.argv[2];
const here = new URL(".", import.meta.url).pathname;
const read = (p) => readFileSync(p, "utf8");
let failures = 0;

async function fresh() { const db = new PGlite(); await db.exec(read(here + "stubs.sql")); return db; }
async function verify(db, file, label) {
  const out = await db.exec(read(file));
  const rows = out.at(-1).rows;
  const bad = rows.filter((r) => !String(r.result).startsWith("PASS"));
  failures += bad.length;
  console.log(`\n== ${label}: ${rows.length - bad.length}/${rows.length} PASS`);
  for (const r of rows) console.log(`  ${String(r.result).startsWith("PASS") ? "ok  " : "FAIL"} ${r.test} -> ${r.result}`);
}

// A. Fresh setup from the folded schema.sql
{
  const db = await fresh();
  await db.exec(read(REPO + "/supabase/schema.sql"));
  await verify(db, REPO + "/supabase/verify-rls.sql", "A. fresh schema.sql / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A. fresh schema.sql / verify-compete-upgrades.sql");
  await db.exec(read(REPO + "/supabase/schema.sql")); // re-paste must be safe
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "A2. schema.sql re-pasted / verify-compete");
}

// B. Upgrade path: main's schema + legacy rows, then the patch (twice)
{
  const db = await fresh();
  await db.exec(read(here + "schema-main.sql"));
  await verify(db, here + "verify-rls-main.sql", "B0. main schema (baseline) / verify-rls (main copy)");
  const items = JSON.stringify([{ id: "a", description: "Lawn", mode: "area", qty: 40, rate: 85, total: 3400, photo_url: null }]);
  const sent = (await db.query(`insert into public.quotes (customer_name, status, line_items, subtotal, total) values ('Legacy sent', 'sent', $1, 3400, 3400) returning id`, [items])).rows[0].id;
  const acc = (await db.query(`insert into public.quotes (customer_name, status, line_items, subtotal, total, accepted_at) values ('Legacy accepted', 'accepted', $1, 3400, 3400, now()) returning id`, [items])).rows[0].id;
  const before = (await db.query(`select * from public.get_public_quote($1)`, [sent])).rows[0];

  await db.exec(read(REPO + "/supabase/patches/2026-11-05-compete-upgrades.sql"));
  await db.exec(read(REPO + "/supabase/patches/2026-11-05-compete-upgrades.sql")); // idempotent
  await verify(db, REPO + "/supabase/verify-rls.sql", "B1. main + patch x2 / verify-rls.sql");
  await verify(db, REPO + "/supabase/verify-compete-upgrades.sql", "B1. main + patch x2 / verify-compete-upgrades.sql");

  // Old links resolve with every column the old page read, unchanged.
  await db.exec(`set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);`);
  const after = (await db.query(`select * from public.get_public_quote($1)`, [sent])).rows[0];
  const accRow = (await db.query(`select * from public.get_public_quote($1)`, [acc])).rows[0];
  const ok1 = Object.keys(before).every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
  const okAcc = accRow && accRow.status === "accepted" && accRow.accepted_selection === null;
  // The old page's accept call on a legacy link still works.
  const oldAccept = (await db.query(`select public.accept_public_quote($1) as ok`, [sent])).rows[0].ok;
  await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  const legacyAfter = (await db.query(`select status, total, accepted_selection->>'accepted_via' as via from public.quotes where id = $1`, [sent])).rows[0];
  const checks = [
    ["legacy sent link: every pre-patch column identical after patch", ok1],
    ["legacy accepted link still resolves (no snapshot, renders from line_items)", okAcc],
    ["old page's accept_public_quote(token) still accepts a legacy quote", oldAccept === true && legacyAfter.status === "accepted" && Number(legacyAfter.total) === 3400 && legacyAfter.via === "legacy-button"],
  ];
  console.log("\n== B2. backward compatibility");
  for (const [t, ok] of checks) { console.log(`  ${ok ? "ok  " : "FAIL"} ${t}`); if (!ok) failures++; }
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
