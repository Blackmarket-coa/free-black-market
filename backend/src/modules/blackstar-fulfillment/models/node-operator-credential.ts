import { model } from "@medusajs/framework/utils"

/**
 * The credential a seller's Blackstar node signs its bridge calls with.
 *
 * Distinct from `blackstar_bridge_credential`, which points the other way: that
 * one holds inbound partner keys this deployment verifies. This is a key FBM
 * MINTS and sends to Blackstar when a seller opts into running a node, and it
 * is stored here for one reason — so the operator can be shown it. Before this
 * the secret was generated, put on the wire and forgotten, which meant nobody
 * could ever tell an operator what their own credential was.
 *
 * The secret is encrypted at rest with the same cipher as the bridge
 * credentials. It is displayed once, at issue; afterwards only the key id is
 * shown, and an operator who loses the secret rotates rather than recovers.
 */
const BlackstarNodeOperatorCredential = model
  .define("blackstar_node_operator_credential", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    key_id: model.text(),
    secret: model.text(),

    status: model.text().default("active"),

    revoked_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["key_id"],
      name: "IDX_blackstar_node_operator_credential_key",
      unique: true,
    },
    {
      // One live credential per seller. Rotation revokes before it issues, so
      // an operator cannot accumulate active secrets they have lost track of.
      on: ["seller_id"],
      where: "status = 'active' AND revoked_at IS NULL",
      name: "IDX_blackstar_node_operator_credential_active_seller",
      unique: true,
    },
  ])

export default BlackstarNodeOperatorCredential
