"use client"

import { HttpTypes } from "@medusajs/types"
import {
  AlgoliaProductSidebar,
  ProductCard,
  ProductListingActiveFilters,
  ProductsPagination,
} from "@/components/organisms"
import { client } from "@/lib/client"
import { Configure, useHits } from "react-instantsearch"
import { InstantSearchNext } from "react-instantsearch-nextjs"
import { useSearchParams } from "next/navigation"
import { getFacedFilters } from "@/lib/helpers/get-faced-filters"
import { PRODUCT_LIMIT } from "@/const"
import { ProductListingSkeleton } from "@/components/organisms/ProductListingSkeleton/ProductListingSkeleton"
import { useEffect, useMemo, useState } from "react"
import { listProducts } from "@/lib/data/products"
import {
  SUSPENDED_SELLER_ALGOLIA_CLAUSE,
  productMatchesPriceRange,
} from "@/lib/listing/policy"

export const AlgoliaProductsListing = ({
  category_id,
  collection_id,
  seller_handle,
  locale = process.env.NEXT_PUBLIC_DEFAULT_REGION,
  currency_code,
}: {
  category_id?: string
  collection_id?: string
  locale?: string
  seller_handle?: string
  currency_code: string
}) => {
  const searchParamas = useSearchParams()

  const facetFilters: string = getFacedFilters(searchParamas)
  const query: string = searchParamas.get("query") || ""
  const page: number = +(searchParamas.get("page") || 1)

  const filters = `${
    seller_handle
      ? `NOT seller:null AND seller.handle:${seller_handle} AND `
      : "NOT seller:null AND "
  }${SUSPENDED_SELLER_ALGOLIA_CLAUSE} AND supported_countries:${locale}${
    category_id ? ` AND categories.id:${category_id}` : ""
  }${collection_id ? ` AND collection.id:${collection_id}` : ""}${
    facetFilters ? ` AND ${facetFilters}` : ""
  }`

  return (
    <InstantSearchNext searchClient={client} indexName="products">
      <Configure
        query={query}
        filters={filters}
        hitsPerPage={PRODUCT_LIMIT}
        page={Math.max(page - 1, 0)}
      />
      <ProductsListing
        locale={locale}
        currency_code={currency_code}
        filters={filters}
      />
    </InstantSearchNext>
  )
}

const ProductsListing = ({
  locale,
  currency_code,
  filters,
}: {
  locale?: string
  currency_code: string
  filters: string
}) => {
  const [apiProducts, setApiProducts] = useState<
    HttpTypes.StoreProduct[] | null
  >(null)
  const [isHydratingProducts, setIsHydratingProducts] = useState(true)
  const { items, results } = useHits()
  const itemHandles = useMemo(
    () => items.map((item) => item.handle).filter(Boolean),
    [items]
  )

  const searchParamas = useSearchParams()

  useEffect(() => {
    let isMounted = true

    const setProducts = async () => {
      if (!itemHandles.length) {
        if (isMounted) {
          setApiProducts([])
          setIsHydratingProducts(false)
        }

        return
      }

      try {
        setIsHydratingProducts(true)

        const { response } = await listProducts({
          countryCode: locale,
          queryParams: {
            fields:
              "*variants.calculated_price,*seller.reviews,-thumbnail,-images,-type,-tags,-variants.options,-options,-collection,-collection_id",
            handle: itemHandles,
            limit: itemHandles.length,
          },
        })

        if (isMounted) {
          setApiProducts(response.products)
          setIsHydratingProducts(false)
        }
      } catch {
        if (isMounted) {
          setApiProducts([])
          setIsHydratingProducts(false)
        }
      }
    }

    setProducts()

    return () => {
      isMounted = false
    }
  }, [itemHandles, locale])

  if (isHydratingProducts && apiProducts === null)
    return <ProductListingSkeleton />

  const minPriceParam = searchParamas.get("min_price")
  const maxPriceParam = searchParamas.get("max_price")
  const hasPriceRange = minPriceParam !== null || maxPriceParam !== null

  const products = items.filter((pr) =>
    (apiProducts ?? []).some(
      (p: any) =>
        p.id === pr.objectID &&
        (!hasPriceRange ||
          productMatchesPriceRange(p, {
            currencyCode: currency_code,
            minPrice: minPriceParam !== null ? Number(minPriceParam) : undefined,
            maxPrice: maxPriceParam !== null ? Number(maxPriceParam) : undefined,
          }))
    )
  )

  const count = products.length
  const pages = results?.nbPages || 1

  return (
    <div className="min-h-[70vh]">
      <div className="flex justify-between w-full items-center">
        <div className="my-4 label-md">{`${count} listings`}</div>
      </div>
      <div className="hidden md:block">
        <ProductListingActiveFilters />
      </div>
      <div className="md:flex gap-4">
        <div className="w-[280px] flex-shrink-0 hidden md:block">
          <AlgoliaProductSidebar />
        </div>
        <div className="w-full">
          {!items.length ? (
            <div className="text-center w-full my-10">
              <h2 className="uppercase text-primary heading-lg">no results</h2>
              <p className="mt-4 text-lg">
                Sorry, we can&apos;t find any results for your criteria
              </p>
            </div>
          ) : (
            <div className="w-full">
              <ul className="flex flex-wrap gap-4">
                {products.map((hit) => (
                  <ProductCard
                    api_product={apiProducts?.find(
                      (p: any) => p.id === hit.objectID
                    )}
                    key={hit.objectID}
                    product={hit}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <ProductsPagination pages={pages} />
    </div>
  )
}
