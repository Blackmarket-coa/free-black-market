import { randomBytes } from "crypto";
import type { MedusaContainer } from "@medusajs/framework/types";
import { createLogger } from "./logger";
import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentService from "../modules/blackstar-fulfillment/service"
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
  /** The seller asked to run a node, from the onboarding survey or later. */
  optedIn?: boolean;
  correlationId?: string;
}

/**
 * Who becomes a node operator.
 *
 * Seller approval is automatic, so this narrowing is what stops every approved
 * baker being handed credentials to a logistics network they have no part in.
 *
 * The opt-in is the real gate. `vendor_type === "logistics"` is kept as an OR
 * term because it was the gate before and some sellers registered under it, but
 * it is the wrong shape for the question: vendor_type is one archetype chosen
 * once at registration, so it could not express a kitchen that also drives, or
 * a seller who decided later. The flag is set from the onboarding survey, or
 * from settings afterwards.
 */
export function shouldProvisionNodeOperator(
  vendorType: string,
  optedIn?: boolean
): boolean {
  return optedIn === true || vendorType === VendorType.LOGISTICS;
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
): Promise<{ emitted: boolean; keyId?: string; secret?: string }> {
  if (!shouldProvisionNodeOperator(input.vendorType, input.optedIn)) {
    return { emitted: false };
  }

  const webhooks = container.resolve<MarketplaceWebhooksService>(
    MARKETPLACE_WEBHOOKS_MODULE,
  );
  // Issue through the module so the credential is persisted (encrypted) and the
  // operator can be shown their key id afterwards. Minting inline put the secret
  // on the wire and forgot it, which is why nobody could ever be told what their
  // own credential was.
  let keyId: string;
  let secret: string;
  try {
    const blackstar = container.resolve<BlackstarFulfillmentService>(
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
    log.warn(
      `[provision-node-operator] Could not persist a credential for ${input.sellerId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const minted = mintNodeCredential();
    keyId = minted.keyId;
    secret = minted.secret;
  }

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
  // The secret goes back to the caller so the opt-in route can show it once.
  // It is never logged and never read back from storage.
  return { emitted: true, keyId, secret };
}
