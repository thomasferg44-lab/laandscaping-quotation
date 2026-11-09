import { useEffect, useState } from "react";
import { fetchHealth } from "../lib/healthClient";

// Shared across the shell: one check at start, then every 60s while visible.
let cache = null;
const subs = new Set();
let timer = null;
async function refresh() {
  cache = await fetchHealth();
  for (const s of subs) s(cache);
}
export default function useHealth() {
  const [h, setH] = useState(cache);
  useEffect(() => {
    subs.add(setH);
    if (!cache) refresh();
    if (!timer) {
      timer = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 60000);
    }
    return () => { subs.delete(setH); if (!subs.size) { clearInterval(timer); timer = null; } };
  }, []);
  return h;
}
