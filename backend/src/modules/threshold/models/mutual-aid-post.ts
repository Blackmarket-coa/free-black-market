import { model } from "@medusajs/framework/utils"

/**
 * Threshold mutual-aid post.
 *
 * Free stores, community fridges, tool libraries, mutual-aid asks /
 * funds, skill shares, repair cafés. Hyperlocal-by-default; no price
 * column on purpose (mutual-aid is gift economy, donations route
 * through the donation module + fiscal sponsor).
 *
 * See `policy.ts` for the validation rules and
 * `docs/COMPOSITION_LAYER.md` § "Threshold surface".
 */
const MutualAidPost = model.define("threshold_mutual_aid_post", {
  id: model.id().primaryKey(),

  type: model.enum([
    "free_store",
    "community_fridge",
    "tool_library",
    "mutual_aid_ask",
    "mutual_aid_fund",
    "skill_share",
    "repair_cafe",
  ]),

  title: model.text(),
  description: model.text().nullable(),

  /** BMC member id that posted this. */
  posted_by_member_id: model.text(),

  /** Optional geo. If null/null, post is "no fixed location". */
  latitude: model.number().nullable(),
  longitude: model.number().nullable(),

  /** Visibility radius (km). Default 5; max 50 enforced in policy. */
  visibility_radius_km: model.number().default(5),

  /** Active / archived / removed (moderation). */
  status: model.enum(["active", "archived", "removed"]).default("active"),

  metadata: model.json().nullable(),
})
.indexes([
  { on: ["type"], name: "IDX_threshold_post_type" },
  { on: ["posted_by_member_id"], name: "IDX_threshold_post_posted_by" },
  { on: ["status"], name: "IDX_threshold_post_status" },
])

export default MutualAidPost
