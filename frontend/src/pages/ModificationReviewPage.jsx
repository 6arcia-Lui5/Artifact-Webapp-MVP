
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "@clerk/react";
import LoadingSpinner from "../components/LoadingSpinner";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  CheckIcon,
  XCircleIcon,
  RefreshCwIcon,
  ClockIcon,
  UserIcon,
  PackageIcon,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const ModificationReviewPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [request, setRequest] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);

  // Authenticated API request helper.
  const apiRequest = useCallback(
    async (path, options = {}) => {
      const token = await getToken();

      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Something went wrong."
        );
      }

      return data;
    },
    [getToken]
  );

  // Retrieve this modification request.
  const loadRequest = useCallback(async () => {
    if (!id || !isLoaded || !isSignedIn) return;

    setIsLoading(true);
    setError("");

    try {
      const data = await apiRequest(`/api/modifications/${id}`);

      setRequest(
        data.request ||
          data.modificationRequest ||
          data
      );
    } catch (err) {
      setError(err.message || "Failed to load modification request.");
    } finally {
      setIsLoading(false);
    }
  }, [id, isLoaded, isSignedIn, apiRequest]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  const changes = request?.changes || [];

  const pendingCount = useMemo(
    () =>
      changes.filter((change) => change.status === "PENDING").length,
    [changes]
  );

  const approvedCount = useMemo(
    () =>
      changes.filter((change) => change.status === "APPROVED").length,
    [changes]
  );

  const rejectedCount = useMemo(
    () =>
      changes.filter((change) => change.status === "REJECTED").length,
    [changes]
  );

  const overallStatus = useMemo(() => {
    if (changes.length === 0) return "EMPTY";
    if (pendingCount > 0) return "PENDING";
    if (approvedCount === changes.length) return "APPROVED";
    if (rejectedCount === changes.length) return "REJECTED";
    if (approvedCount > 0 && rejectedCount > 0) {
      return "PARTIALLY APPROVED";
    }
    return "REVIEWED";
  }, [changes, pendingCount, approvedCount, rejectedCount]);

  const formatDate = (date) => {
    if (!date) return "Date unavailable";

    return new Date(date).toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const displayValue = (value) => {
    if (value === null || value === undefined || value === "") {
      return "Empty";
    }

    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  };

  const getFieldLabel = (change) => {
    return (
      change.fieldLabel ||
      change.fieldName ||
      change.field ||
      "Unknown field"
    );
  };

  // Approve or reject one field in the request.
  const handleDecision = async (changeId, decision) => {
    let rejectionReason = "";

    if (decision === "REJECTED") {
      rejectionReason =
        prompt("Optional: Why are you rejecting this change?") || "";
    }

    const confirmed =
      decision === "APPROVED"
        ? confirm("Approve this proposed change?")
        : confirm("Reject this proposed change?");

    if (!confirmed) return;

    setActionLoading(changeId);
    setError("");

    try {
      await apiRequest(
        `/api/modifications/${id}/changes/${changeId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            decision,
            rejectionReason,
          }),
        }
      );

      await loadRequest();
    } catch (err) {
      setError(err.message || "Failed to update the proposed change.");
    } finally {
      setActionLoading(null);
    }
  };

  if (!isLoaded || isLoading) {
    return <LoadingSpinner />;
  }

  if (!isSignedIn) {
    return (
      <div className="card bg-base-300 shadow-sm">
        <div className="card-body items-center text-center py-12">
          <UserIcon className="size-12 text-base-content/30" />
          <h2 className="card-title">Sign in required</h2>
          <p className="text-base-content/60">
            Sign in to review modification requests.
          </p>
          <Link to="/login" className="btn btn-primary btn-sm">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (error && !request) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/profile" className="btn btn-ghost btn-sm w-fit">
          <ArrowLeftIcon className="size-4" />
          Back to Profile
        </Link>

        <div className="alert alert-error">
          <span>{error}</span>
        </div>

        <button
          onClick={loadRequest}
          className="btn btn-outline btn-sm w-fit"
        >
          <RefreshCwIcon className="size-4" />
          Try Again
        </button>
      </div>
    );
  }

  if (!request) return null;

  const record = request.record || {};
  const modifier = request.modifier || {};

  return (
    <div className="flex flex-col gap-6">
      {/* Back Navigation */}
      <Link
        to="/profile"
        className="btn btn-ghost btn-sm w-fit"
      >
        <ArrowLeftIcon className="size-4" />
        Back to Profile
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Review Modification
          </h1>
          <p className="text-base-content/60 mt-1">
            Review each proposed change to this artifact record.
          </p>
        </div>

        <button
          onClick={loadRequest}
          className="btn btn-outline btn-sm"
          disabled={isLoading}
        >
          <RefreshCwIcon className="size-4" />
          Refresh
        </button>
      </div>

      {/* Request Information */}
      <div className="card bg-base-300 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="card-title">
                {record.itemName ||
                  record.title ||
                  "Untitled Artifact"}
              </h2>

              {record.hhw && (
                <p className="text-sm text-base-content/60">
                  HHW: {record.hhw}
                </p>
              )}

              {record.museumId && (
                <p className="text-sm text-base-content/60">
                  Museum ID: {record.museumId}
                </p>
              )}
            </div>

            <span
              className={`badge ${
                overallStatus === "PENDING"
                  ? "badge-warning"
                  : overallStatus === "APPROVED"
                  ? "badge-success"
                  : overallStatus === "REJECTED"
                  ? "badge-error"
                  : "badge-info"
              }`}
            >
              {overallStatus}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to={`/record/${record.id || request.recordId}`}
              className="btn btn-ghost btn-sm"
            >
              <PackageIcon className="size-4" />
              View Original Record
              <ExternalLinkIcon className="size-3" />
            </Link>
          </div>

          <div className="divider my-0" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-base-content/50">
                SUBMITTED BY
              </p>
              <p className="font-medium mt-1">
                {modifier.name ||
                  modifier.username ||
                  modifier.email ||
                  "Unknown contributor"}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-base-content/50">
                SUBMISSION DATE
              </p>
              <p className="font-medium mt-1">
                {formatDate(request.createdAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Decision Summary */}
      <div className="stats stats-vertical sm:stats-horizontal bg-base-300 shadow-sm w-full">
        <div className="stat">
          <div className="stat-title">Pending</div>
          <div className="stat-value text-warning">
            {pendingCount}
          </div>
        </div>

        <div className="stat">
          <div className="stat-title">Approved</div>
          <div className="stat-value text-success">
            {approvedCount}
          </div>
        </div>

        <div className="stat">
          <div className="stat-title">Rejected</div>
          <div className="stat-value text-error">
            {rejectedCount}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {/* Proposed Changes */}
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            Proposed Changes
          </h2>
          <p className="text-sm text-base-content/60">
            Each field can be approved or rejected independently.
          </p>
        </div>

        {changes.length === 0 ? (
          <div className="card bg-base-300">
            <div className="card-body items-center text-center py-10">
              <ClockIcon className="size-10 text-base-content/30" />
              <h3 className="font-semibold">
                No proposed changes found
              </h3>
            </div>
          </div>
        ) : (
          changes.map((change) => {
            const isPending = change.status === "PENDING";
            const isBusy = actionLoading === change.id;

            return (
              <div
                key={change.id}
                className="card bg-base-300 shadow-sm"
              >
                <div className="card-body gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h3 className="card-title text-base">
                      {getFieldLabel(change)}
                    </h3>

                    <span
                      className={`badge ${
                        change.status === "APPROVED"
                          ? "badge-success"
                          : change.status === "REJECTED"
                          ? "badge-error"
                          : "badge-warning"
                      }`}
                    >
                      {change.status || "PENDING"}
                    </span>
                  </div>

                  {/* Original and Proposed Values */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg bg-base-200 p-4">
                      <p className="text-xs font-bold text-base-content/50 mb-2">
                        ORIGINAL VALUE
                      </p>

                      <pre className="text-sm whitespace-pre-wrap break-words font-sans">
                        {displayValue(change.originalValue)}
                      </pre>
                    </div>

                    <div className="rounded-lg bg-base-200 p-4">
                      <p className="text-xs font-bold text-base-content/50 mb-2">
                        PROPOSED VALUE
                      </p>

                      <pre className="text-sm whitespace-pre-wrap break-words font-sans">
                        {displayValue(change.proposedValue)}
                      </pre>
                    </div>
                  </div>

                  {/* Rejection Reason */}
                  {change.rejectionReason && (
                    <div className="alert alert-error">
                      <XCircleIcon className="size-5" />
                      <div>
                        <p className="font-semibold">
                          Rejection Reason
                        </p>
                        <p className="text-sm">
                          {change.rejectionReason}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {isPending && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() =>
                          handleDecision(change.id, "REJECTED")
                        }
                        className="btn btn-outline btn-error btn-sm"
                        disabled={isBusy}
                      >
                        <XCircleIcon className="size-4" />
                        Reject Change
                      </button>

                      <button
                        onClick={() =>
                          handleDecision(change.id, "APPROVED")
                        }
                        className="btn btn-success btn-sm"
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <CheckIcon className="size-4" />
                        )}
                        Approve Change
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center border-t border-base-content/10 pt-4">
        <Link to="/profile" className="btn btn-ghost btn-sm">
          <ArrowLeftIcon className="size-4" />
          Back to Profile
        </Link>

        {pendingCount === 0 && changes.length > 0 && (
          <span className="text-sm text-success font-medium">
            All changes have been reviewed.
          </span>
        )}
      </div>
    </div>
  );
};

export default ModificationReviewPage;
