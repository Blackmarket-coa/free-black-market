import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /store/black-market/templates
 * Business templates surface (§16): curated vendor kits, launch kits, and
 * marketing packs. These are delivered as digital products via the existing
 * signed digital-product pipeline; this route is the curated directory.
 * Filter by ?kind=VENDOR_KIT|LAUNCH_KIT|MARKETING_PACK.
 */
const TEMPLATES = [
  {
    slug: "starter-vendor-kit",
    kind: "VENDOR_KIT",
    name: "Starter Vendor Kit",
    description:
      "Profile, policy, and shipping templates to stand up a new shop fast.",
  },
  {
    slug: "product-launch-kit",
    kind: "LAUNCH_KIT",
    name: "Product Launch Kit",
    description:
      "Launch checklist, bounty brief, and creator outreach templates.",
  },
  {
    slug: "seasonal-marketing-pack",
    kind: "MARKETING_PACK",
    name: "Seasonal Marketing Pack",
    description:
      "Social copy, banners, and email templates for a seasonal campaign.",
  },
  {
    slug: "coalition-onboarding-kit",
    kind: "VENDOR_KIT",
    name: "Coalition Onboarding Kit",
    description:
      "Member agreement, revenue-share, and needs-board templates for coalitions.",
  },
]

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { kind } = req.query as Record<string, string>
  const templates = kind
    ? TEMPLATES.filter((t) => t.kind === kind.toUpperCase())
    : TEMPLATES
  return res.status(200).json({ count: templates.length, templates })
}
