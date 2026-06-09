"use client"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@/components/molecules/LocalizedLink/LocalizedLink"
import { cn } from "@/lib/utils"
import { useParams, usePathname } from "next/navigation"
import { CollapseIcon } from "@/icons"
import { useState, useRef, useEffect } from "react"
import footerLinks from "@/data/footerLinks"

export const CategoryNavbar = ({
  categories,
  onClose,
}: {
  categories: HttpTypes.StoreProductCategory[]
  onClose?: (state: boolean) => void
}) => {
  const { category } = useParams()
  const pathname = usePathname()
  const isGardensActive = pathname?.includes("/gardens")
  const isProducersActive = pathname?.includes("/producers")
  const isVendorsActive = pathname?.includes("/vendors")
  const isCollectiveActive = pathname?.includes("/collective/demand-pools")
  const isCommunityResourcesActive = pathname?.includes("/community-resources")
  const isFeatureMatrixActive = pathname?.includes("/feature-matrix")
  const isCollectionsActive = pathname?.includes("/collections")
  const isAboutActive = pathname?.includes("/how-it-works") || pathname?.includes("/sell") || pathname?.includes("/kitchens") || pathname?.includes("/invest")
  const [showAboutDropdown, setShowAboutDropdown] = useState(false)
  const aboutDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (aboutDropdownRef.current && !aboutDropdownRef.current.contains(event.target as Node)) {
        setShowAboutDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <nav className="flex md:items-center flex-col md:flex-row">
      <LocalizedClientLink
        href="/categories"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between"
        )}
      >
        All Products
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/producers"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isProducersActive && "md:border-b md:border-primary"
        )}
      >
        Our Producers
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/gardens"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isGardensActive && "md:border-b md:border-primary"
        )}
      >
        Gardens
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/vendors"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isVendorsActive && "md:border-b md:border-primary"
        )}
      >
        All Vendors
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/collective/demand-pools"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isCollectiveActive && "md:border-b md:border-primary"
        )}
      >
        Collective Buys
      </LocalizedClientLink>

      <LocalizedClientLink
        href="/opportunities"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          pathname?.includes("/opportunities") && "md:border-b md:border-primary"
        )}
      >
        Opportunities
      </LocalizedClientLink>

      <LocalizedClientLink
        href="/community-resources"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isCommunityResourcesActive && "md:border-b md:border-primary"
        )}
      >
        Community Resources
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/feature-matrix"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isFeatureMatrixActive && "md:border-b md:border-primary"
        )}
      >
        Feature Matrix
      </LocalizedClientLink>
      <LocalizedClientLink
        href="/collections"
        onClick={() => (onClose ? onClose(false) : null)}
        className={cn(
          "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
          isCollectionsActive && "md:border-b md:border-primary"
        )}
      >
        Collections
      </LocalizedClientLink>
      {categories?.map(({ id, handle, name }) => (
        <LocalizedClientLink
          key={id}
          href={`/categories/${handle}`}
          onClick={() => (onClose ? onClose(false) : null)}
          className={cn(
            "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between",
            handle === category && "md:border-b md:border-primary"
          )}
        >
          {name}
          <CollapseIcon size={18} className="-rotate-90 md:hidden" />
        </LocalizedClientLink>
      ))}

      {/* About Dropdown */}
      <div className="relative" ref={aboutDropdownRef}>
        <button
          onClick={() => setShowAboutDropdown(!showAboutDropdown)}
          className={cn(
            "label-md uppercase px-4 my-3 md:my-0 flex items-center justify-between gap-1",
            isAboutActive && "md:border-b md:border-primary"
          )}
        >
          About
          <CollapseIcon size={18} className={cn("transition-transform", showAboutDropdown ? "rotate-180" : "")} />
        </button>
        {showAboutDropdown && (
          <div className="md:absolute left-0 top-full bg-primary border border-primary rounded-sm z-20 min-w-[180px] shadow-solarpunk-sm">
            {footerLinks.about.map(({ label, path }) => (
              path.startsWith('http') ? (
                <a
                  key={label}
                  href={path}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setShowAboutDropdown(false)
                    onClose?.(false)
                  }}
                  className="block label-md px-4 py-2 hover:bg-secondary transition-colors duration-200"
                >
                  {label}
                </a>
              ) : (
                <LocalizedClientLink
                  key={label}
                  href={path}
                  onClick={() => {
                    setShowAboutDropdown(false)
                    onClose?.(false)
                  }}
                  className="block label-md px-4 py-2 hover:bg-secondary transition-colors duration-200"
                >
                  {label}
                </LocalizedClientLink>
              )
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
