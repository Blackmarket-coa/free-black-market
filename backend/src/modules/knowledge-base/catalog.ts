/**
 * Knowledge Base seed catalog (§14). Code is the source of truth; seeded into
 * `kb_article` at boot via `backend/src/scripts/seed-knowledge-base.ts`.
 * Mirrors the playbook/startup-guide recipe-catalog convention.
 *
 * `filterArticles` is a pure, unit-tested helper the store route delegates to.
 */

export type KbType = "DIY" | "CONTAINER_GARDENING" | "SUBSTITUTION"

export type KbSeedArticle = {
  slug: string
  title: string
  type: KbType
  summary: string
  body: string
  category: string
  difficulty: "Beginner" | "Intermediate" | "Advanced"
  climate_zone?: string
  space?: string
  materials: string[]
  steps: string[]
  /** opportunity subject key this guide relates to, for cross-linking. */
  related_opportunity_key?: string
}

const DIY: KbSeedArticle[] = [
  {
    slug: "diy-laundry-detergent",
    title: "Make Your Own Laundry Detergent",
    type: "DIY",
    summary:
      "A low-cost powdered laundry detergent from three pantry-grade ingredients.",
    body:
      "Homemade laundry powder cleans well for a fraction of the retail cost and avoids single-use plastic jugs.",
    category: "home-goods",
    difficulty: "Beginner",
    materials: [
      "1 bar castile or laundry soap, grated",
      "1 cup washing soda",
      "1 cup borax (optional)",
    ],
    steps: [
      "Grate the soap finely.",
      "Mix with washing soda (and borax if using).",
      "Use 1–2 tablespoons per load; store airtight.",
    ],
    related_opportunity_key: "home-goods",
  },
  {
    slug: "diy-compost-at-home",
    title: "Start a Home Compost Pile",
    type: "DIY",
    summary: "Turn kitchen and yard waste into finished compost in 8–12 weeks.",
    body:
      "Composting recycles nutrients back into soil and is the production basis of a compost micro-business.",
    category: "agriculture",
    difficulty: "Beginner",
    materials: [
      "Browns (leaves, cardboard)",
      "Greens (food scraps, grass)",
      "A bin or open pile, ~1 cubic yard",
    ],
    steps: [
      "Layer browns and greens roughly 2:1.",
      "Keep moist as a wrung-out sponge and turn weekly.",
      "Harvest when dark, crumbly, and earthy-smelling.",
    ],
    related_opportunity_key: "agriculture",
  },
  {
    slug: "diy-seed-starting",
    title: "Seed Starting Indoors",
    type: "DIY",
    summary: "Grow strong transplants from seed weeks before the last frost.",
    body:
      "Starting seeds indoors extends the season and is the basis of a seedling business.",
    category: "gardening",
    difficulty: "Beginner",
    materials: [
      "Seed trays + humidity dome",
      "Seed-starting mix",
      "Grow light or bright window",
    ],
    steps: [
      "Sow at the depth on the packet and keep warm.",
      "Provide 14–16 hours of light once sprouted.",
      "Harden off outdoors before transplanting.",
    ],
    related_opportunity_key: "gardening",
  },
  {
    slug: "diy-food-preservation",
    title: "Food Preservation Basics",
    type: "DIY",
    summary: "Water-bath canning, freezing, and drying to store the harvest.",
    body:
      "Preserving the harvest reduces waste and creates shelf-stable products to sell.",
    category: "food",
    difficulty: "Intermediate",
    materials: [
      "Canning jars + lids",
      "Water-bath canner",
      "Acid (lemon juice/vinegar) for high-acid recipes",
    ],
    steps: [
      "Follow a tested recipe for acidity and times.",
      "Process jars fully submerged in boiling water.",
      "Check seals after 24 hours; refrigerate any that failed.",
    ],
    related_opportunity_key: "food",
  },
]

