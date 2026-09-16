import { randomBytes } from "crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { createLogger } from "./logger";
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks";
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service";
import { VendorType } from "../modules/seller-extension/models/seller-metadata";

const log = createLogger("shared/provision-node-operator");

export interface NodeOperatorProvisionInput {
  sellerId: string;
  sellerName: string;
  memberEmail: string;
  memberName: string;
  vendorType: string;
  correlationId?: string;
}

/**
 * Only a logistics seller becomes a node operator.
 *
 * Seller approval is automatic, so without this narrowing every approved
 * baker and maker would be handed credentials to a logistics network they have
 * no part in. Registering as a carrier is the deliberate act.
 */
export function shouldProvisionNodeOperator(vendorType: string): boolean {
  return vendorType === VendorType.LOGISTICS;
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
 * Tell Blackstar to stand up a node operator for a newly approved logistics
 * seller.
 *
 * FBM mints the shared secret rather than Blackstar returning one, so the
 * secret never rides in a webhook RESPONSE — responses are recorded in
 * `webhook_delivery` rows, and a secret at rest in a delivery log is a secret
 * leaked. It travels once, in the signed request body, over TLS.
 *
 * Best-effort by design: a Blackstar outage must not fail or roll back an FBM
 * seller approval. The emitter records the delivery and retries on its own, and
 * the event is idempotent on `seller_id` at the far end.
 */
export async function provisionNodeOperator(
  container: MedusaContainer,
  input: NodeOperatorProvisionInput,
): Promise<{ emitted: boolean; keyId?: string }> {
  if (!shouldProvisionNodeOperator(input.vendorType)) {
    return { emitted: false };
  }

  const webhooks = container.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE,
  );
  const { keyId, secret } = mintNodeCredential();

  await webhooks.emitBlackstar(
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

  log.info(
    `[provision-node-operator] Emitted node.operator.approved for seller ${input.sellerId} (key ${keyId})`,
  );
  return { emitted: true, keyId };
}
