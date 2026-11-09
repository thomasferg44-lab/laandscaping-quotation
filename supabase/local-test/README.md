# Local SQL test harness (not part of the app)

Runs `schema.sql`, the 2026-11-05 patch and both verify scripts on a throwaway
in-memory Postgres (PGlite, WASM). Nothing here can reach a real database.
`stubs.sql` stands in for what Supabase provides (roles, `auth.uid()`,
`auth.role()`, storage tables, the realtime publication); it is not a Supabase
replica: PostgREST, Storage and Realtime are not exercised.

```sh
T=$(mktemp -d) && cp supabase/local-test/* "$T" && git show main:supabase/schema.sql > "$T/schema-main.sql" \
  && git show main:supabase/verify-rls.sql > "$T/verify-rls-main.sql" \
  && (cd "$T" && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15 >/dev/null \
  && node run.mjs "$OLDPWD" && node parity.mjs "$OLDPWD")
```

- `run.mjs`: A) fresh schema.sql + verify-rls + verify-compete-upgrades, re-pasted;
  B) main's schema + legacy rows, then the patch twice, then both verify scripts
  and backward-compatibility checks on the legacy rows.
- `parity.mjs`: 300 random quotes accepted through `accept_public_quote_v2`;
  the stored snapshot must equal `buildAcceptanceSnapshot()` in quoteMath.js.
