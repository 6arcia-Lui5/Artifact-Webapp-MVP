import { useUser } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { syncUser } from "../lib/api";

// Wait for this before allowing writes that reference the user's database row.
export default function useUserSync() {
  const { user, isLoaded, isSignedIn } = useUser();
  return useQuery({
    queryKey: ["userSync", user?.id],
    enabled: Boolean(isLoaded && isSignedIn && user),
    queryFn: () => syncUser({
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName || user.firstName || user.username || "Contributor",
      imageUrl: user.imageUrl,
    }),
    staleTime: Infinity,
    retry: 1,
  });
}
