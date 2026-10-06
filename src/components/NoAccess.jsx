import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";

// Shown to a signed-in login that isn't on the business_users allowlist
// (state "denied"), or when the access check itself failed ("error").
export default function NoAccess({ state, email, onRetry }) {
  const denied = state === "denied";
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4 text-center">
        <h1 className="text-lg font-semibold" style={{ color: companyConfig.primaryColor }}>
          {denied ? "No access yet" : "Couldn't check your access"}
        </h1>
        <p className="text-sm text-gray-600">
          {denied
            ? <>You're signed in{email ? <> as <span className="font-medium">{email}</span></> : null}, but this login hasn't been given access to {companyConfig.businessName}'s quotes. Ask whoever set up the tool to add it.</>
            : "Check your connection and try again."}
        </p>
        <div className="flex gap-2">
          {!denied && (
            <button type="button" onClick={onRetry}
              className="flex-1 rounded-lg py-2 text-white font-medium"
              style={{ backgroundColor: companyConfig.primaryColor }}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => supabase.auth.signOut()}
            className="flex-1 rounded-lg py-2 border border-gray-300 text-gray-800 font-medium">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
