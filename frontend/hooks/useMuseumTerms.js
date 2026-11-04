import { useQuery } from '@tanstack/react-query';
import api from '../lib/axios';

export function useMuseumTerms() {
  return useQuery({ queryKey: ['museumTerms'], queryFn: async ({ signal }) =>
    (await api.get('/research/terms', { signal })).data, staleTime: 300000, retry: 1 });
}
