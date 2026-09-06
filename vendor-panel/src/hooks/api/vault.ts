import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk, uploadFilesQuery } from "../../lib/client"

export type VaultDocType =
  | "lease"
  | "contract"
  | "license"
  | "insurance"
  | "credential"
  | "business_plan"
  | "other"

export interface VaultDocument {
  id: string
  seller_id: string
  doc_type: VaultDocType
  label: string
  file_id?: string | null
  issued_at?: string | null
  expires_at?: string | null
  verified: boolean
  verified_at?: string | null
  /** Derived by the API at request time: what the document proves today. */
  effective_status?: "unverified" | "verified" | "expired"
  /** Whole days until expiry; negative once past; null when open-ended. */
  days_until_expiry?: number | null
}

export interface CreateVaultInput {
  label: string
  doc_type?: VaultDocType
  file_id?: string
  issued_at?: string
  expires_at?: string
}

export const vaultKeys = {
  all: ["vault"] as const,
  list: () => [...vaultKeys.all, "list"] as const,
}

export const useVaultDocuments = () =>
  useQuery({
    queryKey: vaultKeys.list(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/vault")
      return res as { documents: VaultDocument[]; count: number }
    },
  })

/** Upload a file to the File module, returning its id (for attaching to a doc). */
export const useUploadVaultFile = () =>
  useMutation({
    mutationFn: async (file: File) => {
      const res: any = await uploadFilesQuery([{ file }])
      // The uploads endpoint returns { files: [{ id, url }] } or similar.
      const uploaded = res?.files?.[0] ?? res?.[0] ?? res
      return { file_id: uploaded?.id as string | undefined, url: uploaded?.url }
    },
  })

export const useCreateVaultDocument = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateVaultInput) => {
      const res = await sdk.client.fetch("/vendor/vault", {
        method: "POST",
        body: input,
      })
      return res as { document: VaultDocument }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vaultKeys.list() }),
  })
}

export const useDeleteVaultDocument = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch("/vendor/vault/" + id, { method: "DELETE" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vaultKeys.list() }),
  })
}
