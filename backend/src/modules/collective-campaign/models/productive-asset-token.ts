import { model } from "@medusajs/framework/utils"

const ProductiveAssetToken = model.define("collective_productive_asset_token", {
  id: model.id().primaryKey(),
  campaign_id: model.text(),
  token_contract_address: model.text(),
  chain_id: model.number(),
  token_standard: model.text().default("ERC-1155"),
  total_supply: model.bigNumber(),
  metadata_uri: model.text().nullable(),
  custody_mode: model.enum(["SELF_CUSTODY", "PLATFORM_CUSTODY"]).default("PLATFORM_CUSTODY"),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["campaign_id"], name: "IDX_collective_asset_token_campaign_id" },
])

export default ProductiveAssetToken
