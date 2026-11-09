import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { friendlyAuthError } from "../lib/auth";
import { companyConfig } from "../../companyConfig";
import BrandMark from "../components/ui/BrandMark.jsx";
import { TextField } from "../components/ui/Field.jsx";
import Icon from "../components/ui/Icon.jsx";

// Minimal login. No signup UI: logins are created in the Supabase dashboard
// (Authentication → Users) and given access with
// supabase/add-business-user.sql. Sign-ups are switched off per SETUP.md.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(friendlyAuthError(error, companyConfig.businessName));
    } catch (e) {
      setError(friendlyAuthError(e, companyConfig.businessName));
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen aura-wash flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm card p-6 sm:p-8 space-y-5 animate-rise">
        <div className="text-center space-y-3">
          <BrandMark size={56} className="mx-auto rounded-[16px]" />
          <div>
            <h1 className="text-[22px] font-semibold">{companyConfig.businessName}</h1>
            <p className="text-[15px] text-ink-3">Sign in to build and send quotes</p>
          </div>
        </div>
        <TextField label="Email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} className="mt-[1px]" />{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full text-[17px]">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
