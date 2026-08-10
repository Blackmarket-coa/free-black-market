import type { Metadata } from "next"
import Link from "next/link"

import { GITHUB_REPO_URL } from "@/lib/constants/links"

export const metadata: Metadata = {
  title: "How Governance Works | Free Black Market",
  description:
    "Who decides what on Free Black Market — how garden and project voting works, how surplus is shared, and what 'community governed' does and doesn't mean today.",
}

/**
 * The governance mechanics, published.
 *
 * The homepage carries an "Open Source. Community Governed." badge and
 * /why-we-exist says platform rules "should be accountable to the people using
 * the system". Both were unbacked by any visible mechanism.
 *
 * The backend has real governance — proposals, quorum, weighted or equal
 * voting, delegation, patronage — but every model is scoped by `garden_id`.
 * There is no coalition-wide ballot. This page says both halves, because a
 * governance page that implied platform-level voting would be the exact failure
 * this work exists to correct. See docs/MEMBER_GOVERNANCE.md.
 */

const PROPOSAL_TYPES = [
  { type: "Budget", detail: "Spending from shared funds." },
  { type: "Policy", detail: "Changing the rules everyone operates under." },
  { type: "Membership", detail: "Decisions about who is a member and their standing." },
  { type: "Infrastructure", detail: "Physical changes to the site." },
  { type: "Governance", detail: "Changing how decisions themselves get made." },
  { type: "Allocation", detail: "How the harvest is divided." },
  { type: "Season plan", detail: "Approving what gets grown, and when." },
  { type: "Partnership", detail: "Working with an outside organisation." },
]

export default function GovernancePage() {
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-slate-950 text-white py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-slate-300 text-sm font-semibold">
            Governance
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">
            Who decides what
          </h1>
          <p className="text-lg text-slate-200 max-w-3xl">
            Plenty of platforms describe themselves as community-owned without
            saying what anyone actually gets to vote on. Here is where members
            genuinely decide, how the votes are counted, how surplus is shared —
            and, just as plainly, what is not put to a vote today.
          </p>
        </div>
      </section>

      {/* Lead with the limit, not the flattering half. */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold text-amber-900 mb-3">
            The short version
          </h2>
          <p className="text-sm text-amber-900/90 mb-3">
            Governance here is real at the <strong>project level</strong> — a
            community garden, a growing site, a shared plot. Members propose,
            debate, and vote, and the result binds the project.
          </p>
          <p className="text-sm text-amber-900/90">
            There is <strong>no coalition-wide ballot</strong>. You cannot
            currently vote on platform rules, fees, or roadmap. What backs
            &ldquo;community governed&rdquo; at that level is that the code is
            public and any community can run its own instance — a right of exit,
            not a vote. We would rather say that than let the badge imply an
            election that does not happen.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          Voting inside a garden or project
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          Any member can put a proposal to the group. It carries a voting window,
          a quorum, and an approval threshold set by the project — so a decision
          needs both enough turnout and enough support.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 mb-8">
          {PROPOSAL_TYPES.map((item) => (
            <div key={item.type} className="rounded-xl border p-4">
              <p className="font-semibold mb-1">{item.type}</p>
              <p className="text-sm text-gray-600">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold mb-2">One member, one vote</h3>
            <p className="text-sm text-gray-600">
              The default. Everyone gets exactly one vote whatever they have put
              in — no weighting by hours or money. Projects choose this model and
              most do.
            </p>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold mb-2">Weighted by contribution</h3>
            <p className="text-sm text-gray-600">
              A project can instead weight votes by volunteer hours and
              investment, each scaled by a weight the project sets. Every vote
              records the figures it was calculated from, so a member can see why
              theirs counted for what it did.
            </p>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold mb-2">Delegation</h3>
            <p className="text-sm text-gray-600">
              A member can hand their vote to someone they trust for decisions
              they can&apos;t attend to themselves.
            </p>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold mb-2">No quorum, no result</h3>
            <p className="text-sm text-gray-600">
              A proposal that closes without meeting quorum expires — it is not
              recorded as rejected. Something nobody voted on has not been turned
              down.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">
          How surplus is shared
        </h2>
        <p className="text-gray-600 mb-6 max-w-3xl">
          Cooperatives return surplus in proportion to what members contributed,
          not to what they invested. That is what makes it patronage rather than
          a dividend, and it is the formula the ledger implements.
        </p>
        <div className="rounded-2xl border bg-neutral-50 p-6 md:p-8">
          <p className="font-mono text-sm text-gray-800 mb-4">
            your refund = (commission you paid this quarter ÷ commission everyone
            paid this quarter) × the refund pool
          </p>
          <p className="text-sm text-gray-700 mb-3">
            Calculated automatically on the first day of each quarter for the
            quarter just ended, one allocation per seller.
          </p>
          <p className="text-sm text-gray-700">
            Payment is a separate, deliberate step rather than an automatic
            transfer — an operator reviews the allocations before money moves,
            and disbursement runs over the same Stripe rail as ordinary payouts.
            So the calculation is automatic; the payment is not.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">Cooperatives</h2>
        <p className="text-gray-600 max-w-3xl mb-4">
          A co-op selling here records its own governance model, its membership
          requirements, its member roles, and each member&apos;s share of sales.
        </p>
        <div className="rounded-xl border p-5">
          <p className="text-sm text-gray-700">
            Worth being precise: that is a co-op <em>publishing</em> how it
            governs itself. The platform stores and displays it — it does not run
            co-op elections or enforce the declared model. If a co-op says
            one-member-one-vote, that is their commitment to their members, not
            ours to you.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8">
          <h2 className="text-xl font-semibold text-green-900 mb-3">
            What we&apos;d need to build to claim more
          </h2>
          <ol className="space-y-2 text-sm text-green-900/90 list-decimal list-inside mb-5">
            <li>Coalition membership that isn&apos;t scoped to a single project.</li>
            <li>Proposals and votes at that scope.</li>
            <li>
              A published constitution — what is votable, and what a passed vote
              actually binds. A vote maintainers may ignore is a survey.
            </li>
            <li>A public record of outcomes.</li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <Link
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium"
              data-event="github_transparency_link_clicked"
            >
              Read the source
            </Link>
            <Link
              href="/transparency"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium"
            >
              What we charge
            </Link>
            <Link
              href="/why-we-exist"
              className="rounded-lg border border-green-300 px-4 py-2 text-green-900 text-sm font-medium"
            >
              Why we exist
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
