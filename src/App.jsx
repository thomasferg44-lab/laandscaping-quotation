import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import Login from "./pages/Login.jsx";
import Builder from "./pages/Builder.jsx";
import PublicQuote from "./pages/PublicQuote.jsx";

// /dashboard arrives in Stage 6 per CLAUDE.md build order.
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  const requireAuth = (el) => (session ? el : <Navigate to="/login" replace />);

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/builder" replace /> : <Login />} />
      <Route path="/builder" element={requireAuth(<Builder />)} />
      <Route path="/builder/:id" element={requireAuth(<Builder />)} />
      {/* Public, no-login page the customer opens from WhatsApp/email */}
      <Route path="/quote/:id" element={<PublicQuote />} />
      <Route path="*" element={<Navigate to="/builder" replace />} />
    </Routes>
  );
}
