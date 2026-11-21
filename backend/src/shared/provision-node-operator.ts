import { randomBytes } from "crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { createLogger } from "./logger";
import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentService from "../modules/blackstar-fulfillment/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks";
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service";
import { isBlackstarEmitConfigured } from "../modules/marketplace-webhooks/service";

const log = createLogger("shared/provision-node-operator");

export interface NodeOperatorProvisionInput {
  sellerId: string;
  sellerName: string;
  memberEmail: string;
  memberName: string;
  /** The seller asked to run a node, in the onboarding survey or later. */
  optedIn?: boolean;
  correlationId?: string;
}

/**
 * Why nothing was provisioned.
 *
 * - `not_opted_in`: the seller did not ask to run a node.
 * - `blackstar_not_configured`: this deployment cannot tell Blackstar
 *   (`BLACKSTAR_WEBHOOK_SECRET` or `BLACKSTAR_API_BASE` is unset). No
 *   credential was issued either; the seller's opt-in is the caller's to
 *   record, and they issue the credential from Settings once the bridge is
 *   connected.
 */
export type NodeOperatorSkipReason = "not_opted_in" | "blackstar_not_configured";

export type NodeOperatorProvisionResult =
  /** A credential was issued and its `node.operator.approved` event queued. */
  | { emitted: true; keyId: string; secret: string; reason?: undefined }
  /** Nothing was issued and nothing was queued. */
  | { emitted: false; reason: NodeOperatorSkipReason; keyId?: undefined; secret?: undefined };

/**
 * Who becomes a node operator: a seller who said so, and no one else.
 *
 * Seller approval is automatic, so this is what stops every approved baker
 * being handed credentials to a logistics network they have no part in. The
 * answer is the seller's own, given in the onboarding survey or in Settings
 * afterwards. It is never inferred: `vendor_type === "logistics"` used to
 * count as a yes (it was the gate before the flag existed), which enrolled an
 * applicant who had answered no, on the strength of an archetype. No playbook,
 * resource or vendor type decides this.
 */
export function shouldProvisionNodeOperator(optedIn?: boolean): boolean {
  return optedIn === true;
}

/** Mint the shared secret the new node will sign its bridge calls with. */
export function mintNodeCredential(): { keyId: string; secret: string } {
  return {
    // Matches Blackstar's own `bsk_` convention (FbmCredentialCommand).
    keyId: `bsk_${randomBytes(10).toString("hex")}`,
    secret: randomBytes(32).toString("hex"),
  };
}

/**
 * Tell Blackstar to stand up a node operator for a seller who opted in, and
 * issue the credential its node signs with.
 *
 * FBM mints the shared secret rather than Blackstar returning one, and sends
 * it in the signed body of the `node.operator.approved` event. That body is
 * the queued delivery's payload, so the plaintext is at rest in
 * `marketplace_webhook_delivery.payload` from the moment it is queued until
 * Blackstar accepts the delivery, when the delivery clears it
 * (`marketplace-webhooks/service.ts`); whatever returns a Blackstar delivery
 * to a caller redacts it (`marketplace-webhooks/redact.ts`). A delivery that
 * never succeeds keeps it. This comment used to say the secret was never at
 * rest in a delivery row; it was, for good, and the admin deliveries route
 * returned it.
 *
 * A credential is only issued when its event can be queued. With the
 * Blackstar emit unconfigured there is no one to send the secret to, and the
 * one caller that has someone to show it to (the Settings route) would be
 * handing the seller a key for a node Blackstar was never told about; so
 * nothing is issued, and the result says why. This used to issue anyway and
 * report `emitted: true` with nothing queued.
 *
 * Best-effort by design: a Blackstar outage must not fail or roll back an FBM
 * seller approval. The emitter records the delivery and retries on its own, and
 * the event is idempotent on `seller_id` at the far end.
 */
export async function provisionNodeOperator(
  container: MedusaContainer,
  input: NodeOperatorProvisionInput,
): Promise<NodeOperatorProvisionResult> {
  if (!shouldProvisionNodeOperator(input.optedIn)) {
    return { emitted: false, reason: "not_opted_in" };
  }
  if (!isBlackstarEmitConfigured()) {
    log.info(
      `[provision-node-operator] Nothing emitted for seller ${input.sellerId}: the Blackstar emit is not configured, so no credential was issued`,
    );
    return { emitted: false, reason: "blackstar_not_configured" };
  }

  const webhooks = container.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE,
  );
  // Issue through the module so the credential is persisted (encrypted) and the
  // operator can be shown their key id afterwards. Minting inline put the secret
  // on the wire and forgot it, which is why nobody could ever be told what their
  // own credential was.
  let blackstar: BlackstarFulfillmentService | null = null;
  let keyId: string;
  let secret: string;
  try {
    blackstar = container.resolve<BlackstarFulfillmentService>(
      BLACKSTAR_FULFILLMENT_MODULE,
    );
    const issued = await blackstar.issueNodeOperatorCredential({
      seller_id: input.sellerId,
    });
    keyId = issued.key_id;
    secret = issued.secret;
  } catch (error) {
    // A storage failure must not leave a seller who opted in with no node; they
    // get a working credential that simply cannot be re-displayed.
    blackstar = null;
    log.warn(
      `[provision-node-operator] Could not persist a credential for ${input.sellerId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const minted = mintNodeCredential();
    keyId = minted.keyId;
    secret = minted.secret;
  }

  const queued = await webhooks.emitBlackstar(
    "node.operator.approved",
    {
      // `external_ref` is the idempotency key on Blackstar's side: a redelivery
      // must not mint a second node for the same seller.
      external_ref: input.sellerId,
      seller_id: input.sellerId,
      seller_name: input.sellerName,
      member_email: input.memberEmail,
      member_name: input.memberName,
      credential: { key_id: keyId, secret },
    },
    { correlationId: input.correlationId },
  );
  if (!queued) {
    // The emit was configured a moment ago and is not now: nothing was
    // queued, so the credential just issued has no one to go to.
    if (blackstar) {
      await blackstar.revokeNodeOperatorCredential(input.sellerId).catch(() => undefined);
    }
    log.warn(
      `[provision-node-operator] Nothing emitted for seller ${input.sellerId}: the Blackstar emit stopped being configured; the credential issued for it was revoked`,
    );
    return { emitted: false, reason: "blackstar_not_configured" };
  }

  log.info(
    `[provision-node-operator] Queued node.operator.approved for seller ${input.sellerId} (key ${keyId})`,
  );
  // The secret goes back to the caller so the opt-in route can show it once.
  // It is never logged and never read back from storage.
  return { emitted: true, keyId, secret };
}
