
import React, { useState } from "react";
import { useSearchRecords } from "../../hooks/useRecords";
import {
    SearchIcon,
    EyeIcon,
    XIcon,
    ImageIcon,
} from "lucide-react";
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

    const handleSearch = (e) => {
        e?.preventDefault();
        setSubmittedQuery(searchQuery.trim());
    };

    const handleClear = () => {
        setSearchQuery("");
        setSubmittedQuery("");
    };

    return (
        <div className="flex flex-col gap-6 max-w-5xl mx-auto">

            {/* Page Header */}
            <div>
                <h1 className="text-3xl font-bold">Search Records</h1>
                <p className="text-base-content/70 mt-1">
                    Find artifacts using their names, inscriptions,
                    identifiers, or museum information.
                </p>
            </div>

            {/* Search Input */}
            <div className="card bg-base-200 shadow-sm">
                <div className="card-body p-4">
                    <form onSubmit={handleSearch}>
                        <div className="join w-full">
                            <input
                                type="text"
                                placeholder="Search records..."
                                value={searchQuery}
                                onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                }
                                className="input input-bordered join-item w-full"
                                aria-label="Search records"
                            />

                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="btn btn-ghost join-item"
                                    aria-label="Clear search"
                                >
                                    <XIcon className="size-4" />
                                </button>
                            )}

                            <button
                                type="submit"
                                className="btn btn-primary join-item"
                                disabled={isLoading || !searchQuery.trim()}
                            >
                                {isLoading ? (
                                    <span className="loading loading-spinner loading-sm" />
                                ) : (
                                    <>
                                        <SearchIcon className="size-4" />
                                        Search
                                    </>
                                )}
                            </button>
                        </div>
                    </form>

                    <p className="text-xs text-base-content/50 mt-2">
                        Search by artifact name, HHW, Museum ID, or
                        inscription.
                    </p>
                </div>
            </div>

            {/* Search Results */}
            <div className="flex flex-col gap-4">

                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">
                        Results
                    </h2>

                    {!isLoading &&
                        !isError &&
                        submittedQuery && (
                            <span className="text-sm text-base-content/60">
                                {results.length}{" "}
                                {results.length === 1 ? "record" : "records"} found
                            </span>
                        )}
                </div>

                {/* Error */}
                {isError && (
                    <div className="alert alert-error">
                        <span>
                            Failed to search records. Please try again.
                        </span>
                    </div>
                )}

                {/* Loading */}
                {isLoading && (
                    <div className="flex justify-center py-10">
                        <span className="loading loading-spinner loading-lg" />
                    </div>
                )}

                {/* Initial State */}
                {!isLoading &&
                    !isError &&
                    !submittedQuery && (
                        <div className="card bg-base-200 shadow-sm">
                            <div className="card-body items-center text-center py-10">
                                <SearchIcon className="size-10 text-base-content/30" />
                                <h3 className="font-semibold">
                                    Search the collection
                                </h3>
                                <p className="text-sm text-base-content/60">
                                    Enter a keyword or identifier to find
                                    artifact records.
                                </p>
                            </div>
                        </div>
                    )}

                {/* No Results */}
                {!isLoading &&
                    !isError &&
                    submittedQuery &&
                    results.length === 0 && (
                        <div className="card bg-base-200 shadow-sm">
                            <div className="card-body items-center text-center py-10">
                                <SearchIcon className="size-10 text-base-content/30" />
                                <h3 className="font-semibold">
                                    No records found
                                </h3>
                                <p className="text-sm text-base-content/60">
                                    No records matched "{submittedQuery}".
                                    Try another search term.
                                </p>
                            </div>
                        </div>
                    )}

                {/* Results List */}
                {!isLoading &&
                    !isError &&
                    results.length > 0 && (
                        <div className="flex flex-col gap-3">
                            {results.map((record) => {
                                const image =
                                    record.imageSourceUrl ||
                                    record.imageUrl;

                                return (
                                    <div
                                        key={record.id}
                                        className="card bg-base-200 shadow-sm hover:bg-base-300 transition-colors"
                                    >
                                        <div className="card-body p-4">
                                            <div className="flex flex-col sm:flex-row gap-4">

                                                {/* Thumbnail */}
                                                <div className="shrink-0">
                                                    {image ? (
                                                        <img
                                                            src={image}
                                                            alt={
                                                                record.itemName ||
                                                                record.title ||
                                                                "Artifact"
                                                            }
                                                            className="w-full sm:w-28 h-40 sm:h-28 object-cover rounded-lg bg-base-300"
                                                        />
                                                    ) : (
                                                        <div className="w-full sm:w-28 h-40 sm:h-28 rounded-lg bg-base-300 flex items-center justify-center text-base-content/40">
                                                            <ImageIcon className="size-8" />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Record Information */}
                                                <div className="flex flex-col flex-1 min-w-0 gap-2">

                                                    <div>
                                                        <h3 className="font-semibold text-base">
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

                                                    {/* Identifiers */}
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/60">
                                                        {record.hhw && (
                                                            <span>
                                                                <strong>HHW:</strong>{" "}
                                                                {record.hhw}
                                                            </span>
                                                        )}

                                                        {record.museumId && (
                                                            <span>
                                                                <strong>Museum ID:</strong>{" "}
                                                                {record.museumId}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Museum Information */}
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

                                                    {/* Contributor */}
                                                    {record.user?.name && (
                                                        <p className="text-xs text-base-content/50">
                                                            Contributor: {record.user.name}
                                                        </p>
                                                    )}

                                                    {/* Actions */}
                                                    <div className="card-actions justify-end mt-auto">
                                                        <button
                                                            onClick={() =>
                                                                navigate(
                                                                    `/record/${record.id}`
                                                                )
                                                            }
                                                            className="btn btn-ghost btn-sm gap-1"
                                                        >
                                                            <EyeIcon className="size-4" />
                                                            View Record
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
            </div>
        </div>
    );
}

export default SearchPage;
