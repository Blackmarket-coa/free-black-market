// Canonical RequestStatus lives in ./common.ts (must match backend enum).
// Re-exporting here to keep this module's public surface stable for
// existing imports.
import type { RequestStatus } from "@custom-types/requests/common"
export type { RequestStatus }

export type CreateRequestDTO = {
  type: string
  data: any
  submitter_id: string
  reviewer_id?: string
  reviewer_note?: string
  status?: RequestStatus
}

export type UpdateRequestDTO = {
  id: string
  reviewer_id?: string
  reviewer_note?: string
  status: RequestStatus
}

export type UpdateRequestDataDTO = {
  id: string
  type: string
  data: any
}

export type AcceptRequestDTO = {
  id: string
  reviewer_id: string
  reviewer_note: string
  data: any
  status: RequestStatus
}
