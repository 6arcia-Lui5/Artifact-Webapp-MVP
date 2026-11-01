
import { useEffect, useMemo, useState } from "react";
import { SignIn, SignUp, useAuth } from "@clerk/react";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CameraIcon,
  CheckCircle2Icon,
  CompassIcon,
  DatabaseIcon,
  Globe2Icon,
  LandmarkIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import {
  Link,
  Navigate,
  useSearchParams,
} from "react-router";

import accounts from "../../../shared/dev-accounts.json";
import LoadingSpinner from "../components/LoadingSpinner";

// Adjust this import path to match the location of your existing hook.
import { useRecords } from "../../hooks/useRecords";

// Validate redirect destinations to prevent unsafe redirects.
function safeDestination(value) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  ) {
    return "/";
  }

  const pathname = value.split(/[?#]/)[0];

  if (/^\/(login|signup)(\/|$)/i.test(pathname)) {
    return "/";
  }

  return value;
}

export default function LoginPage({ mode = "login" }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const [selectedEmail, setSelectedEmail] = useState("");

  const requestedDestination = params.get("redirect");

  const destination = safeDestination(
    requestedDestination ||
      sessionStorage.getItem("artifact.auth.redirect")
  );

  // Preserve the validated destination through Clerk's
  // password and verification steps.
  useEffect(() => {
    if (isSignedIn) {
      sessionStorage.removeItem("artifact.auth.redirect");
    } else if (requestedDestination) {
      sessionStorage.setItem(
        "artifact.auth.redirect",
        destination
      );
    }
  }, [isSignedIn, requestedDestination, destination]);

  const suffix = `?redirect=${encodeURIComponent(destination)}`;
  const signup = mode === "signup";

  const showPresets =
    import.meta.env.DEV &&
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") &&
    !signup;

  // Collection statistics
  const {
    data: records = [],
    isLoading: recordsLoading,
    isError: recordsError,
  } = useRecords();

  const contributorCount = useMemo(() => {
    const contributors = new Set();

    records.forEach((record) => {
      const userId = record.userId || record.user?.id;

      if (userId) {
        contributors.add(userId);
      }
    });

    return contributors.size;
  }, [records]);

  if (!isLoaded) return <LoadingSpinner />;

  if (isSignedIn) {
    return <Navigate to={destination} replace />;
  }

  // Clerk appearance
  const appearance = {
    variables: {
      colorPrimary: "#8a5800",
      colorTextOnPrimaryBackground: "#ffffff",
      borderRadius: "0.75rem",
      fontFamily: "inherit",
    },
    elements: {
      rootBox: {
        width: "100%",
      },
      cardBox: {
        width: "100%",
        boxShadow: "none",
        border: "none",
        borderRadius: "0.75rem",
      },
      card: {
        boxShadow: "none",
        padding: "0",
      },
      headerTitle: {
        fontWeight: "700",
      },
      headerSubtitle: {
        color: "hsl(var(--bc) / 0.65)",
      },
      formButtonPrimary: {
        fontWeight: "600",
      },
      footerActionLink: {
        color: "#8a5800",
      },
    },
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-8">

      {/* Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-base-300">
        <div className="absolute -right-20 -top-24 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-8 items-center p-6 sm:p-10 lg:p-12">

          <div className="lg:col-span-3">
            <span className="badge badge-primary badge-outline gap-2 mb-5 py-3">
              <LandmarkIcon className="size-4" />
              Handheld Words
            </span>

            <h1 className="text-4xl sm:text-5xl font-bold leading-tight">
              Every artifact has a story.
              <span className="text-primary block">
                Help preserve it.
              </span>
            </h1>

            <p className="text-base-content/70 text-base sm:text-lg mt-5 max-w-2xl leading-relaxed">
              Handheld Words is a collaborative platform for
              documenting, discovering, and preserving historical
              artifacts containing written inscriptions.
              From ancient coins to other handheld objects,
              every contribution helps build a more accessible
              record of the past.
            </p>

            <div className="flex flex-wrap gap-3 mt-7">
              <Link
                to="/signup"
                className="btn btn-primary gap-2"
              >
                Join the Community
                <ArrowRightIcon className="size-4" />
              </Link>

              <Link
                to="/search"
                className="btn btn-outline gap-2"
              >
                Explore the Collection
                <SearchIcon className="size-4" />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-2">
            <figure className="relative">
              <img
                src="/temporaryRomanCoin.png"
                alt="Two sides of an ancient Roman coin"
                className="w-full h-64 sm:h-80 object-cover rounded-xl shadow-xl"
              />

              <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-base-100/90 backdrop-blur-sm p-3">
                <div className="flex items-center gap-2">
                  <SparklesIcon className="size-5 text-primary" />
                  <div>
                    <p className="font-semibold text-sm">
                      Preserving the past
                    </p>
                    <p className="text-xs text-base-content/60">
                      One artifact and inscription at a time.
                    </p>
                  </div>
                </div>
              </div>
            </figure>
          </div>
        </div>
      </section>

      {/* Collection Statistics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <div className="card bg-base-200 shadow-sm">
          <div className="card-body flex-row items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 text-primary p-3">
              <DatabaseIcon className="size-7" />
            </div>

            <div>
              <p className="text-sm text-base-content/60">
                Artifacts Cataloged
              </p>

              <p className="text-3xl font-bold">
                {recordsLoading || recordsError
                  ? "—"
                  : records.length.toLocaleString()}
              </p>

              <p className="text-xs text-base-content/50">
                Records in the collection
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-base-200 shadow-sm">
          <div className="card-body flex-row items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 text-primary p-3">
              <UsersIcon className="size-7" />
            </div>

            <div>
              <p className="text-sm text-base-content/60">
                Community Contributors
              </p>

              <p className="text-3xl font-bold">
                {recordsLoading || recordsError
                  ? "—"
                  : contributorCount.toLocaleString()}
              </p>

              <p className="text-xs text-base-content/50">
                Contributors represented in the collection
              </p>
            </div>
          </div>
        </div>

      </section>

      {/* What is Handheld Words? */}
      <section className="space-y-5">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold">
            A collection built on shared knowledge
          </h2>

          <p className="text-base-content/60 mt-2">
            Bringing artifact documentation and historical
            information together in one searchable place.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <div className="card bg-base-200 shadow-sm">
            <div className="card-body">
              <div className="rounded-xl bg-primary/10 text-primary p-3 w-fit">
                <CameraIcon className="size-6" />
              </div>

              <h3 className="font-bold text-lg mt-2">
                Document Artifacts
              </h3>

              <p className="text-sm text-base-content/70">
                Upload images and record important details,
                including inscriptions, materials, dimensions,
                dates, and other identifying information.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 shadow-sm">
            <div className="card-body">
              <div className="rounded-xl bg-primary/10 text-primary p-3 w-fit">
                <SearchIcon className="size-6" />
              </div>

              <h3 className="font-bold text-lg mt-2">
                Discover Information
              </h3>

              <p className="text-sm text-base-content/70">
                Explore a searchable collection of artifacts
                and access the historical details documented
                by contributors.
              </p>
            </div>
          </div>

          <div className="card bg-base-200 shadow-sm">
            <div className="card-body">
              <div className="rounded-xl bg-primary/10 text-primary p-3 w-fit">
                <BookOpenIcon className="size-6" />
              </div>

              <h3 className="font-bold text-lg mt-2">
                Share Knowledge
              </h3>

              <p className="text-sm text-base-content/70">
                Contribute your findings, improve existing
                documentation, and help make historical
                information more accessible.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* How It Works */}
      <section className="card bg-base-300 shadow-sm">
        <div className="card-body p-6 sm:p-8">
          <div className="text-center mb-5">
            <h2 className="text-2xl font-bold">
              Get involved in three steps
            </h2>

            <p className="text-sm text-base-content/60 mt-2">
              Getting started is simple.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

            <div className="flex flex-col items-center text-center gap-2">
              <div className="rounded-full bg-primary text-primary-content size-11 flex items-center justify-center font-bold text-lg">
                1
              </div>

              <h3 className="font-semibold">
                Create an Account
              </h3>

              <p className="text-sm text-base-content/70">
                Join the community and create your contributor account.
              </p>
            </div>

            <div className="flex flex-col items-center text-center gap-2">
              <div className="rounded-full bg-primary text-primary-content size-11 flex items-center justify-center font-bold text-lg">
                2
              </div>

              <h3 className="font-semibold">
                Add an Artifact
              </h3>

              <p className="text-sm text-base-content/70">
                Submit images, inscriptions, and relevant historical details.
              </p>
            </div>

            <div className="flex flex-col items-center text-center gap-2">
              <div className="rounded-full bg-primary text-primary-content size-11 flex items-center justify-center font-bold text-lg">
                3
              </div>

              <h3 className="font-semibold">
                Build the Collection
              </h3>

              <p className="text-sm text-base-content/70">
                Share knowledge and help expand the available documentation.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Authentication */}
      <section
        id="authentication"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center"
      >

        <div className="space-y-5 px-2 sm:px-5">
          <div>
            <span className="badge badge-primary badge-outline mb-3">
              Become a Contributor
            </span>

            <h2 className="text-3xl font-bold">
              Help make history accessible.
            </h2>

            <p className="text-base-content/70 mt-3">
              Whether you are documenting a personal collection,
              researching inscriptions, or exploring historical
              objects, Handheld Words provides a place to organize
              and share that information.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle2Icon className="size-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-base-content/70">
                Create and manage your artifact records.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle2Icon className="size-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-base-content/70">
                Explore historical documentation from other contributors.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle2Icon className="size-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-base-content/70">
                Help preserve and improve shared artifact information.
              </p>
            </div>
          </div>
        </div>

        {/* Authentication Form */}
        <section className="card bg-base-200 shadow-sm">
          <div className="card-body p-5 sm:p-8 justify-center">

            <div className="mb-4">
              <h2 className="text-2xl font-bold">
                {signup ? "Create Your Account" : "Sign In"}
              </h2>

              <p className="text-sm text-base-content/60 mt-1">
                {signup
                  ? "Join the Handheld Words community."
                  : "Access your Handheld Words account."}
              </p>
            </div>

            {signup ? (
              <SignUp
                routing="path"
                path="/signup"
                signInUrl={`/login${suffix}`}
                forceRedirectUrl={destination}
                signInForceRedirectUrl={destination}
                appearance={appearance}
                fallback={<LoadingSpinner />}
              />
            ) : (
              <SignIn
                key={selectedEmail}
                routing="path"
                path="/login"
                signUpUrl={`/signup${suffix}`}
                initialValues={{
                  emailAddress: selectedEmail,
                }}
                forceRedirectUrl={destination}
                signUpForceRedirectUrl={destination}
                appearance={appearance}
                fallback={<LoadingSpinner />}
              />
            )}

            {/* Developer Test Accounts */}
            {showPresets && (
              <div className="collapse collapse-arrow bg-base-300 rounded-box mt-6">
                <input type="checkbox" />

                <div className="collapse-title font-semibold text-sm">
                  Developer Test Accounts
                </div>

                <div className="collapse-content">
                  <p className="text-xs text-base-content/60 mb-3">
                    Select an account to automatically fill its
                    email address. All five accounts share one
                    password. See the local developer account sheet.
                  </p>

                  <div className="flex flex-col gap-2">
                    {accounts.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        aria-pressed={
                          selectedEmail === account.email
                        }
                        onClick={() =>
                          setSelectedEmail(account.email)
                        }
                        className={`btn btn-sm h-auto min-h-12 justify-between ${
                          selectedEmail === account.email
                            ? "btn-primary"
                            : "btn-ghost bg-base-200"
                        }`}
                      >
                        <span className="text-left">
                          <span className="block font-semibold">
                            {account.name}
                          </span>

                          <span className="block text-xs opacity-70">
                            {account.email}
                          </span>
                        </span>

                        {selectedEmail === account.email && (
                          <ArrowRightIcon className="size-4" />
                        )}
                      </button>
                    ))}
                  </div>

                  <p className="text-xs text-base-content/50 mt-3">
                    Available only in development.
                    No email verification code is needed
                    for these five test accounts.
                  </p>
                </div>
              </div>
            )}

          </div>
        </section>
      </section>

      {/* Footer */}
      <footer className="border-t border-base-300 pt-5 pb-2 text-center">
        <div className="flex justify-center items-center gap-2 text-sm text-base-content/60">
          <Globe2Icon className="size-4" />
          Handheld Words
        </div>

        <p className="text-xs text-base-content/50 mt-2">
          Preserving historical knowledge through collaboration.
        </p>
      </footer>

    </div>
  );
}
