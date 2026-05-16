import { sdk } from "@lib/client";
import { queryClient } from "@lib/query-client";
import { queryKeysFactory } from "@lib/query-key-factory";
import {
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query";

import type { AdminRequest, AdminReviewRequest } from "@custom-types/requests";
import { sellerQueryKeys } from "./sellers";

export const requestsQueryKeys = queryKeysFactory("requests");

export const useVendorRequests = (
  query?: Record<string, string | number | undefined>,
  options?: Omit<
    UseQueryOptions<
      Record<string, string | number>,
      Error,
      {
        requests: AdminRequest[];
        count?: number;
      },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...other } = useQuery({
    queryKey: requestsQueryKeys.list(query),
    queryFn: () =>
      sdk.client.fetch<Record<string, string | number>>("/admin/requests", {
        method: "GET",
        query,
      }),
    ...options,
  });

  return { ...data, ...other };
};

export const useVendorRequest = (
  id: string,
  options?: Omit<
    UseQueryOptions<unknown, Error, { request?: AdminRequest }, QueryKey>,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...other } = useQuery({
    queryKey: requestsQueryKeys.detail(id),
    queryFn: () =>
      sdk.client.fetch(`/admin/requests/${id}`, {
        method: "GET",
      }),
    ...options,
  });

  return { ...data, ...other };
};

export const useReviewRequest = (
  options: UseMutationOptions<
    { request?: { id?: string; status?: string }; status?: string },
    Error,
    { id: string; payload: AdminReviewRequest }
  >,
) => {
  return useMutation({
    mutationFn: ({ id, payload }) =>
      sdk.client.fetch<{ request?: { id?: string; status?: string }; status?: string }>(
        `/admin/requests/${id}`,
        {
          method: "POST",
          body: payload,
        }
      ),
    onSuccess: (data, variables) => {
      const nextStatus =
        data?.request?.status || data?.status || variables.payload.status;

      if (nextStatus) {
        const listQueries = queryClient
          .getQueryCache()
          .findAll({ queryKey: requestsQueryKeys.lists() });

        listQueries.forEach((query) => {
          const queryKey = query.queryKey as Array<unknown>;
          const queryMeta = queryKey[queryKey.length - 1];
          const listQuery =
            typeof queryMeta === "object" &&
            queryMeta !== null &&
            "query" in queryMeta
              ? (queryMeta as { query?: Record<string, unknown> }).query
              : undefined;

          queryClient.setQueryData(queryKey, (oldData) => {
            if (!oldData) {
              return oldData;
            }

            const typedData = oldData as {
              requests?: AdminRequest[];
              count?: number;
            };

            if (!typedData.requests) {
              return oldData;
            }

            let nextRequests = typedData.requests.map((request) =>
              request.id === variables.id
                ? { ...request, status: nextStatus }
                : request
            );

            if (
              listQuery?.status &&
              typeof listQuery.status === "string" &&
              listQuery.status !== nextStatus
            ) {
              nextRequests = nextRequests.filter(
                (request) => request.id !== variables.id
              );
            }

            return {
              ...typedData,
              requests: nextRequests,
              count:
                typedData.count && nextRequests.length < typedData.requests.length
                  ? typedData.count - 1
                  : typedData.count,
            };
          });
        });

        queryClient.setQueryData(
          requestsQueryKeys.detail(variables.id),
          (oldData) => {
            if (!oldData) {
              return oldData;
            }

            const typedData = oldData as { request?: AdminRequest };
            if (!typedData.request) {
              return oldData;
            }

            return {
              ...typedData,
              request: { ...typedData.request, status: nextStatus },
            };
          }
        );
      }
    },
    onSettled: (data, _error, variables) => {
      // Delay refetch to avoid overwriting optimistic updates with stale data.
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: requestsQueryKeys.all,
          refetchType: "inactive",
        });
      }, 2000);

      // When a request is accepted, a seller may have been created.
      // Invalidate the sellers cache so the new seller shows up on /sellers.
      const nextStatus =
        data?.request?.status || data?.status || variables.payload.status;
      if (nextStatus === "accepted") {
        queryClient.invalidateQueries({
          queryKey: sellerQueryKeys.all,
        });
      }
    },
    ...options,
  });
};
