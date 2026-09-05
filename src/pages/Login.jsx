import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";

// Minimal single-user login. No signup UI: the landscaper's user is created
// once in the Supabase dashboard (Authentication → Users) per deploy.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
        <div className="text-center">
          {companyConfig.logoUrl && (
            <img src={companyConfig.logoUrl} alt="" className="h-12 mx-auto mb-2 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <h1 className="text-lg font-semibold" style={{ color: companyConfig.primaryColor }}>
            {companyConfig.businessName}
          </h1>
          <p className="text-sm text-gray-500">Sign in to build quotes</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-lg py-2 text-white font-medium disabled:opacity-60"
          style={{ backgroundColor: companyConfig.primaryColor }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
