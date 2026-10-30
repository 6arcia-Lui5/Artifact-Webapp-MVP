import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { getResearchAccess } from '../lib/moderationApi';

export function useResearchAccess() {
  const { isLoaded, isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['researchAccess'],
    queryFn: ({ signal }) => getResearchAccess(signal),
    enabled: isLoaded && isSignedIn,
    retry: 1,
  });
}
