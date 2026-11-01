
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@clerk/react";
import { useMyRecords, useDeleteRecord } from "../../hooks/useRecords";
import LoadingSpinner from "../components/LoadingSpinner";
import {
  PlusIcon,
  PackageIcon,
  EyeIcon,
  EditIcon,
  Trash2Icon,
  SearchIcon,
  ImageIcon,
  XIcon,
  InboxIcon,
  SendIcon,
  BellIcon,
  CheckIcon,
  RefreshCwIcon,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const ProfilePage = () => {
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const [activeTab, setActiveTab] = useState("records");
  const [searchQuery, setSearchQuery] = useState("");

  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const [isLoadingSection, setIsLoadingSection] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const {
    data: records = [],
    isLoading,
    isError,
  } = useMyRecords();

  const deleteRecord = useDeleteRecord();

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

  // Load data for the selected section.
  const loadSection = useCallback(async () => {
    if (activeTab === "records") return;

    setIsLoadingSection(true);
    setSectionError("");

    try {
      if (activeTab === "incoming") {
        const data = await apiRequest("/modifications/incoming");

        setIncomingRequests(
          Array.isArray(data) ? data : data.requests || []
        );
      }

      if (activeTab === "outgoing") {
        const data = await apiRequest("/modifications/outgoing");

        setOutgoingRequests(
          Array.isArray(data) ? data : data.requests || []
        );
      }

      if (activeTab === "notifications") {
        const data = await apiRequest("/notifications");

        setNotifications(
          Array.isArray(data) ? data : data.notifications || []
        );
      }
    } catch (error) {
      setSectionError(error.message);
    } finally {
      setIsLoadingSection(false);
    }
  }, [activeTab, apiRequest]);

  useEffect(() => {
    loadSection();
  }, [loadSection]);

  // Delete one of the user's original records.
  const handleDelete = (id) => {
    if (confirm("Are you sure you want to delete this record?")) {
      deleteRecord.mutate(id);
    }
  };

  // Filter the user's records locally.
  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) return records;

    return records.filter((record) => {
      const searchableFields = [
        record.itemName,
        record.title,
        record.hhw,
        record.museumId,
        record.museumName,
        record.objectType?.name,
      ];

      return searchableFields.some((field) =>
        String(field || "").toLowerCase().includes(query)
      );
    });
  }, [records, searchQuery]);

  const formatDate = (date) => {
    if (!date) return "Date unavailable";

    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Display field-level progress for a modification request.
  const getRequestProgress = (request) => {
    const changes = request.changes || [];

    const pending = changes.filter(
      (change) => change.status === "PENDING"
    ).length;

    const approved = changes.filter(
      (change) => change.status === "APPROVED"
    ).length;

    const rejected = changes.filter(
      (change) => change.status === "REJECTED"
    ).length;

    return {
      total: changes.length,
      pending,
      approved,
      rejected,
    };
  };

  const getRequestStatus = (request) => {
    const progress = getRequestProgress(request);

    if (progress.total === 0) return "EMPTY";
    if (progress.pending > 0) return "PENDING";
    if (progress.approved === progress.total) return "APPROVED";
    if (progress.rejected === progress.total) return "REJECTED";
    if (progress.approved > 0 && progress.rejected > 0) {
      return "PARTIALLY APPROVED";
    }

    return "REVIEWED";
  };

  const getStatusBadge = (status) => {
    const classes = {
      PENDING: "badge-warning",
      APPROVED: "badge-success",
      REJECTED: "badge-error",
      "PARTIALLY APPROVED": "badge-info",
      REVIEWED: "badge-info",
      EMPTY: "badge-ghost",
    };

    return (
      <span className={`badge ${classes[status] || "badge-ghost"}`}>
        {status}
      </span>
    );
  };

  // Mark an individual notification as read.
  const handleMarkNotificationRead = async (notification) => {
    if (notification.isRead || actionLoading) return;

    setActionLoading(true);
    setSectionError("");

    try {
      await apiRequest(
        `/api/notifications/${notification.id}/read`,
        { method: "PATCH" }
      );

      setNotifications((previous) =>
        previous.map((item) =>
          item.id === notification.id
            ? { ...item, isRead: true }
            : item
        )
      );
    } catch (error) {
      setSectionError(error.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Mark all notifications as read.
  const handleMarkAllRead = async () => {
    const unreadNotifications = notifications.filter(
      (notification) => !notification.isRead
    );

    if (unreadNotifications.length === 0 || actionLoading) return;

    setActionLoading(true);
    setSectionError("");

    try {
      await Promise.all(
        unreadNotifications.map((notification) =>
          apiRequest(
            `/api/notifications/${notification.id}/read`,
            { method: "PATCH" }
          )
        )
      );

      setNotifications((previous) =>
        previous.map((notification) => ({
          ...notification,
          isRead: true,
        }))
      );
    } catch (error) {
      setSectionError(error.message);
      await loadSection();
    } finally {
      setActionLoading(false);
    }
  };

  const unreadCount = notifications.filter(
    (notification) => !notification.isRead
  ).length;

  // Only requests with at least one undecided field need review.
  const pendingRequestCount = incomingRequests.filter(
    (request) =>
      getRequestProgress(request).pending > 0
  ).length;

  const tabs = [
    {
      id: "records",
      label: "My Records",
      icon: PackageIcon,
    },
    {
      id: "incoming",
      label: "Pending Modifications",
      icon: InboxIcon,
      count: pendingRequestCount,
    },
    {
      id: "outgoing",
      label: "My Suggestions",
      icon: SendIcon,
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: BellIcon,
      count: unreadCount,
    },
  ];

  if (isLoading) return <LoadingSpinner />;

  if (isError) {
    return (
      <div className="alert alert-error">
        <span>Failed to load your records. Please try again.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Profile</h1>
          <p className="text-base-content/60 mt-1">
            Manage your records and contributions to Handheld Words.
          </p>
        </div>

        <Link to="/create" className="btn btn-primary btn-sm gap-1">
          <PlusIcon className="size-4" />
          New Record
        </Link>
      </div>

      {/* Navigation Tabs */}
      <div className="tabs tabs-boxed bg-base-300 p-1 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab gap-2 ${
                activeTab === tab.id ? "tab-active" : ""
              }`}
            >
              <Icon className="size-4" />
              {tab.label}

              {tab.count > 0 && (
                <span className="badge badge-sm badge-primary">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Section Error */}
      {sectionError && (
        <div className="alert alert-error">
          <span>{sectionError}</span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setSectionError("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MY RECORDS */}
      {activeTab === "records" && (
        <>
          <div className="stats stats-vertical sm:stats-horizontal bg-base-300 shadow-sm w-full">
            <div className="stat">
              <div className="stat-figure text-primary">
                <PackageIcon className="size-8" />
              </div>

              <div className="stat-title">Total Records</div>
              <div className="stat-value text-primary">
                {records.length}
              </div>
              <div className="stat-desc">
                Records originally published by you
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Your Collection</h2>
                <p className="text-sm text-base-content/60">
                  {filteredRecords.length} of {records.length} records
                </p>
              </div>

              {records.length > 0 && (
                <div className="join w-full sm:max-w-sm">
                  <input
                    type="text"
                    placeholder="Search your records..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input input-bordered join-item w-full"
                    aria-label="Search your records"
                  />

                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="btn btn-ghost join-item"
                      aria-label="Clear search"
                    >
                      <XIcon className="size-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-ghost join-item"
                    aria-label="Search"
                  >
                    <SearchIcon className="size-4" />
                  </button>
                </div>
              )}
            </div>

            {records.length === 0 && (
              <div className="card bg-base-300 shadow-sm">
                <div className="card-body items-center text-center py-16">
                  <PackageIcon className="size-16 text-base-content/20" />

                  <h3 className="card-title text-base-content/60">
                    No records yet
                  </h3>

                  <p className="text-base-content/50 text-sm">
                    Start by creating your first artifact record.
                  </p>

                  <Link
                    to="/create"
                    className="btn btn-primary btn-sm mt-4"
                  >
                    <PlusIcon className="size-4" />
                    Create Record
                  </Link>
                </div>
              </div>
            )}

            {records.length > 0 && filteredRecords.length === 0 && (
              <div className="card bg-base-300 shadow-sm">
                <div className="card-body items-center text-center py-12">
                  <SearchIcon className="size-10 text-base-content/30" />

                  <h3 className="font-semibold">
                    No matching records
                  </h3>

                  <p className="text-sm text-base-content/60">
                    No records matched "{searchQuery}".
                  </p>

                  <button
                    onClick={() => setSearchQuery("")}
                    className="btn btn-ghost btn-sm mt-2"
                  >
                    Clear Search
                  </button>
                </div>
              </div>
            )}

            {filteredRecords.length > 0 && (
              <div className="flex flex-col gap-3">
                {filteredRecords.map((record) => {
                  const image =
                    record.imageSourceUrl || record.imageUrl;

                  return (
                    <div
                      key={record.id}
                      className="card card-side bg-base-300 shadow-sm hover:bg-base-200 transition-colors"
                    >
                      <figure className="w-28 sm:w-36 shrink-0 bg-base-200">
                        {image ? (
                          <img
                            src={image}
                            alt={record.itemName || "Artifact"}
                            className="h-full min-h-32 w-full object-cover"
                          />
                        ) : (
                          <div className="min-h-32 w-full flex items-center justify-center text-base-content/40">
                            <ImageIcon className="size-8" />
                          </div>
                        )}
                      </figure>

                      <div className="card-body p-4 min-w-0 gap-2">
                        <div>
                          <h3 className="card-title text-base">
                            {record.itemName ||
                              record.title ||
                              "Untitled Record"}
                          </h3>

                          {record.objectType?.name && (
                            <span className="badge badge-outline badge-sm mt-1">
                              {record.objectType.name}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60">
                          {record.hhw && (
                            <span>
                              <strong>HHW:</strong> {record.hhw}
                            </span>
                          )}

                          {record.museumId && (
                            <span>
                              <strong>Museum ID:</strong> {record.museumId}
                            </span>
                          )}
                        </div>

                        {record.museumName && (
                          <p className="text-sm text-base-content/70">
                            {record.museumName}
                          </p>
                        )}

                        {record.museumDescription && (
                          <p className="text-sm text-base-content/60 line-clamp-2">
                            {record.museumDescription}
                          </p>
                        )}

                        <div className="card-actions justify-end mt-2">
                          <button
                            onClick={() =>
                              navigate(`/record/${record.id}`)
                            }
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <EyeIcon className="size-3" />
                            View
                          </button>

                          <button
                            onClick={() =>
                              navigate(`/edit/${record.id}`)
                            }
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <EditIcon className="size-3" />
                            Edit
                          </button>

                          <button
                            onClick={() => handleDelete(record.id)}
                            className="btn btn-ghost btn-xs text-error gap-1"
                            disabled={deleteRecord.isPending}
                          >
                            {deleteRecord.isPending ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              <Trash2Icon className="size-3" />
                            )}
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* PENDING MODIFICATIONS */}
      {activeTab === "incoming" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Pending Modifications
              </h2>
              <p className="text-sm text-base-content/60">
                Review suggestions made to records you originally published.
              </p>
            </div>

            <button
              onClick={loadSection}
              className="btn btn-ghost btn-sm"
              disabled={isLoadingSection}
              aria-label="Refresh modifications"
            >
              <RefreshCwIcon className="size-4" />
            </button>
          </div>

          {isLoadingSection ? (
            <LoadingSpinner />
          ) : incomingRequests.length === 0 ? (
            <div className="card bg-base-300">
              <div className="card-body items-center text-center py-12">
                <InboxIcon className="size-12 text-base-content/30" />

                <h3 className="font-semibold">
                  No modification requests
                </h3>

                <p className="text-sm text-base-content/60">
                  Suggestions from other contributors will appear here.
                </p>
              </div>
            </div>
          ) : (
            incomingRequests.map((request) => {
              const progress = getRequestProgress(request);
              const status = getRequestStatus(request);

              const record = request.record || {};

              return (
                <div
                  key={request.id}
                  className="card bg-base-300 shadow-sm"
                >
                  <div className="card-body gap-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                      <div>
                        <h3 className="card-title text-base">
                          {record.itemName ||
                            record.title ||
                            "Artifact Record"}
                        </h3>

                        <p className="text-sm text-base-content/60">
                          Suggested by{" "}
                          {request.modifier?.name ||
                            request.modifier?.username ||
                            "Contributor"}
                        </p>

                        <p className="text-xs text-base-content/50 mt-1">
                          Submitted {formatDate(request.createdAt)}
                        </p>

                        {record.hhw && (
                          <p className="text-xs text-base-content/60 mt-1">
                            HHW: {record.hhw}
                          </p>
                        )}
                      </div>

                      {getStatusBadge(status)}
                    </div>

                    {/* Change Progress */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="badge badge-outline">
                        {progress.total} proposed{" "}
                        {progress.total === 1 ? "change" : "changes"}
                      </span>

                      {progress.pending > 0 && (
                        <span className="badge badge-warning">
                          {progress.pending} pending
                        </span>
                      )}

                      {progress.approved > 0 && (
                        <span className="badge badge-success">
                          {progress.approved} approved
                        </span>
                      )}

                      {progress.rejected > 0 && (
                        <span className="badge badge-error">
                          {progress.rejected} rejected
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {progress.total > 0 && (
                      <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-base-200">
                        {progress.approved > 0 && (
                          <div
                            className="bg-success"
                            style={{
                              width: `${(progress.approved / progress.total) * 100}%`,
                            }}
                          />
                        )}

                        {progress.rejected > 0 && (
                          <div
                            className="bg-error"
                            style={{
                              width: `${(progress.rejected / progress.total) * 100}%`,
                            }}
                          />
                        )}

                        {progress.pending > 0 && (
                          <div
                            className="bg-warning"
                            style={{
                              width: `${(progress.pending / progress.total) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    )}

                    <div className="card-actions justify-end">
                      {record.id && (
                        <Link
                          to={`/record/${record.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          <EyeIcon className="size-4" />
                          View Record
                        </Link>
                      )}

                      <button
                        onClick={() =>
                          navigate(
                            `/modifications/${request.id}/review`
                          )
                        }
                        className="btn btn-primary btn-sm"
                      >
                        {progress.pending > 0
                          ? "Review Request"
                          : "View Decisions"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MY SUGGESTIONS */}
      {activeTab === "outgoing" && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">My Suggestions</h2>
            <p className="text-sm text-base-content/60">
              Track changes you've proposed to other contributors' records.
            </p>
          </div>

          {isLoadingSection ? (
            <LoadingSpinner />
          ) : outgoingRequests.length === 0 ? (
            <div className="card bg-base-300">
              <div className="card-body items-center text-center py-12">
                <SendIcon className="size-12 text-base-content/30" />

                <h3 className="font-semibold">
                  No suggestions submitted
                </h3>

                <p className="text-sm text-base-content/60">
                  Suggestions you submit will appear here.
                </p>
              </div>
            </div>
          ) : (
            outgoingRequests.map((request) => {
              const progress = getRequestProgress(request);
              const status = getRequestStatus(request);

              return (
                <div
                  key={request.id}
                  className="card bg-base-300 shadow-sm"
                >
                  <div className="card-body gap-3">
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                      <div>
                        <h3 className="card-title text-base">
                          {request.record?.itemName ||
                            request.record?.title ||
                            "Artifact Record"}
                        </h3>

                        <p className="text-sm text-base-content/60">
                          Submitted {formatDate(request.createdAt)}
                        </p>

                        <p className="text-sm text-base-content/60">
                          Original publisher:{" "}
                          {request.publisher?.name || "Contributor"}
                        </p>
                      </div>

                      {getStatusBadge(status)}
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="badge badge-outline">
                        {progress.total} proposed{" "}
                        {progress.total === 1 ? "change" : "changes"}
                      </span>

                      {progress.pending > 0 && (
                        <span className="badge badge-warning">
                          {progress.pending} pending
                        </span>
                      )}

                      {progress.approved > 0 && (
                        <span className="badge badge-success">
                          {progress.approved} approved
                        </span>
                      )}

                      {progress.rejected > 0 && (
                        <span className="badge badge-error">
                          {progress.rejected} rejected
                        </span>
                      )}
                    </div>

                    <div className="divider my-0" />

                    {(request.changes || []).map((change) => (
                      <div
                        key={change.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-base-content/10 pb-3 last:border-0"
                      >
                        <div>
                          <p className="font-medium text-sm">
                            {change.fieldLabel ||
                              change.fieldName ||
                              change.field}
                          </p>

                          <p className="text-xs text-base-content/60 break-words">
                            {change.originalValue ?? "Empty"} →{" "}
                            {change.proposedValue ?? "Empty"}
                          </p>

                          {change.rejectionReason && (
                            <p className="text-xs text-error mt-1">
                              Reason: {change.rejectionReason}
                            </p>
                          )}
                        </div>

                        {getStatusBadge(change.status || "PENDING")}
                      </div>
                    ))}

                    <div className="card-actions justify-end">
                      {request.record?.id && (
                        <Link
                          to={`/record/${request.record.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          <EyeIcon className="size-4" />
                          View Record
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* NOTIFICATIONS */}
      {activeTab === "notifications" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Notifications</h2>

              <p className="text-sm text-base-content/60">
                Updates about your records and suggested modifications.
              </p>
            </div>

            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="btn btn-ghost btn-sm"
                  disabled={actionLoading}
                >
                  <CheckIcon className="size-4" />
                  Mark All Read
                </button>
              )}

              <button
                onClick={loadSection}
                className="btn btn-ghost btn-sm"
                disabled={isLoadingSection}
                aria-label="Refresh notifications"
              >
                <RefreshCwIcon className="size-4" />
              </button>
            </div>
          </div>

          {isLoadingSection ? (
            <LoadingSpinner />
          ) : notifications.length === 0 ? (
            <div className="card bg-base-300">
              <div className="card-body items-center text-center py-12">
                <BellIcon className="size-12 text-base-content/30" />

                <h3 className="font-semibold">
                  You're all caught up
                </h3>

                <p className="text-sm text-base-content/60">
                  Notifications will appear here when there are updates.
                </p>
              </div>
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`card shadow-sm ${
                  notification.isRead
                    ? "bg-base-300"
                    : "bg-base-200 border border-primary/30"
                }`}
              >
                <div className="card-body p-4 flex-row items-start gap-3">
                  <BellIcon className="size-5 text-primary shrink-0 mt-1" />

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2">
                      <h3 className="font-semibold">
                        {notification.title || "Notification"}
                      </h3>

                      {!notification.isRead && (
                        <span className="badge badge-primary badge-sm">
                          New
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-base-content/70 mt-1">
                      {notification.message}
                    </p>

                    <p className="text-xs text-base-content/50 mt-2">
                      {formatDate(notification.createdAt)}
                    </p>

                    <div className="flex flex-wrap gap-2 mt-3">
                      {!notification.isRead && (
                        <button
                          onClick={() =>
                            handleMarkNotificationRead(notification)
                          }
                          className="btn btn-ghost btn-xs"
                          disabled={actionLoading}
                        >
                          <CheckIcon className="size-3" />
                          Mark as Read
                        </button>
                      )}

                      {notification.href && (
                        <Link
                          to={notification.href}
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            handleMarkNotificationRead(notification)
                          }
                        >
                          View Details
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
