import Image from "next/image"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { ArrowRightIcon } from "@/icons"
import { listFeaturedCategories } from "@/lib/data/categories"
import { Style } from "@/types/categories"

export async function ShopByStyleSection() {
  const featuredCategories = await listFeaturedCategories(5)
  const styles: Style[] = featuredCategories.map((category, index) => ({
    id: index + 1,
    name: category.name.toUpperCase(),
    href: `/categories/${category.handle}`,
  }))

  if (styles.length === 0) {
    return null
  }

  return (
    <section className="bg-primary container">
      <h2 className="heading-lg text-primary mb-12">SHOP BY TYPE</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 items-center">
        <div className="py-[52px] px-[58px] h-full border rounded-sm">
          {styles.map((style) => (
            <LocalizedClientLink
              key={style.id}
              href={style.href}
              className="group flex items-center gap-4 text-primary hover:text-action transition-colors border-b border-transparent hover:border-primary w-fit pb-2 mb-8"
            >
              <span className="heading-lg">{style.name}</span>
              <ArrowRightIcon className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </LocalizedClientLink>
          ))}
        </div>
        <div className="relative hidden lg:block">
          <Image
            loading="lazy"
            fetchPriority="high"
            src="/images/shop-by-styles/Image.jpg"
            alt="Browse products by type"
            width={700}
            height={600}
            className="object-cover rounded-sm w-full h-auto"
          />
        </div>
      </div>
    </section>
  )
}
