import type { Metadata } from "next"

import { LegalPage, type LegalSection } from "@/components/organisms/LegalPage/LegalPage"
import {
  CONTACT_PRIVACY,
  LEGAL_ADDRESS,
  LEGAL_ENTITY,
  MINIMUM_AGE,
  SERVES_EU_UK,
} from "@/lib/constants/legal"

export const metadata: Metadata = {
  title: "Privacy Policy | Free Black Market",
  description:
    "What personal data Free Black Market collects, who it goes to, how long it is kept, and exactly what the delete-my-account button does and does not reach.",
}

/**
 * Privacy Policy.
 *
 * Section 6 is the one that took the work. `PrivacyDataSettings` ships a
 * "Delete my account" button backed by `POST /store/customers/me/deletion`,
 * which anonymises the customer record, drops saved addresses and revokes the
 * sign-in identity — and touches nothing else. Thirty-two backend modules key
 * records on `customer_id`, among them food deliveries carrying a recipient
 * name, phone and street address, volunteer attendance, garden membership,
 * wellness records and ledger balances.
 *
 * The matching export endpoint returns profile, addresses and orders while its
 * own payload states that it "contains the personal data Free Black Market
 * holds for your account", which is not true today.
 *
 * A privacy policy that repeated that claim would be the most consequential
 * false statement on the site, so this page describes the behaviour that
 * actually exists and names the manual route for a full erasure. The
 * engineering gap is tracked as D11-1 in `docs/AUDIT_DEBT.md` and reopens LEG-2
 * in `PRE_LAUNCH_AUDIT.md`; when the automated path covers everything, section
 * 6 gets simpler, not longer.
 */