const CONTAINER_GARDENING: KbSeedArticle[] = [
  {
    slug: "container-gardening-cool-balcony",
    title: "Container Gardening: Cool Climate, Small Balcony",
    type: "CONTAINER_GARDENING",
    summary: "Cold-tolerant crops for a compact, partly-shaded balcony.",
    body: "Greens and roots thrive in cool climates and tight spaces.",
    category: "gardening",
    difficulty: "Beginner",
    climate_zone: "cool",
    space: "balcony",
    materials: ["3–5 gallon pots", "Quality potting mix", "Lettuce, kale, radish seed"],
    steps: [
      "Choose 3–5 gallon containers with drainage.",
      "Sow cool-season greens and roots.",
      "Water consistently; harvest outer leaves.",
    ],
    related_opportunity_key: "gardening",
  },
  {
    slug: "container-gardening-warm-patio",
    title: "Container Gardening: Warm Climate, Patio",
    type: "CONTAINER_GARDENING",
    summary: "Heat-loving fruiting crops for a sunny patio.",
    body: "Tomatoes and peppers reward warm climates and full-sun patios.",
    category: "gardening",
    difficulty: "Intermediate",
    climate_zone: "warm",
    space: "patio",
    materials: ["7–10 gallon pots", "Tomato/pepper transplants", "Stakes or cages"],
    steps: [
      "Use large containers for fruiting crops.",
      "Provide 6+ hours of sun and support.",
      "Feed every 2 weeks during fruiting.",
    ],
    related_opportunity_key: "gardening",
  },
]

const SUBSTITUTION: KbSeedArticle[] = [
  {
    slug: "make-vs-buy-cleaning-supplies",
    title: "Make vs. Buy: Household Cleaners",
    type: "SUBSTITUTION",
    summary: "When making your own cleaners beats buying — and when it doesn't.",
    body:
      "Vinegar, baking soda, and castile soap replace most general cleaners cheaply.",
    category: "home-goods",
    difficulty: "Beginner",
    materials: ["White vinegar", "Baking soda", "Castile soap"],
    steps: [
      "Make: all-purpose, glass, and scouring cleaners.",
      "Buy: disinfectants that need EPA registration.",
      "Compare cost-per-use before switching.",
    ],
    related_opportunity_key: "home-goods",
  },
  {
    slug: "upcycling-containers-for-growing",
    title: "Upcycle Containers for Growing",
    type: "SUBSTITUTION",
    summary: "Turn buckets, totes, and jugs into productive planters.",
    body: "Reusing containers cuts startup cost for a gardening business.",
    category: "gardening",
    difficulty: "Beginner",
    materials: ["Food-safe buckets/totes", "Drill for drainage", "Potting mix"],
    steps: [
      "Drill drainage holes in the base.",
      "Avoid containers that held chemicals.",
      "Match container size to crop root depth.",
    ],
    related_opportunity_key: "gardening",
  },
]

export const KB_SEED_ARTICLES: KbSeedArticle[] = [
  ...DIY,
  ...CONTAINER_GARDENING,
  ...SUBSTITUTION,
]

export type KbFilter = {
  type?: string
  category?: string
  difficulty?: string
  climate_zone?: string
  space?: string
  q?: string
}

/** Pure filter over an article list (works on seed shape or DB rows). */
export function filterArticles<
  T extends {
    type: string
    category?: string | null
    difficulty?: string | null
    climate_zone?: string | null
    space?: string | null
    title: string
    summary?: string
  }
>(articles: T[], filter: KbFilter): T[] {
  const eq = (a?: string | null, b?: string) =>
    !b || (a ?? "").toLowerCase() === b.toLowerCase()
  const q = (filter.q || "").trim().toLowerCase()
  return articles.filter(
    (a) =>
      eq(a.type, filter.type) &&
      eq(a.category, filter.category) &&
      eq(a.difficulty, filter.difficulty) &&
      eq(a.climate_zone, filter.climate_zone) &&
      eq(a.space, filter.space) &&
      (!q ||
        a.title.toLowerCase().includes(q) ||
        (a.summary ?? "").toLowerCase().includes(q))
  )
}
