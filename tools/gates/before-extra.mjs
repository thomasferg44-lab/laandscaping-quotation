import { launch, newContext, PHONE, DESKTOP } from "./lib.mjs";
const BASE = process.argv[3] ?? "http://localhost:4301"; const OUT = process.argv[2];
const b = await launch();
for (const [pname, profile] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  const ctx = await newContext(b, profile, BASE); const p = await ctx.newPage();
  await p.goto(BASE + "/"); await p.evaluate(() => localStorage.setItem("dropstack-mock-fail", "rpc"));
  await p.goto(BASE + "/quote/3f2a9c00-0000-4000-8000-000000000000"); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/public-error-${pname}.png`, fullPage: true });
  await p.evaluate(() => localStorage.removeItem("dropstack-mock-fail"));
  await p.goto(BASE + "/quote/not-a-token"); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/public-notfound-${pname}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
