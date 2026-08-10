'use client';

import { HttpTypes } from '@medusajs/types';
import {
  CategoryNavbar,
  HeaderCategoryNavbar,
} from '@/components/molecules';
import { CloseIcon, HamburgerMenuIcon, SearchIcon, CollapseIcon } from '@/icons';
import { VENDOR_PANEL_URL } from '@/const';
import { useState } from 'react';
import LocalizedClientLink from '@/components/molecules/LocalizedLink/LocalizedLink';
import { useRouter } from 'next/navigation';
import { CmsType, CmsCategory } from '@/lib/data/cms-taxonomy';
import { cn } from '@/lib/utils';

/**
 * The pages that answer "can I trust this place?" — what we charge, what
 * verification actually checks, what happens when an order goes wrong, who
 * decides platform matters, and how the vendor progression works.
 *
 * These previously existed only in the footer. That is a reasonable home for
 * policy pages, but it makes them findable only by someone who already went
 * looking, which is the opposite of what a trust signal is for.
 */
const TRUST_LINKS = [
  { href: '/transparency', icon: '💸', label: 'What We Charge' },
  { href: '/verification', icon: '✅', label: 'How Verification Works' },
  { href: '/buyer-protection', icon: '🛟', label: 'Buyer Protection' },
  { href: '/governance', icon: '🗳️', label: 'How Governance Works' },
  { href: '/karma', icon: '🌱', label: 'The KARMA Ladder' },
  { href: '/quests', icon: '🧭', label: 'Readiness Quests' },
]

