import { Link } from "react-router";
import { UserButton, useAuth } from "@clerk/react";
import { DraftingCompassIcon, PlusIcon, UserIcon, Search, FolderIcon, UploadIcon, ClipboardCheckIcon } from "lucide-react";
import { useResearchAccess } from '../../hooks/useResearchAccess';

export default function Navbar() {
  const { isLoaded, isSignedIn } = useAuth();
  const access = useResearchAccess();
  return (
    <header className="navbar bg-purple-950 text-secondary">
      <nav aria-label="Main navigation" className="max-w-5xl mx-auto w-full px-4 flex flex-wrap items-center justify-between gap-3 py-2">
        <Link to="/" className="flex items-center gap-2">
          <DraftingCompassIcon className="size-5 text-primary" aria-hidden="true" />
          <span className="text-lg font-bold font-serif uppercase">The Artifact Site</span>
        </Link>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {isLoaded && (isSignedIn ? (
            <>
              <Link to="/search" aria-label="Search" className="btn btn-ghost btn-sm gap-1">
                <Search className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Search</span>
              </Link>
              <Link to="/collections" aria-label="Collections" className="btn btn-ghost btn-sm gap-1"><FolderIcon className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Collections</span></Link>
              <Link to="/import" aria-label="Import records" className="btn btn-ghost btn-sm gap-1"><UploadIcon className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Import</span></Link>
              {access.data?.canReview && <Link to="/review" aria-label="Review submissions" className="btn btn-ghost btn-sm gap-1"><ClipboardCheckIcon className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Review</span></Link>}
              <Link to="/create" className="btn btn-primary btn-sm gap-1">
                <PlusIcon className="size-4" aria-hidden="true" /> New Record
              </Link>
              <Link to="/profile" aria-label="Profile" className="btn btn-ghost btn-sm gap-1">
                <UserIcon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Profile</span>
              </Link>
              <UserButton />
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
              {import.meta.env.DEV && <Link to="/signup" className="btn btn-primary btn-sm">Sign up</Link>}
            </>
          ))}
        </div>
      </nav>
    </header>
  );
}
