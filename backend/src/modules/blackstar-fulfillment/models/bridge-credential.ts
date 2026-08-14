import { model } from "@medusajs/framework/utils"

/**
 * A per-partner machine credential for the federated-logistics bridge: the
 * inbound events receiver looks the sender's `X-FBM-Key-ID` up here and
 * verifies with this row's secret instead of the deployment-global
 * `BLACKSTAR_OUTBOUND_SECRET`. Mirrors Blackstar's `node_credentials`.
 *
 * `secret` is encrypted at rest (see `bridge-credential-cipher.ts`) — the
 * HMAC scheme needs the raw value back at verify time, so it cannot be
 * hashed. Rotation is overlap-based: issue a new credential, switch the
 * sender, revoke the old — both verify during the overlap, no flag day.
 */
const BlackstarBridgeCredential = model
  .define("blackstar_bridge_credential", {
    id: model.id().primaryKey(),

    key_id: model.text(),
    label: model.text(),
    secret: model.text(),

    status: model.text().default("active"),

    last_used_at: model.dateTime().nullable(),
    revoked_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["key_id"],
      name: "IDX_blackstar_bridge_credential_key",
      unique: true,
    },
    {
      on: ["status"],
      name: "IDX_blackstar_bridge_credential_status",
    },
  ])

export default BlackstarBridgeCredential