export const MobileNavbar = ({
  childrenCategories,
  parentCategories,
  cmsTypes,
}: {
  childrenCategories: HttpTypes.StoreProductCategory[];
  parentCategories: HttpTypes.StoreProductCategory[];
  cmsTypes?: CmsType[];
}) => {
  const [openMenu, setOpenMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const router = useRouter();

  const closeMenuHandler = () => {
    setOpenMenu(false);
    setExpandedType(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/categories?query=${encodeURIComponent(searchQuery)}`);
      closeMenuHandler();
    }
  };

  const toggleType = (typeId: string) => {
    setExpandedType(expandedType === typeId ? null : typeId);
  };

  const hasCmsTypes = cmsTypes && cmsTypes.length > 0;

  return (
    <div className='lg:hidden'>
      <button
        onClick={() => setOpenMenu(true)}
        aria-label="Open navigation menu"
        className="p-1"
      >
        <HamburgerMenuIcon />
      </button>
      {openMenu && (
        <div className='fixed w-full h-full bg-primary p-4 top-0 left-0 z-50 overflow-y-auto'>
          <div className='flex justify-between items-center mb-4'>
            <span className="font-semibold text-lg">Menu</span>
            <button
              onClick={() => closeMenuHandler()}
              aria-label="Close navigation menu"
              className="p-1"
            >
              <CloseIcon size={24} />
            </button>
          </div>

          {/* Vendor CTA Banner */}
          <a
            href={VENDOR_PANEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenuHandler}
            className="flex items-center justify-between mb-4 p-4 bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            <div className="flex flex-col">
              <span className="font-bold text-base">Join the Market</span>
              <span className="text-green-200 text-xs">Become a community provider</span>
            </div>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className='mb-4'>
            <div className='relative'>
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </form>

          {/* Quick Links */}
          <div className='border rounded-lg mb-4 p-4'>
            <div className='flex flex-col gap-3'>
              <LocalizedClientLink
                href="/categories"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🛒</span> Shop All Products
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/producers"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">👨‍🌾</span> Our Producers
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/vendors"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🏪</span> All Vendors
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/collective/demand-pools"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🤝</span> Collective Buys
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/community-resources"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🫶</span> Community Resources
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/collections"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">📦</span> Collections
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/vendor-types"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">📋</span> Vendor Types & Features
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/what-you-sell"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🧭</span> What Are You Selling?
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/feature-matrix"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">📊</span> Feature Matrix
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/beyond-selling"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🏗️</span> Beyond Selling
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/why-we-exist"
                onClick={closeMenuHandler}
                className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
              >
                <span className="text-lg">🌍</span> Why We Exist
              </LocalizedClientLink>
              <LocalizedClientLink
                href="/sell"
                onClick={closeMenuHandler}
                className="font-medium text-green-700 hover:text-green-800 flex items-center gap-2"
              >
                <span className="text-lg">✨</span> Learn About Joining
              </LocalizedClientLink>
            </div>
          </div>

          {/*
            Grouped rather than appended to Quick Links above: these answer
            "can I trust this place?" rather than "where do I shop?", and six
            more entries on the end of a twelve-item list would bury them.
          */}
          <div className='border rounded-lg mb-4 p-4'>
            <p className='text-xs uppercase tracking-wide text-secondary mb-3'>
              Trust &amp; transparency
            </p>
            <div className='flex flex-col gap-3'>
              {TRUST_LINKS.map((link) => (
                <LocalizedClientLink
                  key={link.href}
                  href={link.href}
                  onClick={closeMenuHandler}
                  className="font-medium text-primary hover:text-green-700 flex items-center gap-2"
                >
                  <span className="text-lg">{link.icon}</span> {link.label}
                </LocalizedClientLink>
              ))}
            </div>
          </div>

          {/* CMS Type-Based Navigation */}
          {hasCmsTypes ? (
            <div className='border rounded-lg'>
              <div className='p-3 border-b bg-gray-50'>
                <span className='text-sm font-medium text-gray-600 uppercase tracking-wide'>Browse by Category</span>
              </div>
              <div className='divide-y'>
                {cmsTypes
                  .filter(type => type.is_active)
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((type) => (
                    <div key={type.id} className=''>
                      {/* Type Header */}
                      <button
                        onClick={() => toggleType(type.id)}
                        className='w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors'
                      >
                        <span className='flex items-center gap-3'>
                          {type.icon && <span className='text-xl'>{type.icon}</span>}
                          <span className='font-medium'>{type.name}</span>
                        </span>
                        <CollapseIcon
                          size={18}
                          className={cn(
                            'transition-transform text-gray-400',
                            expandedType === type.id ? 'rotate-180' : ''
                          )}
                        />
                      </button>

                      {/* Expanded Categories */}
                      {expandedType === type.id && type.categories && (
                        <div className='bg-gray-50 border-t'>
                          {/* View All Link */}
                          <LocalizedClientLink
                            href={`/categories?type=${type.handle}`}
                            onClick={closeMenuHandler}
                            className='block px-4 py-3 text-sm font-medium text-green-700 hover:bg-gray-100 border-b border-gray-200'
                          >
                            View All {type.name} →
                          </LocalizedClientLink>

                          {/* Category Links */}
                          {type.categories
                            .filter((cat: CmsCategory) => cat.is_active)
                            .sort((a: CmsCategory, b: CmsCategory) => a.display_order - b.display_order)
                            .map((category: CmsCategory) => (
                              <LocalizedClientLink
                                key={category.id}
                                href={`/categories?category=${category.handle}`}
                                onClick={closeMenuHandler}
                                className='block px-4 py-3 text-sm hover:bg-gray-100 transition-colors'
                              >
                                <span className='flex items-center gap-2 pl-4'>
                                  {category.icon && <span className='text-base'>{category.icon}</span>}
                                  {category.name}
                                </span>
                              </LocalizedClientLink>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            // Fallback to legacy categories
            <div className='border rounded-sm'>
              <div className='p-3 border-b'>
                <span className='text-sm font-medium text-gray-500 uppercase'>Categories</span>
              </div>
              <HeaderCategoryNavbar
                onClose={closeMenuHandler}
                categories={parentCategories}
              />
              <div className='border-t pt-2'>
                <CategoryNavbar
                  onClose={closeMenuHandler}
                  categories={childrenCategories}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
