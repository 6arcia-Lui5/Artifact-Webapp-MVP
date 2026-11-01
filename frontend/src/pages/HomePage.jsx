
import { useRecords } from "../../hooks/useRecords";
import {
  PackageIcon,
  SparklesIcon,
  SearchIcon,
  UsersIcon,
  ArrowRightIcon,
  BookOpenIcon,
} from "lucide-react";
import { Link } from "react-router";
import LoadingSpinner from "../components/LoadingSpinner";
import RecordCard from "../components/RecordCard";

function HomePage() {
  const {
    data: records = [],
    isLoading,
    error,
  } = useRecords();

  if (isLoading) return <LoadingSpinner />;

  if (error) {
    return (
      <div role="alert" className="alert alert-error">
        <span>
          Something went wrong while loading the collection.
          Please refresh the page.
        </span>
      </div>
    );
  }

  // Count unique contributors when contributor IDs are available.
  const contributorCount = new Set(
    records
      .map((record) => record.userId || record.user?.id)
      .filter(Boolean)
  ).size;

  return (
    <div className="flex flex-col gap-10">

      {/* HERO */}
      <section className="hero bg-linear-to-br from-base-300 via-base-200 to-base-300 rounded-box overflow-hidden">
        <div className="hero-content flex-col lg:flex-row-reverse gap-10 py-10 px-6 sm:px-10">

          {/* Hero Image */}
          <div className="relative shrink-0">
            <img
              src="./temporaryRomanCoin.png"
              alt="Historical coin artifact"
              className="h-56 w-full sm:w-96 lg:h-72 object-cover rounded-2xl shadow-2xl"
            />
          </div>

          {/* Hero Text */}
          <div className="text-center lg:text-left max-w-xl">

            <h1 className="text-4xl lg:text-5xl font-bold leading-tight">
              Preserve History.
              <br />
              Share Your{" "}
              <span className="text-primary">
                Artifacts.
              </span>
            </h1>

            <p className="py-4 text-base-content/70">
              Discover, document, and classify historical objects
              containing written inscriptions. Contribute to a
              growing collection of artifacts and historical
              knowledge.
            </p>

            <div className="flex flex-wrap justify-center lg:justify-start gap-3">
              <Link to="/create" className="btn btn-primary">
                <SparklesIcon className="size-4" />
                Contribute an Artifact
              </Link>

              <Link to="/search" className="btn btn-outline">
                <SearchIcon className="size-4" />
                Search Collection
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* COLLECTION STATISTICS */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <div className="stat bg-base-300 rounded-box shadow-sm">
            <div className="stat-figure text-primary">
              <PackageIcon className="size-8" />
            </div>

            <div className="stat-title">
              Total Artifacts
            </div>

            <div className="stat-value text-primary">
              {records.length}
            </div>

            <div className="stat-desc">
              Documented in the collection
            </div>
          </div>

          <div className="stat bg-base-300 rounded-box shadow-sm">
            <div className="stat-figure text-secondary">
              <UsersIcon className="size-8" />
            </div>

            <div className="stat-title">
              Contributors
            </div>

            <div className="stat-value text-secondary">
              {contributorCount}
            </div>

            <div className="stat-desc">
              Unique contributors
            </div>
          </div>

        </div>
      </section>

      {/* COLLECTION */}
      <section className="flex flex-col gap-4">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <PackageIcon className="size-6 text-primary" />
              All Artifacts
            </h2>

            <p className="text-sm text-base-content/60 mt-1">
              Explore the artifacts documented by our contributors.
            </p>
          </div>

          <Link
            to="/search"
            className="btn btn-ghost btn-sm gap-2 self-start sm:self-auto"
          >
            Search Records
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>

        {/* Empty Collection */}
        {records.length === 0 ? (
          <div className="card bg-base-300 shadow-sm">
            <div className="card-body items-center text-center py-16">

              <BookOpenIcon className="size-16 text-base-content/20" />

              <h3 className="card-title text-base-content/60">
                No artifact records available
              </h3>

              <p className="text-base-content/50 text-sm">
                Be the first to contribute an artifact to
                the Handheld Words collection.
              </p>

              <Link
                to="/create"
                className="btn btn-primary btn-sm mt-3"
              >
                <PlusIconFallback />
                Create an Artifact Record
              </Link>

            </div>
          </div>
        ) : (
          <>
            <div className="text-sm text-base-content/60">
              Showing {records.length}{" "}
              {records.length === 1 ? "artifact" : "artifacts"}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {records.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                />
              ))}
            </div>
          </>
        )}
      </section>

    </div>
  );
}

function PlusIconFallback() {
  return <SparklesIcon className="size-4" />;
}

export default HomePage;
