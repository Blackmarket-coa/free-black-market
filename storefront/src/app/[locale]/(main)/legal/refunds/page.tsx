import type { Metadata } from "next"

import { LegalPage, type LegalSection } from "@/components/organisms/LegalPage/LegalPage"
import { CLAIM_WINDOW_DAYS } from "@/lib/constants/order-claims"
import { CONTACT_SUPPORT } from "@/lib/constants/legal"

export const metadata: Metadata = {
  title: "Refunds and Returns | Free Black Market",
  description:
    "When you can return something, who sets the terms, how refunds are paid back, and which goods cannot be returned at all.",
}

/**
 * Refunds and Returns.
 *
 * Distinct from `/buyer-protection`, and the split is the point rather than an
 * accident of filing. A claim is for an order that went wrong and is decided by
 * FBM; a return is a change of mind and is governed by the seller's published
 * terms. Marketplaces that merge the two end up implying a platform-wide
 * returns guarantee they do not operate, and buyers discover the difference at
 * the worst moment.
 *
 * The perishable-goods carve-out is not boilerplate here: a large share of the
 * catalogue is food, plants and prepared goods, for which a right of return is
 * neither practical nor, in most states, lawful to promise.
 */

const SECTIONS: LegalSection[] = [
  {
    id: "two-things",
    heading: "1. Returns and claims are different",
    blocks: [
      {
        kind: "note",
        title: "A return is a change of mind",
        text: "The item is as described and arrived fine, and you would rather not keep it. Whether that is possible, and on what terms, is set by the seller and shown on the listing.",
      },
      {
        kind: "note",
        title: "A claim is an order that went wrong",
        text: "It never arrived, arrived damaged, was missing items, or was materially not what was described. FBM decides claims, and the Buyer Protection page sets out how.",
      },
      {
        kind: "p",
        text: "If you are not sure which you have, open a claim. We will redirect it if it is really a return, and nothing is lost by asking the wrong one first.",
      },
    ],
  },
  {
    id: "who-sets-terms",
    heading: "2. Who sets the return terms",
    blocks: [
      {
        kind: "p",
        text: "Each seller sets their own, and must publish them on the listing. FBM does not impose a single platform-wide returns window, because a nursery shipping live plants and a maker shipping ceramics cannot reasonably run the same policy. What we do require is that a seller honours the terms they published, and we will enforce that.",
      },
      {
        kind: "p",
        text: "If a listing shows no return terms, treat the goods as not returnable except where the law says otherwise or a claim applies.",
      },
    ],
  },
  {
    id: "not-returnable",
    heading: "3. What generally cannot be returned",
    blocks: [
      {
        kind: "p",
        text: "Regardless of a seller's terms, these are usually outside returns, for safety and legal reasons rather than commercial ones:",
      },
      {
        kind: "list",
        items: [
          "Food, drink and anything perishable, once it has left the seller.",
          "Live plants and cut flowers, beyond any establishment guarantee the seller offers.",
          "Goods made or grown to your order, and personalised items.",
          "Opened cosmetics, herbal and wellness products, and anything applied to the body.",
          "Digital goods and downloads once accessed.",
          "Services already delivered, and event or workshop places past the seller's cancellation window.",
        ],
      },
      {
        kind: "p",
        text: "None of this affects a claim. If a perishable item arrived spoiled or was not what was described, that is a claim and it is covered.",
      },
    ],
  },
  {
    id: "how-to-return",
    heading: "4. How to return something",
    blocks: [
      {
        kind: "list",
        items: [
          "Check the return terms on the listing or your order page, and act inside the seller's window.",
          "Request the return from your order page rather than sending the item back unannounced — a return that arrives unexpected can take much longer to refund, and sometimes cannot be matched to an order at all.",
          "Send it back in the condition you received it, with the packaging where that matters, and keep proof of postage.",
          "Unless the seller states otherwise, or the return is because something went wrong, return postage is yours.",
        ],
      },
    ],
  },
  {
    id: "refunds",
    heading: "5. How a refund is paid",
    blocks: [
      {
        kind: "p",
        text: "Refunds go back to the original payment method. We start it once the seller confirms the return, or once a claim is decided in your favour, and how quickly it appears after that is your bank's timing rather than ours — commonly a few business days, sometimes longer.",
      },
      {
        kind: "p",
        text: "Where part of an order is refunded, delivery is refunded proportionately only if the whole order is returned or the fault was the seller's.",
      },
      {
        kind: "p",
        text: "Where you paid partly with an internal balance, that part is returned to the balance and the rest to your payment method. A balance cannot be converted into a cash refund it did not start as.",
      },
    ],
  },
  {
    id: "cancelling",
    heading: "6. Cancelling before it ships",
    blocks: [
      {
        kind: "p",
        text: "Ask through your order page as soon as you can. Before dispatch a seller can usually cancel and refund in full. Made-to-order and grown-to-order goods may already be under way, and collective buys and campaign backings are committed once the buy or campaign closes — those pages say so before you pay.",
      },
    ],
  },
  {
    id: "timing",
    heading: "7. Time limits, and what to do if you miss them",
    blocks: [
      {
        kind: "p",
        text: `A claim must be opened within ${CLAIM_WINDOW_DAYS} days of the order. A return runs on the seller's window, which is usually shorter.`,
      },
      {
        kind: "p",
        text: `Outside both, your card issuer's dispute rights usually run longer than ours, and your rights under consumer law are unaffected by anything on this page. If you are past our window and still stuck, write to ${CONTACT_SUPPORT} — we would rather look at it than have you assume the door is closed.`,
      },
    ],
  },
]

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refunds and Returns"
      summary="Sellers set their own return terms and must honour what they publish. Claims for orders that went wrong are decided by us and are a separate process — this page explains which is which."
      sections={SECTIONS}
    />
  )
}
