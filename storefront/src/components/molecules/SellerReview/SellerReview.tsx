import { StarRating } from "@/components/atoms"
import { SingleProductReview } from "@/types/product"
import { Divider } from "@medusajs/ui"
import { formatDistanceToNow } from "date-fns"

/**
 * The reviewer's name. A review comes back with no customer at all once its
 * customer is deleted (the link goes with them) or when it was imported
 * without one; it is then shown as the backend's own review routes show a
 * review with no display name.
 */
export const reviewerName = (review: Pick<SingleProductReview, "customer">) =>
  [review.customer?.first_name, review.customer?.last_name]
    .filter(Boolean)
    .join(" ") || "Verified buyer"

export const SellerReview = ({ review }: { review: SingleProductReview }) => {
  return (
    <div className="mb-4 border-b pb-4 flex gap-4">
      <div className="mb-4 w-1/6 items-center">
        <p className="label-md text-secondary mb-2 truncate">
          {reviewerName(review)}
        </p>
        <StarRating starSize={12} rate={Number(review.rating.toFixed(1))} />
        <p className="text-sm text-secondary mt-2">
          {formatDistanceToNow(new Date(review.created_at), {
            addSuffix: true,
          })}
        </p>
      </div>
      <div className="w-5/6">
        <p className="text-md whitespace-pre-line break-words">
          {review.customer_note}
        </p>
        {review.seller_note && (
          <div className="mt-4 flex gap-4 relative">
            <Divider orientation="vertical" className="h-auto" />
            <div>
              <p className="label-md text-primary">
                Reply from {review.seller?.name || "the seller"}{" "}
                <span className="text-secondary">
                  |{" "}
                  {formatDistanceToNow(new Date(review.updated_at), {
                    addSuffix: true,
                  })}
                </span>
              </p>
              <p className="label-sm mt-2">{review.seller_note}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