const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    heading: "1. Who this covers",
    blocks: [
      {
        kind: "p",
        text: `This policy describes how ${LEGAL_ENTITY} handles personal data on Free Black Market. It covers buyers, sellers, couriers, garden and mutual-aid participants, and visitors who never create an account.`,
      },
      {
        kind: "p",
        text: `Whether the platform is knowingly offered to people in the EU or UK: ${SERVES_EU_UK}. That answer determines whether the GDPR and UK GDPR apply in addition to US state privacy law, so it is stated rather than implied.`,
      },
      {
        kind: "p",
        text: `The platform is not intended for anyone under ${MINIMUM_AGE}, and we do not knowingly collect data from children. If you believe a child has given us data, write to us and we will remove it.`,
      },
    ],
  },
  {
    id: "what-we-collect",
    heading: "2. What we collect",
    blocks: [
      {
        kind: "p",
        text: "Grouped by why it exists rather than by field name, because the reason is the part that matters:",
      },
      {
        kind: "list",
        items: [
          "Account and identity — name, email, phone, password credentials, and for sellers the business details and verification records needed to pay you and to confirm you are who you say you are.",
          "Orders and payment — what you bought, from whom, for how much, and the delivery address. Card numbers are handled by our payment processor and never reach our servers; we store the processor's reference and the last digits it returns.",
          "Delivery and logistics — pickup and delivery addresses, delivery instructions, any safe-place description you give, and, while a delivery is in progress, the courier's location. Couriers additionally have vehicle, licence, scheduling and background-check records.",
          "Community participation — garden membership, work-party attendance and check-in times, harvest claims, volunteer hours, governance votes, karma and progression records. This is data about what you did with other people, and it is the category members most often do not realise is stored.",
          "Ledger and cooperative finance — internal balances, patronage, payouts, and where applicable investment or campaign backing records.",
          "Wellness features, where you use them, involve information about your health or the products you use for it. We treat it as sensitive and it is not used for advertising or profiling.",
          "Messages and content — listings, reviews, photos, and messages you send through the platform.",
          "Technical and attribution — IP address, browser and device information, pages visited, and a visitor token we set to attribute a purchase to the creator or link that referred you. That token connects your browsing before you signed up to your later order.",
        ],
      },
    ],
  },
  {
    id: "why",
    heading: "3. Why we use it",
    blocks: [
      {
        kind: "list",
        items: [
          "To run the marketplace: process orders, take payment, pay sellers, arrange delivery and handle claims.",
          "To operate the cooperative features you opt into — a garden roster is visible to that garden's members, because a garden whose members cannot see each other does not work.",
          "To keep the platform safe: detect fraud, enforce the terms, and investigate abuse.",
          "To meet legal obligations, particularly tax, accounting and payment-processing rules.",
          "To communicate with you about your orders and account. Marketing email is separate and you can decline it without losing service messages.",
        ],
      },
      {
        kind: "note",
        title: "What we do not do",
        text: "We do not sell your personal information, and we do not share it for cross-context behavioural advertising. There is no advertising network embedded in the storefront.",
      },
    ],
  },
  {
    id: "who-sees-it",
    heading: "4. Who else sees it",
    blocks: [
      {
        kind: "list",
        items: [
          "Sellers see what they need to fulfil your order — your name, delivery address and contact details, and what you bought from them. They do not see your other orders.",
          "Couriers see the delivery details for the run they are driving.",
          "Other members of a garden or network you join see your participation in it. Your ledger balance is not shown to them.",
          "Stripe processes payments and is the recipient of the card and bank details you enter for it.",
          "Resend sends our transactional email and receives your address and the message.",
          "Sentry receives error reports from the site, which can incidentally include technical details of what you were doing when something broke.",
          "Professional advisers, and authorities where we are legally required to disclose.",
        ],
      },
      {
        kind: "p",
        text: "Each of these is given only what it needs for its purpose and is not permitted to use it for its own.",
      },
    ],
  },
  {
    id: "retention",
    heading: "5. How long we keep it",
    blocks: [
      {
        kind: "p",
        text: "Account data stays while your account is open. Transaction and payout records are kept for the period tax and accounting rules require, which is longer than the account and applies even after you close it. Delivery records and community participation records are kept while the garden, network or programme they belong to is running.",
      },
      {
        kind: "p",
        text: "Technical logs and attribution data are kept for a short operational period and then discarded.",
      },
    ],
  },
  {
    id: "your-rights",
    heading: "6. Your rights, and exactly what the buttons do",
    blocks: [
      {
        kind: "p",
        text: "Depending on where you live you have rights to know what we hold, to get a copy, to correct it, to delete it, and not to be discriminated against for exercising them. Two of those are wired into your account settings, and it is worth being precise about their present limits rather than letting you discover them later.",
      },
      {
        kind: "note",
        title: "Download my data",
        text: "Returns your profile, your saved addresses and your order history as a JSON file, immediately. It does not currently include your community participation records, delivery records, ledger entries or wellness data. If you want those too, ask us and we will assemble them by hand.",
      },
      {
        kind: "note",
        title: "Delete my account",
        text: "Removes your saved addresses, replaces the name, email and phone on your customer record with placeholders, and revokes your ability to sign in. It does not currently reach records held by the community, delivery, ledger and wellness features — a past delivery, for example, still carries the address it was delivered to. Completed transaction records are retained in any case, in anonymised form, because tax and accounting rules require it. If you want a full erasure rather than the automated one, write to us and we will carry it out manually.",
      },
      {
        kind: "p",
        text: `To exercise any right, or to ask for the manual erasure above, write to ${CONTACT_PRIVACY}. We will confirm receipt and respond within the period the applicable law allows. You may use an authorised agent, and you can appeal a refusal by replying to our response.`,
      },
    ],
  },
  {
    id: "security",
    heading: "7. Security",
    blocks: [
      {
        kind: "p",
        text: "Data is encrypted in transit. Access to production data is limited to the people who need it. Reads of other members' personal data are scoped by the platform, so a signed-in account cannot enumerate other people's deliveries, rosters or claims.",
      },
      {
        kind: "p",
        text: "No platform is perfectly secure, and we would rather say that than imply otherwise. We run a coordinated disclosure programme; if you find a vulnerability, report it under SECURITY.md rather than filing a public issue.",
      },
    ],
  },
  {
    id: "cookies",
    heading: "8. Cookies and similar technology",
    blocks: [
      {
        kind: "p",
        text: "We use cookies and local storage to keep you signed in, remember your cart and region, and carry the referral attribution described in section 2. We do not run third-party advertising or cross-site tracking cookies. Blocking cookies will break signing in and checkout.",
      },
    ],
  },
  {
    id: "changes",
    heading: "9. Changes and contact",
    blocks: [
      {
        kind: "p",
        text: "We will update this page when our handling changes, and will give notice of a material change rather than editing quietly.",
      },
      {
        kind: "p",
        text: `Questions, requests and complaints: ${CONTACT_PRIVACY}, or by post to ${LEGAL_ENTITY} at ${LEGAL_ADDRESS}.`,
      },
    ],
  },
]

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="What we collect, why, who else sees it, and what the download and delete buttons in your account settings actually reach today."
      sections={SECTIONS}
    />
  )
}
