import { model } from "@medusajs/framework/utils"

const EngagementSnapshot = model
  .define("engagement_snapshot", {
    id: model.id().primaryKey(),

    content_post_id: model.text(),
    captured_at: model.dateTime(),

    views: model.bigNumber().default(0),
    qualified_views: model.bigNumber().default(0),
    likes: model.bigNumber().default(0),
    shares: model.bigNumber().default(0),
    comments: model.bigNumber().default(0),
    saves: model.bigNumber().default(0),
    watch_time_seconds: model.bigNumber().default(0),

    raw: model.json().nullable(),
  })
  .indexes([
    {
      on: ["content_post_id", "captured_at"],
      name: "IDX_engagement_snapshot_post_time",
    },
  ])

export default EngagementSnapshot
