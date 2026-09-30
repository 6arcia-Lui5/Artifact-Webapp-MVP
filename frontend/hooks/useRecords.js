import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createRecord, deleteRecord, getAllRecords, getMyRecords, getRecordById } from "../lib/api"

export const useRecords = () => {
    const result = useQuery({queryKey: ["records"], queryFn:getAllRecords});
    return result;
}

export const useCreateRecord = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn:createRecord,
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ["records"]})
            queryClient.invalidateQueries({queryKey: ["myRecords"]})
        }
    })
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
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({queryKey: ["records"]})
            queryClient.invalidateQueries({queryKey: ["myRecords"]})
            queryClient.removeQueries({queryKey: ["record", id]})
        }
    });
}

export const useMyRecords = () => {
    return useQuery ({
        queryKey: ["myRecords"],
        queryFn: getMyRecords,
    })
}