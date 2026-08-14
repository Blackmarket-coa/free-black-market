import { ExecArgs } from "@medusajs/framework/types"

import { BLACKSTAR_FULFILLMENT_MODULE } from "../modules/blackstar-fulfillment"
import type BlackstarFulfillmentModuleService from "../modules/blackstar-fulfillment/service"

/**
 * Lifecycle for per-partner federated-logistics bridge credentials — the FBM
 * mirror of Blackstar's `php artisan fbm:credential`. The secret is printed
 * exactly once at issue/rotate time and stored encrypted
 * (BRIDGE_CREDENTIAL_KEY); there is no read-back path — re-issue instead.
 * Rotation is overlap-based: the new credential is active immediately, the
 * old one keeps verifying until explicitly revoked.
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/blackstar-bridge-credential.ts issue "Blackstar production"
 *   pnpm medusa exec ./src/scripts/blackstar-bridge-credential.ts rotate fbk_xxx
 *   pnpm medusa exec ./src/scripts/blackstar-bridge-credential.ts revoke fbk_xxx
 *   pnpm medusa exec ./src/scripts/blackstar-bridge-credential.ts list
 */
export default async function blackstarBridgeCredential({ container, args }: ExecArgs) {
  const service = container.resolve<BlackstarFulfillmentModuleService>(
    BLACKSTAR_FULFILLMENT_MODULE
  )

  const [action, operand] = args ?? []

  if (action === "issue") {
    if (!operand) {
      throw new Error('Usage: issue "<label>"')
    }
    const issued = await service.issueBridgeCredential({ label: operand })
    console.log("Credential issued. The secret is shown ONCE — store it now.")
    console.log(`  key_id: ${issued.key_id}`)
    console.log(`  secret: ${issued.secret}`)
    return
  }

  if (action === "rotate") {
    if (!operand) {
      throw new Error("Usage: rotate <key_id>")
    }
    const issued = await service.rotateBridgeCredential(operand)
    console.log(`Rotating — the old credential stays active until you revoke it.`)
    console.log(`  key_id: ${issued.key_id}`)
    console.log(`  secret: ${issued.secret}`)
    return
  }

  if (action === "revoke") {
    if (!operand) {
      throw new Error("Usage: revoke <key_id>")
    }
    await service.revokeBridgeCredential(operand)
    console.log(`Revoked [${operand}].`)
    return
  }

  if (action === "list") {
    const credentials = await service.listBlackstarBridgeCredentials({})
    for (const c of credentials) {
      console.log(
        `${c.key_id}  ${c.status.padEnd(7)}  last_used=${
          c.last_used_at ? new Date(c.last_used_at).toISOString() : "never"
        }  ${c.label}`
      )
    }
    if (!credentials.length) {
      console.log("No bridge credentials issued yet.")
    }
    return
  }

  throw new Error("Action must be one of: issue, rotate, revoke, list.")
}
