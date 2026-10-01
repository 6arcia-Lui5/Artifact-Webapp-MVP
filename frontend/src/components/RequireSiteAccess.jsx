import { useEffect, useState } from "react";
import { useAuth, useClerk } from "@clerk/react";
import { Navigate, Outlet, useLocation } from "react-router";
import Navbar from "./Navbar";
import LoadingSpinner from "./LoadingSpinner";

export default function RequireSiteAccess() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { signOut } = useClerk();
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [access, setAccess] = useState({ userId: null, status: "pending" });

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;
    const controller = new AbortController();

    async function verify() {
      try {
        const token = await getToken();
        if (!token) throw new Error("No session token");
        const response = await fetch(`${import.meta.env.VITE_API_URL}/access`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setAccess({ userId, status: response.ok ? "allowed" : response.status === 403 ? "denied" : "error" });
        }
      } catch {
        if (!controller.signal.aborted) setAccess({ userId, status: "error" });
      }
    }

    verify();
    return () => controller.abort();
  }, [isLoaded, isSignedIn, userId, getToken, attempt]);

  if (!isLoaded) return <LoadingSpinner />;
  if (!isSignedIn) {
    const destination = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(destination)}`} replace />;
  }
  if (access.userId !== userId || access.status === "pending") return <LoadingSpinner />;
  if (access.status !== "allowed") {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-serif font-bold">
          {access.status === "denied" ? "This account is not approved" : "We couldn't verify your access"}
        </h1>
        <p className="mt-3">
          {access.status === "denied"
            ? "Use one of the five approved accounts to open the artifact collection."
            : "Check your connection and try again."}
        </p>
        <div className="flex justify-center gap-3 mt-6">
          {access.status === "error" && <button className="btn btn-primary" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
          <button className="btn btn-outline" onClick={() => signOut({ redirectUrl: "/login" })}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-base-100">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8"><Outlet /></main>
    </div>
  );
}
