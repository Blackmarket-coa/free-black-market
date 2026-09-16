import {
  createStep,
  StepResponse,
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INotificationModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { appendPath } from "../shared/url";

export type SendSellerEmailVerificationInput = {
  request_id: string;
  member_email: string;
  member_name: string;
  seller_name: string;
  /** The RAW token. It exists only in this email and in the member's inbox. */
  token: string;
};

/**
 * Step: email a seller-registration verification link.
 *
 * The link is the only place the raw token appears — the request row stores
 * just its hash — so this step must never be logged with its input.
 */
export const sendSellerEmailVerificationStep = createStep(
  "send-seller-email-verification",
  async (input: SendSellerEmailVerificationInput, { container }) => {
    const notificationModuleService: INotificationModuleService =
      container.resolve(Modules.NOTIFICATION);

    const vendorPanelUrl = process.env.VENDOR_PANEL_URL || "";
    const verifyUrl = vendorPanelUrl
      ? `${appendPath(vendorPanelUrl, "/verify-email")}?request=${encodeURIComponent(
          input.request_id,
        )}&token=${encodeURIComponent(input.token)}`
      : "";

    const notification = await notificationModuleService.createNotifications({
      to: input.member_email,
      template: "seller-email-verification",
      channel: "email",
      data: {
        member_name: input.member_name,
        seller_name: input.seller_name,
        verify_url: verifyUrl || undefined,
        // So a member whose mail client mangles the link can still finish.
        request_id: input.request_id,
        token: input.token,
        expires_in_hours: 24,
      },
    });

    return new StepResponse(notification);
  },
);

/**
 * Workflow: Send Seller Email Verification
 *
 * Sends the link that proves a registering seller controls the address they
 * signed up with. Since seller approval is automatic, this is the gate.
 */
export const sendSellerEmailVerificationWorkflow = createWorkflow(
  "send-seller-email-verification",
  (input: SendSellerEmailVerificationInput) => {
    const notification = sendSellerEmailVerificationStep(input);

    return new WorkflowResponse({ notification });
  },
);

export default sendSellerEmailVerificationWorkflow;
