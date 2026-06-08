import { ProductDetailsPage } from "@/components/sections"
import { listProducts } from "@/lib/data/products"
import { generateProductMetadata } from "@/lib/helpers/seo"
import { selectPresentation } from "@/lib/listing/presentation"
import { getStorefrontContext } from "@/lib/data/cookies"
import { getProductCommunity } from "@/lib/data/discovery"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

// §13 Community Product Page panel: related coalitions, creator content, and a
// Blackout Dens discussion link (threads are Blackout-hosted). Self-contained
// so it never blocks the product render — failures degrade to nothing.
async function ProductCommunitySection({ handle }: { handle: string }) {
  const community = await getProductCommunity(handle)
  if (!community) {
    return null
  }
  const { coalition_recommendations, creator_content, discussion } = community
  if (
    !coalition_recommendations?.length &&
    !creator_content?.length &&
    !discussion?.deep_link
  ) {
    return null
  }
  return (
    <section className="my-10 border-t pt-8">
      <h2 className="mb-4 text-xl font-semibold">Community</h2>
      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase text-ui-fg-subtle">
            Related coalitions
          </h3>
          {coalition_recommendations?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {coalition_recommendations.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ui-fg-subtle">None yet.</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase text-ui-fg-subtle">
            Guides &amp; tutorials
          </h3>
          {creator_content?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {creator_content.map((a) => (
                <li key={a.slug}>
                  <LocalizedClientLink
                    href={`/knowledge-base/${a.slug}`}
                    className="hover:text-green-700"
                  >
                    {a.title}
                  </LocalizedClientLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ui-fg-subtle">None yet.</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase text-ui-fg-subtle">
            Discussion
          </h3>
          {discussion?.deep_link ? (
            <a
              href={discussion.deep_link}
              className="text-sm text-green-700 hover:underline"
            >
              Join the discussion on Blackout →
            </a>
          ) : (
            <p className="text-sm text-ui-fg-subtle">No thread yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}): Promise<Metadata> {
  const { handle, locale } = await params

  const prod = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
    forceCache: true,
  }).then(({ response }) => response.products[0])

  return generateProductMetadata(prod)
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}) {
  const { handle, locale } = await params

  const prod = await listProducts({
    countryCode: locale,
    queryParams: { handle: [handle], limit: 1 },
    forceCache: true,
  }).then(({ response }) => response.products[0])

  if (!prod) {
    return notFound()
  }

  const storefrontContext = await getStorefrontContext()
  const presentation = selectPresentation({
    routeKind: "products",
    storefrontContext,
    sellerHandle: prod.seller?.handle ?? null,
  })

  return (
    <main className="container">
      <ProductDetailsPage handle={handle} locale={locale} presentation={presentation} />
      <ProductCommunitySection handle={handle} />
    </main>
  )
}
