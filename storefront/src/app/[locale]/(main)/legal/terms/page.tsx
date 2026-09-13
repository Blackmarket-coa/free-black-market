import type { Metadata } from "next"

import { LegalPage, type LegalSection } from "@/components/organisms/LegalPage/LegalPage"
import { CLAIM_WINDOW_DAYS } from "@/lib/constants/order-claims"
import {
  CONTACT_LEGAL,
  CONTACT_SUPPORT,
  DISPUTE_VENUE,
  GOVERNING_LAW,
  LEGAL_ADDRESS,
  LEGAL_ENTITY,
  LEGAL_ENTITY_FORM,
  MINIMUM_AGE,
} from "@/lib/constants/legal"

export const metadata: Metadata = {
  title: "Terms of Service | Free Black Market",
  description:
    "The agreement between you and Free Black Market: who you are buying from, how payment works, what we are responsible for and what we are not.",
}

/**
 * Terms of Service.
 *
 * The load-bearing clause is section 3. FBM operates under the FinCEN payment-
 * processor exemption (`docs/POSTURE_A_COMPLIANCE.md`), which requires that the
 * platform facilitate purchases under an agreement made directly with the
 * seller receiving the funds, rather than acting as a conduit between two
 * parties. Terms that described FBM as the seller of the goods would contradict
 * the posture the whole payment architecture is built on. Standard marketplace
 * boilerplate gets this wrong routinely, which is why it is spelled out.
 */

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    heading: "1. Who these terms are with",
    blocks: [
      {
        kind: "p",
        text: `Free Black Market ("FBM", "we", "us") is operated by ${LEGAL_ENTITY}, ${LEGAL_ENTITY_FORM}, at ${LEGAL_ADDRESS}. These terms are the agreement between you and ${LEGAL_ENTITY} for your use of the FBM website, storefronts and applications.`,
      },
      {
        kind: "p",
        text: "By creating an account, placing an order, or listing goods for sale, you accept these terms. If you do not accept them, do not use the platform.",
      },
      {
        kind: "p",
        text: `You must be at least ${MINIMUM_AGE} years old to hold an account. Accounts can hold a ledger balance, receive payouts and enter binding purchases, and we do not offer a form of account that a minor can hold.`,
      },
    ],
  },
  {
    id: "what-fbm-is",
    heading: "2. What FBM is",
    blocks: [
      {
        kind: "p",
        text: "FBM is a marketplace. Independent sellers — makers, growers, cooperatives, small businesses — list goods and services, and buyers order from them. Alongside the marketplace, FBM runs cooperative-economy features: community gardens, mutual-aid distribution, volunteer coordination, creator bounties, collective buying and an internal ledger that records value moving between them.",
      },
      {
        kind: "p",
        text: "Some of those features are available only to certain members, some are switched off entirely, and some are described on the site as planned rather than live. A feature being described does not mean it is available to you.",
      },
    ],
  },
  {
    id: "who-you-buy-from",
    heading: "3. Who you are buying from, and what we do with the money",
    blocks: [
      {
        kind: "note",
        title: "The contract for the goods is between you and the seller",
        text: "FBM is not the seller. When you place an order, you enter into a contract of sale with the independent seller who listed the item. They are responsible for the goods, for describing them accurately, for fulfilling the order and for any warranty on it. We provide the marketplace, process the payment, and operate the claims process described in section 6.",
      },
      {
        kind: "p",
        text: "We accept your payment, hold it briefly, and disburse it to the seller through a regulated payment processor into a US bank account. We do this under an agreement made directly with each seller. We are a payment facilitator for that transaction; we are not a bank, we are not a money transmitter, and we do not offer you an account for storing or sending money to other people.",
      },
      {
        kind: "p",
        text: "On a standard order the seller is paid out on the processor's normal schedule. Your payment is not held in escrow until delivery. Some flows — collective buys, crowdfunding campaigns and creator bounties, where money is committed before anything exists to ship — do hold funds, and those flows say so at the point of payment.",
      },
      {
        kind: "note",
        title: "Balances on the internal ledger are not money you can send",
        text: "Credits, patronage and similar balances record value inside FBM and can be applied to purchases here. They are not deposits, they are not insured, they do not earn interest, and they cannot be transferred to another member or cashed out as a payment to a third party. Where a balance can be withdrawn at all, it is paid to a bank account in the holder's own name.",
      },
    ],
  },
  {
    id: "your-account",
    heading: "4. Your account",
    blocks: [
      {
        kind: "p",
        text: "You are responsible for what happens under your account and for keeping your credentials secure. Tell us promptly if you believe someone else has access to it.",
      },
      {
        kind: "p",
        text: "Give accurate information and keep it current. Sellers, and buyers who receive deliveries, must provide details that are true — a delivery address that is not yours, or a business identity that is not real, is a breach of these terms and not a mistake we can work around.",
      },
      {
        kind: "p",
        text: "You may close your account at any time from your account settings. What happens to your data when you do is described in the Privacy Policy, and it is worth reading before you close it rather than after.",
      },
    ],
  },
  {
    id: "selling",
    heading: "5. If you sell on FBM",
    blocks: [
      {
        kind: "p",
        text: "Sellers agree to a separate seller agreement in addition to these terms. In summary, and without replacing that agreement:",
      },
      {
        kind: "list",
        items: [
          "You are the seller of record for what you list. You are responsible for the accuracy of your listings, for the legality of what you sell, and for your own tax obligations.",
          "You must hold the licences, permits and insurance your goods require. Cottage food, prepared food, wellness and herbal goods, and anything consumed or applied to the body are regulated differently in every state, and it is your responsibility to know which rules apply to you.",
          "You must honour the fulfilment times and the return terms you publish, and respond to buyers within a reasonable period.",
          "You authorise us to accept payment on your behalf and to deduct our fees and any refunds or claim outcomes before disbursing the remainder to you.",
          "We may suspend a listing or an account where we have reasonable grounds to believe it breaks these terms or the law, or presents a risk to buyers. Where we can tell you why, we will.",
        ],
      },
    ],
  },
  {
    id: "problems",
    heading: "6. When an order goes wrong",
    blocks: [
      {
        kind: "p",
        text: `If an order never arrives, arrives damaged, is missing items or is materially not what was described, you can open a claim from your order page within ${CLAIM_WINDOW_DAYS} days of the order. The Buyer Protection page sets out what is covered, what is not, and how a claim is decided. The Refunds and Returns page covers returns, which are a separate thing from a claim.`,
      },
      {
        kind: "p",
        text: "Our claims process does not replace your rights against your card issuer or your rights under consumer law, and in most cases the card issuer's window is longer than ours.",
      },
      {
        kind: "p",
        text: "Anything you pay a seller outside the platform is outside all of it. If you pay by bank transfer, cash app or in person, we have no record of the payment and no ability to act on it.",
      },
    ],
  },
  {
    id: "conduct",
    heading: "7. What you may not do",
    blocks: [
      {
        kind: "list",
        items: [
          "List, buy or arrange anything illegal, or anything you are not licensed to sell.",
          "Take payment off-platform for an order arranged here, or ask a buyer to.",
          "Misrepresent who you are, impersonate another member, or operate an account on behalf of someone who has been suspended.",
          "Interfere with the platform: automated scraping at a scale that degrades it, probing for vulnerabilities outside the disclosure policy, or attempting to reach other members' data.",
          "Use another member's personal information — including anything you learn through a delivery, a garden roster or a volunteer record — for anything other than the purpose it was shared for.",
          "Manipulate reputation: fake reviews, coordinated voting, or inflating karma and participation records.",
        ],
      },
      {
        kind: "p",
        text: "Security researchers: the disclosure policy in SECURITY.md governs, and testing within it is not a breach of this section.",
      },
    ],
  },
  {
    id: "your-content",
    heading: "8. Content you post",
    blocks: [
      {
        kind: "p",
        text: "You keep ownership of what you post — listings, photos, reviews, messages and community contributions. You give us a non-exclusive, worldwide, royalty-free licence to host, display and distribute it for the purpose of operating and promoting the platform. That licence ends when you remove the content, except where it has already been included in something that cannot practically be recalled, such as an order record or a copy someone else made while it was public.",
      },
      {
        kind: "p",
        text: "Do not post what is not yours to post. We remove infringing content on notice; repeat infringers lose their accounts.",
      },
    ],
  },
  {
    id: "the-software",
    heading: "9. The software itself",
    blocks: [
      {
        kind: "p",
        text: "FBM's source code is published under the GNU Affero General Public License v3.0. You may run your own copy, and section 13 of that licence means anyone running a modified copy as a network service owes its source to the people using it. That is a right in the code, and it is separate from these terms, which govern the service we operate. Nothing here limits what the licence grants you.",
      },
    ],
  },
  {
    id: "liability",
    heading: "10. What we are and are not responsible for",
    blocks: [
      {
        kind: "p",
        text: "The platform is provided as it is. We do not warrant that it will be uninterrupted or error-free, and we do not warrant the goods sold on it — those are the sellers'.",
      },
      {
        kind: "p",
        text: "We are responsible for our own failures in operating the platform and for the payments we handle. To the fullest extent the law allows, we are not liable for indirect or consequential losses, and our total liability to you for any claim relating to the platform is limited to the greater of the amount you paid through FBM in the twelve months before the claim and one hundred US dollars.",
      },
      {
        kind: "p",
        text: "Nothing in these terms limits liability that cannot lawfully be limited, including for fraud, for death or personal injury caused by negligence, and any non-waivable rights you have under consumer protection law.",
      },
    ],
  },
  {
    id: "changes",
    heading: "11. Changes, suspension and ending the agreement",
    blocks: [
      {
        kind: "p",
        text: "We may change these terms. For a change that materially reduces your rights we will give notice before it takes effect, and continuing to use the platform after that date is acceptance. If you do not accept it, close your account.",
      },
      {
        kind: "p",
        text: "You can stop using FBM at any time. We may suspend or end your access for a breach of these terms, or where we are required to. Ending the agreement does not cancel obligations already incurred — an order placed, a payout owed, or a claim in progress survives it.",
      },
    ],
  },
  {
    id: "law",
    heading: "12. Governing law and disputes",
    blocks: [
      {
        kind: "p",
        text: `These terms are governed by the laws of ${GOVERNING_LAW}, without regard to its conflict-of-laws rules. Disputes are resolved in ${DISPUTE_VENUE}.`,
      },
      {
        kind: "p",
        text: "Before starting formal proceedings, contact us and give us a genuine chance to resolve it. Most disputes are a misunderstanding about an order and are settled in a week.",
      },
    ],
  },
  {
    id: "contact",
    heading: "13. Contact",
    blocks: [
      {
        kind: "p",
        text: `Legal notices: ${CONTACT_LEGAL}, or by post to ${LEGAL_ENTITY} at ${LEGAL_ADDRESS}. Everything else: ${CONTACT_SUPPORT}.`,
      },
    ],
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary="The agreement between you and Free Black Market. The short version: you buy from independent sellers, we run the marketplace and handle the payment, and we say plainly which of those two we are responsible for."
      sections={SECTIONS}
    />
  )
}
