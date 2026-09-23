import { HttpTypes } from "@medusajs/types"
import { existsSync } from "fs"
import path from "path"
import { Metadata } from "next"
import { headers } from "next/headers"

/**
 * A category's Open Graph image, or the placeholder when no artwork exists.
 * The previous `||` between two non-empty strings could never fall back, so
 * categories without artwork advertised a 404 to crawlers.
 */
function categoryImageUrl(
  protocol: string,
  host: string | null,
  handle: string
): string {
  const file = path.join(
    process.cwd(),
    "public",
    "images",
    "categories",
    `${handle}.png`
  )
  const relative = existsSync(file)
    ? `/images/categories/${handle}.png`
    : "/images/placeholder.svg"
  return `${protocol}://${host}${relative}`
}

export const generateProductMetadata = async (
  product: HttpTypes.StoreProduct
): Promise<Metadata> => {
  const headersList = await headers()
  const host = headersList.get("host")
  const protocol = headersList.get("x-forwarded-proto") || "https"

  return {
    title: product?.title,
    description: `${product?.title} - ${process.env.NEXT_PUBLIC_SITE_NAME}`,
    robots: "index, follow",
    metadataBase: new URL(`${protocol}://${host}/products/${product?.handle}`),

    openGraph: {
      title: product?.title,
      description: `${product?.title} - ${process.env.NEXT_PUBLIC_SITE_NAME}`,
      url: `${protocol}://${host}/products/${product?.handle}`,
      siteName: process.env.NEXT_PUBLIC_SITE_NAME,
      images: [
        {
          url:
            product?.thumbnail ||
            `${protocol}://${host}/images/placeholder.svg`,
          width: 1200,
          height: 630,
          alt: product?.title,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: product?.title,
      description: `${product?.title} - ${process.env.NEXT_PUBLIC_SITE_NAME}`,
      images: [
        product?.thumbnail || `${protocol}://${host}/images/placeholder.svg`,
      ],
    },
  }
}

export const generateCategoryMetadata = async (
  category: HttpTypes.StoreProductCategory
) => {
  const headersList = await headers()
  const host = headersList.get("host")
  const protocol = headersList.get("x-forwarded-proto") || "https"

  return {
    robots: "index, follow",
    metadataBase: new URL(
      `${protocol}://${host}/categories/${category.handle}`
    ),
    title: `${category.name} Category`,
    description: `${category.name} Category - ${process.env.NEXT_PUBLIC_SITE_NAME}`,

    openGraph: {
      title: category.name,
      description: `${category.name} Category - ${process.env.NEXT_PUBLIC_SITE_NAME}`,
      url: `${protocol}://${host}/categories/${category.handle}`,
      siteName: process.env.NEXT_PUBLIC_SITE_NAME,
      images: [
        {
          url: categoryImageUrl(protocol, host, category.handle),
          width: 1200,
          height: 630,
          alt: category.name,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: category.name,
      description: `${category.name} Category - ${process.env.NEXT_PUBLIC_SITE_NAME}`,
      images: [categoryImageUrl(protocol, host, category.handle)],
    },
  }
}
