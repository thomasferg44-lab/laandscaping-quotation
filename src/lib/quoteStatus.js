import { supabase } from "./supabaseClient";

// The ONE code path for the landscaper's status transitions (draft->sent,
// accepted->invoiced). Sends only { status }, with a guard on the current
// status so concurrent updates are no-ops rather than regressions.
// Timestamps are stamped by the DB trigger (quotes_stamp_status_timestamps).
// Never add other columns here. The customer's transitions don't come
// through here: anon has no table access and uses publicQuote.js instead.
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
