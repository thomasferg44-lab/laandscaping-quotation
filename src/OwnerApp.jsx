import { lazy, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { checkBusinessAccess } from "./lib/auth";
import NoAccess from "./components/NoAccess.jsx";
import { QuotesProvider } from "./state/QuotesStore.jsx";
import { Loading } from "./App.jsx";

const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Builder = lazy(() => import("./pages/Builder.jsx"));
const QuoteDetail = lazy(() => import("./pages/QuoteDetail.jsx"));
const Library = lazy(() => import("./pages/Library.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));

// Everything the landscaper uses. Auth is only touched here, so the public
// page never waits on a session check.
export default function OwnerApp() {
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
