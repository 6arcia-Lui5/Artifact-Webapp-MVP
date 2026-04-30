import { useQuery, useMutation } from "@tanstack/react-query"
import { createRecord, getAllRecords } from "../lib/api"

export const useRecords = () => {
    const result = useQuery({queryKey: ["records"], queryFn:getAllRecords});
    return result;
}

export const useCreateRecord = () => {
    return useMutation({mutationFn:createRecord})
}