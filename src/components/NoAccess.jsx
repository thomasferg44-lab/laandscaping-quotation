import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import BrandMark from "./ui/BrandMark.jsx";

// Shown to a signed-in login that isn't on the business_users allowlist
// (state "denied"), or when the access check itself failed ("error").
export default function NoAccess({ state, email, onRetry }) {
  const denied = state === "denied";
  return (
    <div className="min-h-screen aura-wash flex items-center justify-center p-4">
      <div className="w-full max-w-sm card p-6 sm:p-8 space-y-5 text-center">
        <BrandMark size={48} className="mx-auto rounded-[14px]" />
        <h1 className="text-[19px] font-semibold">{denied ? "No access yet" : "Couldn't check your access"}</h1>
        <p className="text-[15px] text-ink-2">
          {denied
            ? <>You're signed in{email ? <> as <span className="font-medium">{email}</span></> : null}, but this login hasn't been given access to {companyConfig.businessName}'s quotes. Ask whoever set up the tool to add it.</>
            : "Check your connection and try again."}
        </p>
        <div className="flex flex-col gap-2">
          {!denied && <button type="button" onClick={onRetry} className="btn-primary w-full">Try again</button>}
          <button type="button" onClick={() => supabase.auth.signOut()} className="btn-secondary w-full py-3.5">Sign out</button>
        </div>
      </div>
    </div>
  );
}
