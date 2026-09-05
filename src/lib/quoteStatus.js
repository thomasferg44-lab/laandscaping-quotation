import { supabase } from "./supabaseClient";

// The ONE code path for status transitions from the browser. Sends only
// { status }, with a guard on the current status so concurrent updates
// are no-ops rather than regressions. Timestamps are stamped by the DB
// trigger (quotes_stamp_status_timestamps); anon-role limits are enforced
// by quotes_a_guard_anon_update + RLS. Never add other columns here.
//
// Returns the updated row, or null when no row matched (already moved on,
// or not visible under RLS). Throws on a real error.
export async function advanceStatus(id, from, to) {
  const fromList = Array.isArray(from) ? from : [from];
  const { data, error } = await supabase
    .from("quotes")
    .update({ status: to })
    .eq("id", id)
    .in("status", fromList)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
