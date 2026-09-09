import type { Metadata } from "next"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import {
  listAidOffers,
  listAidRequests,
  listMyAidOffers,
  listMyAidRequests,
  type AidPost,
} from "@/lib/data/mutual-aid"
import AidComposer from "./aid-composer"
import MyAidPosts from "./my-aid-posts"
import OfferHelpButton from "./offer-help-button"

export const metadata: Metadata = {
  title: "Mutual Aid",
  description:
    "Ask for help, or say what you can give. A neighbourhood board for needs money is not the answer to.",
}

/**
 * The mutual-aid board.
 *
 * The module and its `/store/mutual-aid/*` routes have existed since Phase 5
 * and had no surface at all — no page, no route, no client — so the board was
 * reachable only by someone writing HTTP requests by hand.
 *
 * What this page never shows is as deliberate as what it does. The API's
 * projection is whitelist-only and emits a coarse `locality` and never
 * coordinates, so there is no map here, no distance, and no pin: a public board
 * is the easiest place to leak where a vulnerable person lives. Urgency is
 * shown only on your own asks, because the public projection withholds it —
 * a board that ranked strangers' needs by urgency would reward overstating it.
 */
export default async function MutualAidPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>
}) {
  const params = (await searchParams) ?? {}
  const category = params.category?.trim() || undefined

  const [requests, offers, myRequests, myOffers] = await Promise.all([
    listAidRequests(category ? { category } : undefined),
    listAidOffers(category ? { category } : undefined),
    listMyAidRequests(),
    listMyAidOffers(),
  ])

  return (
    <main className="container py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold">Mutual aid</h1>
        <p className="mt-2 text-sm text-ui-fg-subtle">
          Ask for something you need, or say what you can give. Posts show a
          neighbourhood, never an address — arrange the details between
          yourselves once someone has taken a request on.
        </p>
      </header>

      {category ? (
        <p className="mb-6 text-sm text-ui-fg-subtle">
          Filtered to <span className="font-medium">{category}</span>.{" "}
          <LocalizedClientLink href="/mutual-aid" className="underline">
            Show everything
          </LocalizedClientLink>
        </p>
      ) : null}

      <MyAidPosts requests={myRequests} offers={myOffers} />

      <AidComposer />

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <AidColumn
          heading="People asking"
          empty="Nobody has asked for anything yet."
          posts={requests}
          testId="mutual-aid-requests"
          offerHelp
        />
        <AidColumn
          heading="People offering"
          empty="Nobody has offered anything yet."
          posts={offers}
          testId="mutual-aid-offers"
        />
      </div>
    </main>
  )
}

function AidColumn({
  heading,
  empty,
  posts,
  testId,
  offerHelp = false,
}: {
  heading: string
  empty: string
  posts: AidPost[]
  testId: string
  /** Only requests can be taken on; an offer is taken up by asking for it. */
  offerHelp?: boolean
}) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-3 text-lg font-medium">
        {heading}{" "}
        <span className="text-sm font-normal text-ui-fg-subtle">
          ({posts.length})
        </span>
      </h2>

      {posts.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-ui-fg-subtle">
          {empty}
        </div>
      ) : (
        <ul className="grid gap-3">
          {posts.map((post) => (
            <li key={post.id} className="rounded-md border p-4">
              <div className="mb-1 text-xs uppercase text-ui-fg-subtle">
                {post.category || "General"}
                {post.locality ? ` · ${post.locality}` : ""}
              </div>
              <h3 className="mb-1 font-medium">{post.title}</h3>
              <p className="text-sm text-ui-fg-subtle">{post.description}</p>
              {post.quantity ? (
                <p className="mt-2 text-xs text-ui-fg-subtle">
                  {post.quantity} {post.unit_of_measure || "needed"}
                </p>
              ) : null}
              {offerHelp ? <OfferHelpButton requestId={post.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
