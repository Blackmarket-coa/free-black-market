import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCreatorByHandle } from "@/lib/data/creator"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const creator = await getCreatorByHandle(handle)
  if (!creator) return { title: "Creator Not Found" }
  return {
    title: `@${creator.handle} | Creator on FreeBlackMarket`,
    description:
      creator.bio ||
      `Shop products curated by @${creator.handle} on FreeBlackMarket.`,
  }
}

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  twitter: "Twitter",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
}

export default async function CreatorPage({
  params,
}: {
  params: Promise<{ handle: string; locale: string }>
}) {
  const { handle } = await params
  const creator = await getCreatorByHandle(handle)
  if (!creator) return notFound()

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-semibold">@{creator.handle}</h1>
          {creator.verified ? (
            <span className="inline-block bg-blue-500 text-white text-xs px-2 py-1 rounded">
              Verified
            </span>
          ) : null}
        </div>
        {creator.bio ? <p className="text-gray-700 mb-4">{creator.bio}</p> : null}
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>
            <strong>{creator.total_followers.toLocaleString()}</strong>{" "}
            followers
          </span>
          {creator.niches.length > 0 ? (
            <span>
              {creator.niches.map((n) => (
                <span
                  key={n}
                  className="inline-block bg-gray-100 px-2 py-1 rounded mr-1"
                >
                  {n}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {creator.social_links ? (
          <div className="flex gap-4 mt-4">
            {Object.entries(creator.social_links)
              .filter(([_, v]) => !!v)
              .map(([k, v]) => (
                <a
                  key={k}
                  href={v as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline"
                >
                  {SOCIAL_LABELS[k] ?? k}
                </a>
              ))}
          </div>
        ) : null}
      </header>

      <section className="border-t border-gray-200 pt-6">
        <h2 className="text-xl font-medium mb-4">Shop my picks</h2>
        <p className="text-gray-500 italic">
          Featured products coming soon. Follow this creator to see their
          shoppable content as it goes live.
        </p>
      </section>
    </main>
  )
}
