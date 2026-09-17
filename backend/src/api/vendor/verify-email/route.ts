import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { createLogger } from "../../../shared/logger";
import { REQUEST_MODULE } from "../../../modules/request";
import RequestModuleService from "../../../modules/request/service";
import { RequestStatus } from "../../../modules/request/models";
import { REQUEST_TYPES } from "../../../modules/request/validators";
import { getSellerApprovalService } from "../../../shared/seller-approval-service";
import {
  checkVerificationToken,
  consumedState,
  type EmailVerificationState,
} from "../../../shared/seller-email-verification";

const log = createLogger("api/vendor/verify-email");

// Public: the whole point is that the caller has not authenticated yet — they
// are proving control of the mailbox the registration named.
export const AUTHENTICATE = false;

/**
 * Recorded as the reviewer on automatically approved registrations, so the
 * audit trail distinguishes them from a request an admin actually looked at.
 */
export const SYSTEM_REVIEWER_ID = "system:email-verification";

const BodySchema = z
  .object({
    request: z.string().min(1).max(200),
    token: z.string().min(1).max(500),
  })
  .strict();

/**
 * POST /vendor/verify-email
 *
 * Completes a seller registration: checks the emailed token, then approves the
 * seller immediately. Medusa's emailpass provider does not verify addresses and
 * approval is automatic, so this endpoint IS the gate on becoming a seller —
 * and, through the Blackstar bridge, on holding node-operator credentials.
 *
 * Every failure answers the same 400 with the same body. Distinguishing "no
 * such request", "wrong token" and "already verified" would let someone probe
 * which registrations exist and which are still open.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ type: "invalid_data", message: "Invalid verification link." });
  }

  const refuse = () =>
    res.status(400).json({
      type: "invalid_data",
      message: "That verification link is not valid or has expired.",
    });

  try {
    const requestService =
      req.scope.resolve<RequestModuleService>(REQUEST_MODULE);
    const [request] = await requestService.listRequests({
      id: parsed.data.request,
    });

    if (!request || request.type !== REQUEST_TYPES.SELLER) return refuse();

    const data = (request.data ?? {}) as Record<string, unknown>;
    const state = data.email_verification as EmailVerificationState | undefined;

    const outcome = checkVerificationToken(state, parsed.data.token);
    if (!outcome.ok) {
      log.info(
        `[verify-email] Refused request ${request.id}: ${outcome.reason}`,
      );
      return refuse();
    }

    // Burn the token before approving. If approval throws, the link is still
    // spent — a replayable link is worse than a member asking for a new one.
    await requestService.updateRequests({
      selector: { id: request.id },
      data: { data: { ...data, email_verification: consumedState() } },
    });

    if (request.status !== RequestStatus.PENDING) {
      // Already approved by an admin while the mail was in flight. The token is
      // spent and the seller exists, so this is a success from the member's side.
      return res.status(200).json({ verified: true, approved: true });
    }

    const approvalService = getSellerApprovalService(req.scope);
    const result = await approvalService.approveSeller({
      requestId: request.id,
      reviewerId: SYSTEM_REVIEWER_ID,
      reviewerNote: "Approved automatically on email verification.",
    });

    log.info(
      `[verify-email] Approved request ${request.id} -> seller ${result.seller?.id}`,
    );
    return res.status(200).json({
      verified: true,
      approved: true,
      seller: result.seller,
    });
  } catch (error) {
    log.error(
      "[verify-email] Failed:",
      error instanceof Error ? error.message : String(error),
    );
    return res.status(500).json({
      type: "unexpected_state",
      message: "Could not finish verification. Try the link again shortly.",
    });
  }
};
