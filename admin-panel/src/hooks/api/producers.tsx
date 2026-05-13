import type {
  QueryKey,
  UseQueryOptions} from "@tanstack/react-query";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"
import type {
  AdminProducerListResponse,
  AdminProducerResponse,
  AdminProducerStatsResponse,
  ProducerListParams,
  UpdateProducerInput,
} from "../../types/producer"

export const producerQueryKeys = queryKeysFactory("producer")

/**
 * Fetch all producers (admin)
 */
export const useProducers = (
  query?: ProducerListParams,
  options?: Omit<
    UseQueryOptions<
      AdminProducerListResponse,
      Error,
      AdminProducerListResponse,
      QueryKey
    >,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: producerQueryKeys.list(query),
    queryFn: async () => {
      const response = await sdk.client.fetch<AdminProducerListResponse>(
        "/admin/producers",
        {
          query: query as Record<string, unknown>,
        }
      )
      
return response
    },
    ...options,
  })

  return {
    ...rest,
    producers: data?.producers,
    count: data?.count,
  }
}

/**
 * Fetch single producer by ID
 */
export const useProducer = (
  id: string,
  options?: Omit<
    UseQueryOptions<AdminProducerResponse, Error, AdminProducerResponse, QueryKey>,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: producerQueryKeys.detail(id),
    queryFn: async () => {
      const response = await sdk.client.fetch<AdminProducerResponse>(
        `/admin/producers/${id}`
      )
      
return response
    },
    enabled: !!id,
    ...options,
  })

  return {
    ...rest,
    data,
    producer: data?.producer,
  }
}

/**
 * Fetch producer statistics
 */
export const useProducerStats = (
  options?: Omit<
    UseQueryOptions<AdminProducerStatsResponse, Error, AdminProducerStatsResponse, QueryKey>,
    "queryKey" | "queryFn"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: [...producerQueryKeys.all, "stats"],
    queryFn: async () => {
      const response = await sdk.client.fetch<AdminProducerStatsResponse>(
        "/admin/producers/stats"
      )
      
return response
    },
    ...options,
  })

  return {
    ...rest,
    stats: data?.stats,
  }
}

/**
 * Update producer
 */
export const useUpdateProducer = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProducerInput }) => {
      const response = await sdk.client.fetch<AdminProducerResponse>(
        `/admin/producers/${id}`,
        {
          method: "POST",
          body: data,
        }
      )
      
return response.producer
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.lists() })
    },
  })
}

/**
 * Verify producer
 */
export const useVerifyProducer = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const response = await sdk.client.fetch<AdminProducerResponse>(
        `/admin/producers/${id}/verify`,
        {
          method: "POST",
          body: { verified },
        }
      )
      
return response.producer
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: [...producerQueryKeys.all, "stats"] })
    },
  })
}

/**
 * Toggle producer featured status
 */
export const useFeatureProducer = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, featured }: { id: string; featured: boolean }) => {
      const response = await sdk.client.fetch<AdminProducerResponse>(
        `/admin/producers/${id}/feature`,
        {
          method: "POST",
          body: { featured },
        }
      )
      
return response.producer
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: [...producerQueryKeys.all, "stats"] })
    },
  })
}

/**
 * Verify producer certification
 */
export const useVerifyCertification = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ 
      producerId, 
      certificationIndex, 
      verified 
    }: { 
      producerId: string
      certificationIndex: number
      verified: boolean 
    }) => {
      const response = await sdk.client.fetch<AdminProducerResponse>(
        `/admin/producers/${producerId}/certifications/${certificationIndex}/verify`,
        {
          method: "POST",
          body: { verified },
        }
      )
      
return response.producer
    },
    onSuccess: (_, { producerId }) => {
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.detail(producerId) })
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.lists() })
    },
  })
}

/**
 * Delete producer (admin only)
 */
export const useDeleteProducer = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch(`/admin/producers/${id}`, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: producerQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: [...producerQueryKeys.all, "stats"] })
    },
  })
}
