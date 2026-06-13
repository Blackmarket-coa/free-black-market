import { logger } from "@/lib/logger"
import { CollectionsPage } from "@/components/sections/CollectionsPage/CollectionsPage"
import { Breadcrumbs } from "@/components/atoms"
import { listCollections } from "@/lib/data/categories"
import type { Metadata } from "next"

export const revalidate = 60

export const metadata: Metadata = {
  title: "Shop by Collection | Curated Product Collections",
  description:
    "Browse curated collections of products from our marketplace vendors. Discover hand-picked products across a variety of categories.",
}

export default async function Collections() {
  let collections: any[] = []

  try {
    collections = await listCollections()
  } catch (error) {
    logger.error("Failed to fetch collections:", error)
  }

  const breadcrumbsItems = [
    { path: "/collections", label: "Shop by Collection" },
  ]

  return (
    <main className="container py-8">
      <div className="hidden md:block mb-2">
        <Breadcrumbs items={breadcrumbsItems} />
      </div>
      <CollectionsPage collections={collections} />
    </main>
  )
}
