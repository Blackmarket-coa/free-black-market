import { medusaFetch } from "@/lib/config"

/**
 * File a report against a seller: `POST /store/seller-reports`.
 *
 * `ReportSellerForm` used to log the report to the browser console and then
 * tell the reporter it would be acted on. This is what it submits through now.
 *
 * Deliberately NOT a `"use server"` action. The backend caps reports per client
 * IP, and a server action would make every reporter arrive from the
 * storefront's own address, sharing one bucket (SD-58 is that failure on the
 * account pages). Submitted from the browser, as the listing report is, the
 * address is the reporter's. No credentials are needed: a rights-holder
 * filing a notice usually has no account here.
 *
 * Never throws. `ok: false` is how the form knows not to show its
 * confirmation; that confirmation appearing for a report that never arrived is
 * the defect this replaces.
 */

/** Mirrors `SELLER_REPORT_REASONS` in backend/src/api/store/seller-reports/route.ts. */
export const SELLER_REPORT_REASONS = [
  "trademark_copyright_dmca",
  "counterfeit",
  "prohibited_items",
  "fraud_or_scam",
  "impersonation",
  "harassment",
  "other",
] as const

export type SellerReportReason = (typeof SELLER_REPORT_REASONS)[number]

export type SellerReportInput = {
  seller_id: string
  reason: string
  comment: string
  reporter_email?: string
}

export type SellerReportResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

export const SELLER_REPORT_FAILED_MESSAGE =
  "We could not submit your report. Please try again, and contact support if the problem continues."

export const SELLER_REPORT_RATE_LIMITED_MESSAGE =
  "You have sent several reports in a short time. Please wait an hour and try again, or contact support."

function statusOf(error: unknown): number | undefined {
  const err = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
    cause?: { status?: number }
  }
  return err?.status || err?.statusCode || err?.response?.status || err?.cause?.status
}

export async function fileSellerReport(
  input: SellerReportInput
): Promise<SellerReportResult> {
  const reporterEmail = input.reporter_email?.trim()
  try {
    const res = await medusaFetch<{ id?: string; status?: string }>(
      "/store/seller-reports",
      {
        method: "POST",
        body: {
          seller_id: input.seller_id,
          reason: input.reason,
          comment: input.comment.trim(),
          ...(reporterEmail ? { reporter_email: reporterEmail } : {}),
        },
      }
    )
    // Only a report the server has given an id to counts as received.
    if (!res?.id) {
      return { ok: false, message: SELLER_REPORT_FAILED_MESSAGE }
    }
    return { ok: true, id: res.id }
  } catch (error) {
    // medusaFetch has already logged the failure (path, status, response).
    // The request body is not logged anywhere: it can carry the reporter's
    // identity.
    return {
      ok: false,
      message:
        statusOf(error) === 429
          ? SELLER_REPORT_RATE_LIMITED_MESSAGE
          : SELLER_REPORT_FAILED_MESSAGE,
    }
  }
}
