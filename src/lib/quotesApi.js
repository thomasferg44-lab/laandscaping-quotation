// Authenticated data access for the landscaper side. `select("*")` on
// purpose: it works on both the patched and unpatched schema.
export async function listQuotes(client) {
  const { data, error } = await client.from("quotes").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getQuote(client, id) {
  const { data, error } = await client.from("quotes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveQuote(client, id, payload) {
  const res = id
    ? await client.from("quotes").update(payload).eq("id", id).select().single()
    : await client.from("quotes").insert({ ...payload, status: "draft" }).select().single();
  if (res.error) throw res.error;
  return res.data;
}

// A missing table/column means the 2026-11-05 patch isn't applied yet.
export function needsPatch(error) {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "42703" || code === "PGRST202"
    || /does not exist|could not find/i.test(String(error?.message ?? ""));
}

export async function listLibrary(client) {
  const { data, error } = await client.from("quote_library_items").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveLibraryItem(client, entry) {
  const row = {
    name: entry.name.trim(),
    description: entry.description?.trim() || null,
    mode: entry.mode,
    default_rate: entry.default_rate,
  };
  const res = entry.id
    ? await client.from("quote_library_items").update(row).eq("id", entry.id).select().single()
    : await client.from("quote_library_items").insert(row).select().single();
  if (res.error) throw res.error;
  return res.data;
}

export async function deleteLibraryItem(client, id) {
  const { error } = await client.from("quote_library_items").delete().eq("id", id);
  if (error) throw error;
}
