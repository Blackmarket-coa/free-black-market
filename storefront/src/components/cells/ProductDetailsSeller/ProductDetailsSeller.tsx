import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { CollapseIcon } from "@/icons"
import { SellerInfo } from "@/components/molecules"
import { TrustIndicators } from "@/components/molecules/TrustIndicators/TrustIndicators"
import type { SellerTrust } from "@/lib/data/verification"
import { SellerProps } from "@/types/seller"

export const ProductDetailsSeller = ({
  seller,
  trust = null,
}: {
  seller?: SellerProps
  /**
   * The seller's verification summary. Null when the lookup failed or they have
   * no record yet, in which case the block renders exactly as it did before
   * badges existed.
   *
   * Shown here rather than only on the seller's own page because this is where
   * the decision happens: a buyer weighing an unfamiliar maker is looking at
   * this block, not clicking through to a profile first.
   */
  trust?: SellerTrust | null
}) => {
  if (!seller) return null

  return (
    <div className="border rounded-sm">
      <div className="p-4">
        <LocalizedClientLink href={`/sellers/${seller.handle}`}>
          <div className="flex justify-between">
            <SellerInfo seller={seller} />
            <CollapseIcon className="-rotate-90" />
          </div>
        </LocalizedClientLink>

        {trust && (
          <div className="mt-4 pt-4 border-t">
            <TrustIndicators
              verificationLevel={trust.level}
              trustScore={trust.trustScore}
              badges={trust.badges.map((badge) => badge.type)}
              yearsActive={trust.yearsActive}
            />
            <LocalizedClientLink
              href="/verification"
              className="text-sm text-green-700 underline mt-2 inline-block"
            >
              What do these mean?
            </LocalizedClientLink>
          </div>
        )}
      </div>
    </div>
  )
}
