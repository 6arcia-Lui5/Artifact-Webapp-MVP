import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createRecord, deleteRecord, getAllRecords, getMyRecords, getRecordById, importRecords, searchRecords, getObjectTypes, updateRecord } from "../lib/api"

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

export const useUpdateRecord = (id) => {
    const client = useQueryClient();
    return useMutation({
        mutationFn: values => updateRecord(id, values),
        onSuccess: async () => {
            await Promise.all([
                client.invalidateQueries({ queryKey: ["record", id] }),
                client.invalidateQueries({ queryKey: ["records"] }),
                client.invalidateQueries({ queryKey: ["myRecords"] }),
            ]);
        },
    });
};

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
