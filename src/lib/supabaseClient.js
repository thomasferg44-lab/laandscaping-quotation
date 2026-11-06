import { createClient } from "@supabase/supabase-js";
import { createMockClient } from "../dev/mockBackend.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Local test backend (src/dev/mockBackend.js): in-memory, no network. Only
// when a build or dev server is started with VITE_MOCK_BACKEND=1; a normal
// build compiles this branch away and the mock module is not bundled.
const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";

if (!MOCK && (!url || !anonKey)) {
  // Fail loudly in dev rather than making mysterious network errors later.
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.");
}

// The landscaper's client: carries their login session.
export const supabase = MOCK ? createMockClient() : createClient(url ?? "", anonKey ?? "");

// The hosted quote page's client: never carries a session, so every request
// runs as anon, exactly like the customer's phone. Without this, a
// landscaper previewing their own link would call the public functions as
// `authenticated`, which has no EXECUTE on them.
export const supabasePublic = MOCK
  ? createMockClient({ anonOnly: true })
  : createClient(url ?? "", anonKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sb-public-quote" },
    });
