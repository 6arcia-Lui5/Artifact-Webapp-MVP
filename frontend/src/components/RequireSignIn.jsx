import { useAuth } from "@clerk/react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import useUserSync from "../../hooks/useUserSync";
import LoadingSpinner from "./LoadingSpinner";

export default function RequireSignIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  const sync = useUserSync();

  if (!isLoaded) return <LoadingSpinner />;
  if (!isSignedIn) {
    const destination = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(destination)}`} replace />;
  }
  if (sync.isError) {
    return (
      <div role="alert" className="alert alert-error flex flex-wrap">
        <p>We couldn’t connect your account. Try again before continuing.</p>
        <button className="btn btn-sm" onClick={() => sync.refetch()}>Try again</button>
        <Link to="/" className="link">Back to artifacts</Link>
      </div>
    );
  }
  if (!sync.isSuccess) return <LoadingSpinner />;
  return <Outlet />;
}
