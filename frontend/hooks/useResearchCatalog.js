import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { getResearchRecords, getResearchFacets, getResearchCollections, getResearchCollection, createResearchCollection, updateResearchCollection, deleteResearchCollection, addCollectionRecords, removeCollectionRecord } from "../lib/researchApi";
import { parseCatalogParams, validateDateRange, updateCatalogParams } from "../src/components/research/catalogParams";

export function useCatalogLocation(fixed = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = { ...parseCatalogParams(searchParams), ...fixed };
  const dateError = validateDateRange(params);
  return { params, dateError, searchKey: searchParams.toString(),
    update: (changes) => setSearchParams(updateCatalogParams(searchParams, changes)),
    clear: () => setSearchParams(new URLSearchParams()),
  };
}

export function useResearchRecords(params, enabled = true) {
  return useQuery({ queryKey: ["records", "research", params], queryFn: ({ signal }) => getResearchRecords(params, signal), enabled: enabled && !validateDateRange(params), retry: 1 });
}
export const useResearchFacets = () => useQuery({ queryKey: ["researchFacets"], queryFn: ({ signal }) => getResearchFacets(signal), staleTime: 60000, retry: 1 });
export const useResearchCollections = () => useQuery({ queryKey: ["researchCollections"], queryFn: ({ signal }) => getResearchCollections(signal), retry: 1 });
export const useResearchCollection = (id) => useQuery({ queryKey: ["researchCollections", id], queryFn: ({ signal }) => getResearchCollection(id, signal), enabled: !!id, retry: 1 });

export function useCollectionMutation(action) {
  const client = useQueryClient();
  const actions = { create: createResearchCollection, update: updateResearchCollection, delete: deleteResearchCollection, add: addCollectionRecords, remove: removeCollectionRecord };
  return useMutation({ mutationFn: actions[action], onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["researchCollections"] }), client.invalidateQueries({ queryKey: ["records", "research"] })]);
  } });
}
