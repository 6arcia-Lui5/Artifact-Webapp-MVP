import React, { useState } from "react";
import { useSearchRecords } from "../../hooks/useRecords";
import { EyeIcon } from "lucide-react";
import { useNavigate } from "react-router";

function SearchPage() {
    const [searchQuery, setSearchQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const navigate = useNavigate();

    const {
        data: results = [],
        isLoading,
        isError,
    } = useSearchRecords(submittedQuery);

    const handleSearch = () => {
        setSubmittedQuery(searchQuery.trim());
    };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-3xl font-bold">Search Records</h1>
                <p className="text-base-content/70 mt-1">
                    Search through your records.
                </p>
            </div>

            <div className="card bg-base-200 shadow-sm">
                <div className="card-body">
                    <div className="join w-full">
                        <input
                            type="text"
                            placeholder="Search records..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    handleSearch();
                                }
                            }}
                            className="input input-bordered join-item w-full"
                        />

                        <button
                            onClick={handleSearch}
                            className="btn btn-primary join-item"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <span className="loading loading-spinner loading-sm"></span>
                            ) : (
                                "Search"
                            )}
                        </button>
                    </div>
                </div>
            </div>

            <div>
                <h2 className="text-xl font-semibold mb-3">
                    Results
                </h2>

                {isError && (
                    <div className="alert alert-error">
                        <span>Failed to search records.</span>
                    </div>
                )}

                {isLoading && (
                    <div className="flex justify-center py-4">
                        <span className="loading loading-spinner loading-md"></span>
                    </div>
                )}

                {!isLoading &&
                    !isError &&
                    submittedQuery &&
                    results.length === 0 && (
                        <div className="card bg-base-200 shadow-sm">
                            <div className="card-body">
                                <p>
                                    No records found for "{submittedQuery}".
                                </p>
                            </div>
                        </div>
                    )}

                {!isLoading && results.length > 0 && (
                    <div className="flex flex-col gap-3">
                        {results.map((record) => (
                            <div
                                key={record.id}
                                className="card bg-base-200 shadow-sm"
                            >
                                {/* Record information */}
                                <div className="card-body p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h2 className="card-title text-base">
                                                {record.itemName}
                                            </h2>

                                            {record.objectType?.name && (
                                                <span className="badge badge-outline badge-sm mt-1">
                                                    {record.objectType.name}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {record.museumDescription && (
                                        <p className="text-sm text-base-content/60 line-clamp-2">
                                            {record.museumDescription}
                                        </p>
                                    )}

                                    {record.museumName && (
                                        <p className="text-xs text-base-content/50">
                                            {record.museumName}
                                        </p>
                                    )}

                                    {/* Actions */}
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
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default SearchPage;
