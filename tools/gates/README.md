# Gate scripts (design spec §6), not part of the app

Browser runs against a build made with the local test backend
(`VITE_MOCK_BACKEND=1`, src/dev/mockBackend.js): in-memory, every non-local
request blocked. They prove the UI and the pure logic; the SQL is proven by
supabase/local-test and, on the real database, by supabase/verify-*.sql.

Needs `playwright-core` from any local project (`PLAYWRIGHT_FROM=/path/to/package.json`,
default ~/dropstack-outreachv2) with its Chromium installed. No dependency is added here.

```sh
VITE_MOCK_BACKEND=1 npx vite build --outDir /tmp/dist-mock
npx vite preview --outDir /tmp/dist-mock --port 4302 --strictPort &
node tools/gates/gate2.mjs /tmp/shots http://localhost:4302   # Gate 2 + pack screenshots
node tools/gates/legacy.mjs /tmp/shots                        # new UI on the pre-patch schema
node tools/gates/a11y.mjs /tmp/shots                          # labels, 44px targets, focus, pill contrast
# Gate 3: build a copy with configs/demo-config-2.js as companyConfig.js, serve on 4303, then
node tools/gates/gate3.mjs /tmp/shots-c2
# Gate 5: gzip server + Lighthouse x3 + Fast-3G
node tools/gates/serve.mjs /tmp/dist-mock 4310 &
LIGHTHOUSE_CLI=/path/to/lighthouse/cli/index.js node tools/gates/lh.mjs /tmp/perf
```
`baseline.mjs` / `before-extra.mjs` ran Gate 0 on `main` (served on 4301) with
only the test backend copied in.
