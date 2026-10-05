import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createRecord, deleteRecord, getAllRecords, getMyRecords, getRecordById, importRecords, searchRecords, getObjectTypes } from "../lib/api"

export const useRecords = () => {
    const result = useQuery({queryKey: ["records"], queryFn:getAllRecords});
    return result;
}

export const useCreateRecord = () => {
    return useMutation({mutationFn:createRecord})
}

export const useRecord = (id) => {
    return useQuery({
        queryKey: ["record", id],
        queryFn: () => getRecordById(id),
        enabled: !!id
    })
}

export const useDeleteRecord = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn:deleteRecord,
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ["myRecords"]})
        }
    });
}

export const useMyRecords = () => {
    return useQuery ({
        queryKey: ["myRecords"],
        queryFn: getMyRecords,
    })
}

export const useImportRecords = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: importRecords,
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["myRecords"]
            })

            queryClient.invalidateQueries({
                queryKey: ["records"]
            })
        }
    })
}


export const useSearchRecords = (query) => {
    return useQuery({
        queryKey: ["records", "search", query],
        queryFn: () => searchRecords(query),
        enabled: !!query?.trim(),
    })
}

export function useObjectTypes() {
  return useQuery({
    queryKey: ["objectTypes"],
    queryFn: getObjectTypes,
  });
}