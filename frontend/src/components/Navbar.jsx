
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router";
import {
  SignUpButton,
  SignInButton,
  UserButton,
  useAuth as useClerkAuth,
} from "@clerk/react";

import {
  PlusIcon,
  UserIcon,
  SearchIcon,
  MenuIcon,
  XIcon,
  LandmarkIcon,
  BellIcon,
  CheckCheckIcon,
  InboxIcon,
} from "lucide-react";

import useAuth from "../../hooks/useAuthReq";


// --------------------------------------------------
// Notification Component
// --------------------------------------------------

function NotificationBell({ mobile = false }) {
  const { isSignedIn } = useAuth();
  const { getToken } = useClerkAuth();

  const [notifications, setNotifications] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const unreadCount = notifications.filter(
    (notification) => !notification.isRead
  ).length;


  // Fetch notifications.
  const fetchNotifications = async () => {
    try {
      const token = await getToken();

      const response = await fetch("/api/notifications", {
        credentials: "include",
        headers: {
          ...(token && {
            Authorization: `Bearer ${token}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error("Unable to retrieve notifications.");
      }

      const data = await response.json();

      setNotifications(
        Array.isArray(data) ? data : data.notifications || []
      );

    } catch (error) {
      console.error("Notification fetch failed:", error);
    }
  };


  // Fetch immediately and refresh periodically.
  useEffect(() => {
    if (!isSignedIn) {
      setNotifications([]);
      return;
    }

    fetchNotifications();

    const interval = setInterval(fetchNotifications, 60000);

    return () => clearInterval(interval);
  }, [isSignedIn]);


  // Mark a notification as read.
  const markAsRead = async (notificationId) => {
    try {
      const token = await getToken();

      const response = await fetch(
        `/api/notifications/${notificationId}/read`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            ...(token && {
              Authorization: `Bearer ${token}`,
            }),
          },
        }
      );

      if (!response.ok) {
        throw new Error("Unable to mark notification as read.");
      }

      setNotifications((previous) =>
        previous.map((notification) =>
          notification.id === notificationId
            ? { ...notification, isRead: true }
            : notification
        )
      );

    } catch (error) {
      console.error("Unable to update notification:", error);
    }
  };


  if (!isSignedIn) return null;


  return (
    <div className={`relative ${mobile ? "w-full" : ""}`}>

      {/* Notification Button */}
      <button
        type="button"
        onClick={() => setMenuOpen((previous) => !previous)}
        className={
          mobile
            ? "btn btn-ghost btn-sm w-full justify-start gap-3"
            : "btn btn-ghost btn-square relative"
        }
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={menuOpen}
      >
        <span className="relative">
          <BellIcon className="size-5" />

          {unreadCount > 0 && (
            <span className="absolute -top-2 -right-2 badge badge-error badge-xs min-w-4 px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </span>

        {mobile && (
          <>
            Notifications

            {unreadCount > 0 && (
              <span className="badge badge-error badge-sm ml-auto">
                {unreadCount}
              </span>
            )}
          </>
        )}
      </button>


      {/* Notification Dropdown */}
      {menuOpen && (
        <div
          className={`
            absolute z-[60] mt-2
            w-80 max-w-[calc(100vw-2rem)]
            rounded-xl border border-base-300
            bg-base-100 text-base-content shadow-2xl
            ${mobile ? "left-0" : "right-0"}
          `}
        >

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300">

            <div>
              <h3 className="font-semibold">
                Notifications
              </h3>

              <p className="text-xs text-base-content/50">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>

            <BellIcon className="size-5 text-base-content/50" />

          </div>


          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">

            {notifications.length === 0 ? (
              <div className="flex flex-col items-center text-center p-6 gap-2">

                <InboxIcon className="size-8 text-base-content/30" />

                <p className="text-sm font-medium">
                  No notifications yet
                </p>

                <p className="text-xs text-base-content/50">
                  Updates about your contributions and modification
                  requests will appear here.
                </p>

              </div>
            ) : (
              notifications.slice(0, 8).map((notification) => (
                <Link
                  key={notification.id}
                  to={
                    notification.href ||
                    "/profile?tab=notifications"
                  }
                  onClick={() => {
                    if (!notification.isRead) {
                      markAsRead(notification.id);
                    }

                    setMenuOpen(false);
                  }}
                  className={`
                    flex items-start gap-3 p-4
                    border-b border-base-300
                    transition-colors hover:bg-base-200
                    ${!notification.isRead ? "bg-primary/5" : ""}
                  `}
                >

                  <div className="mt-1 shrink-0">
                    {notification.isRead ? (
                      <BellIcon className="size-4 text-base-content/40" />
                    ) : (
                      <span className="block size-2.5 rounded-full bg-primary" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">

                    <p className="text-sm font-medium">
                      {notification.title || "Notification"}
                    </p>

                    <p className="text-xs text-base-content/60 mt-1">
                      {notification.message}
                    </p>

                    {notification.createdAt && (
                      <p className="text-xs text-base-content/40 mt-2">
                        {new Date(
                          notification.createdAt
                        ).toLocaleString()}
                      </p>
                    )}

                  </div>

                </Link>
              ))
            )}

          </div>


          {/* Footer */}
          <Link
            to="/profile?tab=notifications"
            onClick={() => setMenuOpen(false)}
            className="flex items-center justify-center gap-2 p-3 text-sm font-medium text-primary hover:bg-base-200 rounded-b-xl"
          >
            View All Notifications
          </Link>

        </div>
      )}

    </div>
  );
}


// --------------------------------------------------
// Navbar
// --------------------------------------------------

export default function Navbar() {
  const { isSignedIn } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navigationLinks = [
    { name: "About", to: "/about" },
    { name: "Collections", to: "/" },
    { name: "Research", to: "/research" },
  ];

  const navLinkClass = ({ isActive }) =>
    `relative text-sm font-medium transition-colors
    after:absolute after:left-0 after:-bottom-1 after:h-0.5
    after:bg-white after:transition-all after:duration-300
    ${
      isActive
        ? "text-white after:w-full"
        : "text-secondary/80 hover:text-white after:w-0 hover:after:w-full"
    }`;


  return (
    <header className="sticky top-0 z-50">

      <div className="navbar bg-purple-950 text-secondary shadow-lg">

        <div className="max-w-7xl mx-auto w-full px-4 flex justify-between items-center">

          {/* Brand */}
          <div className="flex items-center gap-8">

            <Link
              to="/"
              className="btn btn-ghost hover:bg-white/10 gap-2 px-2"
            >
              <div className="rounded-lg bg-white/10 p-2">
                <LandmarkIcon className="size-5 text-primary" />
              </div>

              <div className="flex flex-col items-start leading-tight">
                <span className="text-lg font-bold font-serif uppercase tracking-tight text-white">
                  Handheld Words
                </span>
              </div>
            </Link>


            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-6">

              {navigationLinks.map((link) => (
                <NavLink
                  key={link.name}
                  to={link.to}
                  end={link.to === "/"}
                  className={navLinkClass}
                >
                  {link.name}
                </NavLink>
              ))}

            </nav>

          </div>


          {/* Desktop Account Actions */}
          <div className="hidden md:flex items-center gap-2">

            {isSignedIn ? (
              <>

                <Link
                  to="/search"
                  className="btn btn-ghost btn-sm gap-2"
                >
                  <SearchIcon className="size-4" />
                  Search
                </Link>

                <Link
                  to="/create"
                  className="btn btn-primary btn-sm gap-2"
                >
                  <PlusIcon className="size-4" />
                  New Record
                </Link>

                {/* Notifications */}
                <NotificationBell />

                <Link
                  to="/profile"
                  className="btn btn-ghost btn-sm gap-2"
                >
                  <UserIcon className="size-4" />
                  Profile
                </Link>

                <div className="ml-2">
                  <UserButton />
                </div>

              </>
            ) : (
              <>

                <SignInButton mode="modal">
                  <button className="btn btn-ghost btn-sm">
                    Sign In
                  </button>
                </SignInButton>

                <SignUpButton mode="modal">
                  <button className="btn btn-primary btn-sm">
                    Sign Up
                  </button>
                </SignUpButton>

              </>
            )}

          </div>


          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="btn btn-ghost btn-square md:hidden"
            aria-label={
              menuOpen
                ? "Close navigation menu"
                : "Open navigation menu"
            }
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? (
              <XIcon className="size-6" />
            ) : (
              <MenuIcon className="size-6" />
            )}
          </button>

        </div>
      </div>


      {/* Mobile Navigation */}
      {menuOpen && (
        <div className="md:hidden bg-purple-950 border-t border-white/10 shadow-xl">

          <div className="max-w-7xl mx-auto px-5 py-5 space-y-5">

            <nav className="flex flex-col gap-4">

              {navigationLinks.map((link) => (
                <NavLink
                  key={link.name}
                  to={link.to}
                  end={link.to === "/"}
                  className={({ isActive }) =>
                    `text-sm font-medium ${
                      isActive
                        ? "text-white"
                        : "text-secondary/70 hover:text-white"
                    }`
                  }
                  onClick={() => setMenuOpen(false)}
                >
                  {link.name}
                </NavLink>
              ))}

            </nav>


            <div className="border-t border-white/10 pt-4 space-y-3">

              {isSignedIn ? (
                <>

                  <Link
                    to="/search"
                    onClick={() => setMenuOpen(false)}
                    className="btn btn-ghost btn-sm w-full justify-start gap-3"
                  >
                    <SearchIcon className="size-4" />
                    Search
                  </Link>

                  <Link
                    to="/create"
                    onClick={() => setMenuOpen(false)}
                    className="btn btn-primary btn-sm w-full justify-start gap-3"
                  >
                    <PlusIcon className="size-4" />
                    New Record
                  </Link>

                  {/* Mobile Notifications */}
                  <NotificationBell mobile />

                  <Link
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="btn btn-ghost btn-sm w-full justify-start gap-3"
                  >
                    <UserIcon className="size-4" />
                    Profile
                  </Link>

                  <div className="flex items-center gap-3 px-3 pt-2">
                    <UserButton />

                    <span className="text-sm text-secondary/70">
                      Your Account
                    </span>
                  </div>

                </>
              ) : (
                <div className="flex gap-2">

                  <SignInButton mode="modal">
                    <button
                      className="btn btn-ghost btn-sm flex-1"
                      onClick={() => setMenuOpen(false)}
                    >
                      Sign In
                    </button>
                  </SignInButton>

                  <SignUpButton mode="modal">
                    <button
                      className="btn btn-primary btn-sm flex-1"
                      onClick={() => setMenuOpen(false)}
                    >
                      Sign Up
                    </button>
                  </SignUpButton>

                </div>
              )}

            </div>

          </div>
        </div>
      )}

    </header>
  );
}
