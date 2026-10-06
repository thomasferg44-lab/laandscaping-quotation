import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { checkBusinessAccess } from "./lib/auth";
import Login from "./pages/Login.jsx";
import Builder from "./pages/Builder.jsx";
import PublicQuote from "./pages/PublicQuote.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import NoAccess from "./components/NoAccess.jsx";

export default function App() {
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

  if (session === undefined) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  const requireAuth = (el) => {
    if (!session) return <Navigate to="/login" replace />;
    if (access === null) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
    if (access !== "granted") return <NoAccess state={access} email={session.user?.email} onRetry={recheck} />;
    return el;
  };

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={requireAuth(<Dashboard />)} />
      <Route path="/builder" element={requireAuth(<Builder />)} />
      <Route path="/builder/:id" element={requireAuth(<Builder />)} />
      {/* Public, no-login page the customer opens from WhatsApp/email */}
      <Route path="/quote/:id" element={<PublicQuote />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
