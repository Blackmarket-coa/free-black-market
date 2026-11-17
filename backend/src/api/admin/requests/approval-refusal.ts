import { SellerApprovalRefusedError } from "../../../shared/seller-approval-service"

/**
 * The answer both admin routes that approve a seller application give an
 * approval that was refused: `POST /admin/requests/:id/approve` and
 * `POST /admin/requests/:id` with `status: "accepted"` (what the admin
 * panel's Accept sends). The second answered every refusal 500 with the
 * refusal's message, while the first answered 409 or 400. Null for any
 * other error, which the caller handles as before.
 *
 * A refusal (SellerApprovalRefusedError) is thrown before anything is
 * created or linked, and leaves the request as it was.
 */
export function approvalErrorResponse(
  error: unknown
): { status: number; body: { message: string; type?: string } } | null {
  if (error instanceof SellerApprovalRefusedError) {
    return {
      status: error.status,
      body: {
        message: error.message,
        type: error.status === 409 ? "conflict" : "invalid_data",
      },
    }
  }
  const message = error instanceof Error ? error.message : undefined
  if (message?.includes("Invalid request data")) {
    return { status: 400, body: { message } }
  }
  return null
}
