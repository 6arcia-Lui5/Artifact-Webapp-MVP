import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  getObjectTypes,
  createObjectType,
} from "../lib/api";

export const useObjectTypes = () => {
  return useQuery({
    queryKey: ["objectTypes"],
    queryFn: getObjectTypes,
  });
};

export const useCreateObjectType = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createObjectType,

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["objectTypes"],
      });
    },
  });
};
