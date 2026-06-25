import { MedusaService } from "@medusajs/framework/utils"
import EmbedReviewDetail from "./models/embed-review-detail"

/**
 * Reviews module service.
 *
 * Thin CRUD over `embed_review_detail` only. Rating/comment data lives in the
 * platform `@mercurjs/reviews` `review` model — which this isolated module
 * service cannot query — so all aggregation that needs ratings is done at the
 * route layer via `query.graph` (see `./read-helpers`).
 */
class ReviewsService extends MedusaService({
  EmbedReviewDetail,
}) {}

export default ReviewsService
