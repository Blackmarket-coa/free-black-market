"use client"

import { useTransition } from "react"
import { Button } from "@/components/atoms"
import { PublicStorefront, selectStorefrontContext } from "@/lib/data/donations"

export default function StorefrontSwitcher({ storefronts }: { storefronts: PublicStorefront[] }) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="w-full mb-6 border rounded-sm p-4 bg-white">
      <h3 className="font-semibold mb-2">Storefront context</h3>
      <p className="text-sm text-gray-600 mb-3">Switch storefront context. Donation features are tier-gated per storefront.</p>
      <div className="space-y-2">
        {storefronts.map((s) => (
          <div key={s.id} className="flex items-center justify-between border rounded px-3 py-2">
            <div className="text-sm">{s.name} <span className="text-xs text-gray-500">({s.tier})</span></div>
            <Button
              size="small"
              loading={isPending}
              onClick={() => startTransition(async () => {
                await selectStorefrontContext({ organization_id: s.organization_id, storefront_id: s.id })
                window.location.reload()
              })}
            >
              Use
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
