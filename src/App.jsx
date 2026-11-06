import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { checkBusinessAccess } from "./lib/auth";
import NoAccess from "./components/NoAccess.jsx";
import { QuotesProvider } from "./state/QuotesStore.jsx";
import Skeleton from "./components/ui/Skeleton.jsx";

// Route-level code splitting: the customer's /quote/:id page is what opens
// on a cheap phone over mobile data, so it never downloads the builder,
// dashboard or library code (design spec §2A performance).
const PublicQuote = lazy(() => import("./pages/PublicQuote.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Builder = lazy(() => import("./pages/Builder.jsx"));
const QuoteDetail = lazy(() => import("./pages/QuoteDetail.jsx"));
const Library = lazy(() => import("./pages/Library.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));

function Loading() {
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

// Everything the landscaper uses. Auth is only touched here, so the public
// page never waits on a session check.
function OwnerApp() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Signed in is not enough: the login must be on the business_users
  // allowlist. Re-checked when the user changes, not on token refreshes.
  const userId = session?.user?.id;
  const [access, setAccess] = useState(null); // null = checking
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    setAccess(null);
    if (!userId) return;
    let cancelled = false;
    checkBusinessAccess(supabase).then((a) => { if (!cancelled) setAccess(a); });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  if (session === undefined) return <Loading />;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (access === null) return <Loading />;
  if (access !== "granted") return <NoAccess state={access} email={session.user?.email} onRetry={recheck} />;

  return (
    <QuotesProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/builder" element={<Builder />} />
        <Route path="/builder/:id" element={<Builder />} />
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/library" element={<Library />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </QuotesProvider>
  );
}
