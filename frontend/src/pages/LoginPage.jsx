import { useEffect, useState } from "react";
import { SignIn, SignUp, useAuth } from "@clerk/react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router";
import accounts from "../../../shared/dev-accounts.json";
import LoadingSpinner from "../components/LoadingSpinner";

function safeDestination(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\\\r\n]/.test(value)) return "/";
  if (/^\/(login|signup)(\/|\?|$)/.test(value)) return "/";
  return value;
}

export default function LoginPage({ mode = "login" }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const [selectedEmail, setSelectedEmail] = useState("");
  const requestedDestination = params.get("redirect");
  const destination = safeDestination(requestedDestination || sessionStorage.getItem("artifact.auth.redirect"));
  // Clerk's password/verification steps can replace the query string. Keep the
  // validated local destination across those steps and the session cache reset.
  useEffect(() => {
    if (isSignedIn) sessionStorage.removeItem("artifact.auth.redirect");
    else if (requestedDestination) sessionStorage.setItem("artifact.auth.redirect", destination);
  }, [isSignedIn, requestedDestination, destination]);
  const suffix = `?redirect=${encodeURIComponent(destination)}`;
  const signup = mode === "signup";
  const showPresets = import.meta.env.DEV &&
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") && !signup;

  if (!isLoaded) return <LoadingSpinner />;
  if (isSignedIn) return <Navigate to={destination} replace />;

  const appearance = {
    variables: { colorPrimary: "#8a5800", colorTextOnPrimaryBackground: "#ffffff", borderRadius: "0.75rem" },
    elements: {
      rootBox: { width: "100%" },
      cardBox: { width: "100%", boxShadow: "none", border: "1px solid #e5e5e5", borderRadius: "16px" },
      card: { boxShadow: "none" },
    },
  };

  return (
    <div className="auth-page p-20">
      <div className="auth-layout">
        <section className="auth-intro " aria-labelledby="auth-title">
          <h1 id="auth-title">{signup ? "Every artifact has a story. Share yours." : "Welcome back to the collection."}</h1>
          <p>{signup ? "Create an account to add artifacts and keep track of your contributions." : "Sign in to contribute artifacts and manage your records."}</p>
          <figure className="auth-artifact">
            <img src="/temporaryRomanCoin.png" alt="Two sides of an ancient Roman coin" width="480" height="320" />
          </figure>
        </section>
        <section className="auth-form" aria-label={signup ? "Create an account" : "Sign in"}>
          {signup ? (
            <SignUp routing="path" path="/signup" signInUrl={`/login${suffix}`}
              forceRedirectUrl={destination} signInForceRedirectUrl={destination} appearance={appearance}
              fallback={<LoadingSpinner />} />
          ) : (
            <SignIn key={selectedEmail} routing="path" path="/login" signUpUrl={`/signup${suffix}`}
              initialValues={{ emailAddress: selectedEmail }} forceRedirectUrl={destination}
              signUpForceRedirectUrl={destination} appearance={appearance} fallback={<LoadingSpinner />} />
          )}
          {showPresets && (
            <details className="auth-dev">
              <summary>Developer test accounts</summary>
              <p>Choose an account to fill its email. All five share one password; see the local developer account sheet.</p>
              <div className="auth-presets">
                {accounts.map((account) => (
                  <button key={account.email} type="button" aria-pressed={selectedEmail === account.email}
                    onClick={() => setSelectedEmail(account.email)}>
                    <span>{account.name}</span><span>{account.email}</span>
                  </button>
                ))}
              </div>
              <p className="auth-test-note">No email code needed for these five test accounts. Available only in development.</p>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
