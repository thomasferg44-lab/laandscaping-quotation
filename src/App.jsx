import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import Skeleton from "./components/ui/Skeleton.jsx";

// Route-level code splitting. The customer's /quote/:id page is what opens
// on a cheap phone over mobile data (design spec §2A performance): it ships
// in the entry chunk (no extra round trip to discover a lazy chunk) and
// never downloads supabase-js or the builder, dashboard and library code;
// those all live behind the lazy OwnerApp chunk.
import PublicQuote from "./pages/PublicQuote.jsx";
const OwnerApp = lazy(() => import("./OwnerApp.jsx"));

export function Loading() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-20 space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 rounded-card" /><Skeleton className="h-24 rounded-card" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Public, no-login page the customer opens from WhatsApp/email */}
        <Route path="/quote/:id" element={<PublicQuote />} />
        <Route path="*" element={<OwnerApp />} />
      </Routes>
    </Suspense>
  );
}
