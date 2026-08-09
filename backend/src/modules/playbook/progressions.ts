/**
 * Playbook progressions — the edges between playbooks.
 *
 * A playbook describes what a vendor is *now*. Several of them are rungs on the
 * same ladder: a home cook selling under a cottage-food permit rents time in a
 * shared commissary to get past their annual cap, and eventually holds the lease
 * on their own kitchen. Same person, three playbooks, in order. Until this file
 * the set was flat — no ordering, no `from`/`to`, nothing that said one playbook
 * is where people commonly go from another.
 *
 * Four engines drive movement, each a different ceiling:
 *
 * - `facility`   — where you're allowed to produce. Permit class plus the
 *                  capital for a licensed space. Home kitchen → commissary →
 *                  own lease; kitchen table → shared studio → own shop.
 * - `governance` — how many of you there are and how you decide. Already latent
 *                  in `member_model` (`solo → flat → sociocratic →
 *                  multi_stakeholder → federation`) and in `SIMPLICITY_RANK`,
 *                  which the picker uses to choose a *default* rather than to
 *                  describe a *path*.
 * - `land`       — what ground you have. Borrowed plot → own ground with
 *                  subscribers → aggregating other growers.
 * - `audience`   — what you have to offer. An audience, a skill, or a box of
 *                  finished goods becoming a catalog.
 *
 * Every ladder ends the same way: the graduate becomes the host. The cook who
 * rented a commissary opens one; the plot-holder becomes a food hub; the solo
 * maker's shared studio becomes a shop others join. `hub` is not a separate
 * species, it is the top rung of all four.
 *
 * ## This describes, it does not prescribe
 *
 * `docs/PLAYBOOK_SYSTEM.md` calls the playbook system "the firewall that
 * prevents solo sellers from being conscripted into cooperation they did not ask
 * for." Nothing here may become a nag. A Stall that stays a Stall forever is a
 * success, not a stalled funnel. These edges exist so a vendor who goes looking
 * finds an honest map — including what a move would *cost* them, which is why
 * `listingTypesLost` is computed and surfaced alongside the gains.
 *
 * See `docs/VENDOR_PROGRESSIONS.md` for the full table and reasoning.
 */

import { PLAYBOOK_RECIPES, getRecipe } from "./recipes"
import type {
  PlaybookId,
  ListingTypeId,
  PlaybookFeatureDefaults,
} from "./recipes"

/**
 * Whether the move replaces the vendor's social form or adds to it.
 *
 * `add_role` is already supported end-to-end: multi-role assignment unions each
 * role's default feature keys into `seller_metadata.enabled_extensions`. A
 * Creator who starts selling merch does not stop being a Creator.
 */
export type ProgressionKind = "replace" | "add_role"

export type ProgressionEngine = "facility" | "governance" | "land" | "audience"

export const PROGRESSION_ENGINES: ProgressionEngine[] = [
  "facility",
  "governance",
  "land",
  "audience",
]

/** Vendor-facing label for each engine. */
export const ENGINE_LABELS: Record<ProgressionEngine, string> = {
  facility: "Where you make it",
  governance: "How many of you there are",
  land: "What ground you have",
  audience: "What you offer",
}

export type ProgressionEdge = {
  from: PlaybookId
  to: PlaybookId
  kind: ProgressionKind
  /** An edge can sit on more than one engine (sharing a studio is both). */
  engines: ProgressionEngine[]
  /** One sentence, vendor-facing, describing the move in real-world terms. */
  headline: string
  /** The limit that motivates the move — why anyone would bother. */
  ceiling: string
  /**
   * What has to be arranged off-platform first. FBM asserts no legal facts
   * here (same stance as the cottage-food module): these are plain-language
   * reminders, not a compliance checklist and not a gate.
   */
  real_world_prerequisites: string[]
  /**
   * An existing vendor-quest that assembles documentation for this step, when
   * one fits. Quests are opt-in and never a prerequisite for selling — this is
   * a pointer, not an enrollment.
   */
  quest_key?: string
}

/**
 * The edge set.
 *
 * Ordered by engine, then roughly by how early in a vendor's life the move
 * tends to come up. Keep this in sync with the table in
 * `docs/VENDOR_PROGRESSIONS.md` — `__tests__/progressions.unit.spec.ts` asserts
 * the counts match.
 */
export const PROGRESSION_EDGES: ProgressionEdge[] = [
  // ---- facility: where you're allowed to produce -----------------------
  {
    from: "stall",
    to: "kitchen",
    kind: "replace",
    engines: ["facility"],
    headline:
      "Move production out of your home kitchen and into a licensed one — rented by the hour at a commissary, or your own lease.",
    ceiling:
      "Cottage-food permits cap what you can sell in a year, and often how many meals you can make in a day or a week. A licensed kitchen replaces that cap with a health-department license.",
    real_world_prerequisites: [
      "A commissary agreement, kitchen-incubator membership, or lease",
      "Health-department license for the facility",
      "Food handler certification current for everyone cooking",
    ],
    quest_key: "compliance-tracker",
  },
  {
    from: "kitchen",
    to: "hub",
    kind: "add_role",
    engines: ["facility", "governance"],
    headline:
      "Rent your idle kitchen hours to other cooks — become the commissary you once cooked in.",
    ceiling:
      "A kitchen is empty most of the day. Hosting other cooks turns those hours into income without adding a single menu item.",
    real_world_prerequisites: [
      "Facility insurance that covers third-party users",
      "A written station-use agreement and schedule",
      "Health-department sign-off for shared use",
    ],
  },
  {
    from: "cycle",
    to: "kitchen",
    kind: "add_role",
    engines: ["facility"],
    headline:
      "Turn what doesn't sell fresh into something that keeps — preserves, sauces, cut-and-frozen shares.",
    ceiling:
      "A harvest glut is a loss on a fresh-only catalog. Value-added products move the surplus and extend the season past the field.",
    real_world_prerequisites: [
      "Access to a licensed processing kitchen",
      "Process approval or recipe review where your state requires it",
      "Labels that meet packaged-food requirements",
    ],
    quest_key: "compliance-tracker",
  },

  // ---- governance: how many of you, and how you decide -----------------
  {
    from: "stall",
    to: "atelier",
    kind: "replace",
    engines: ["governance", "facility"],
    headline:
      "You're not working alone anymore — a few of you share a table, a kiln, or a brand.",
    ceiling:
      "One person's output has a hard ceiling, and a shared space costs more than one person's sales justify. Splitting both is the move.",
    real_world_prerequisites: [
      "An understanding of how work and money get split",
      "A shared space, if the group needs one",
    ],
  },
  {
    from: "atelier",
    to: "workshop",
    kind: "replace",
    engines: ["governance"],
    headline:
      "The crew owns the shop together — decisions in circles, surplus returned to members as patronage.",
    ceiling:
      "Flat consensus stops scaling somewhere around a dozen people. Worker ownership gives structure to what was informal.",
    real_world_prerequisites: [
      "Incorporation as a cooperative",
      "Bylaws and a member agreement",
      "A patronage policy",
    ],
    quest_key: "coop-formation",
  },
  {
    from: "atelier",
    to: "commons",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Open ownership beyond the people doing the work — producers, workers, buyers, and supporters each hold a stake.",
    ceiling:
      "Some projects are held by a community rather than a crew. Multi-stakeholder membership is how that gets written down.",
    real_world_prerequisites: [
      "Incorporation with multiple membership classes",
      "Bylaws defining each class and its representation",
      "An elected board or council",
    ],
    quest_key: "coop-formation",
  },
  {
    from: "workshop",
    to: "commons",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Bring buyers and supporters into ownership alongside the workers.",
    ceiling:
      "A worker co-op answers to the people inside it. A multi-stakeholder co-op answers to everyone who depends on it.",
    real_world_prerequisites: [
      "Amended bylaws adding membership classes",
      "A member vote to restructure",
      "Representation for each new class",
    ],
    quest_key: "coop-formation",
  },
  {
    from: "workshop",
    to: "hub",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Aggregate other vendors' catalogs alongside your own and sell as one storefront.",
    ceiling:
      "Buyers want a full shelf, and no single shop fills one. Federating is how small producers reach accounts none of them could hold alone.",
    real_world_prerequisites: [
      "Agreements with each participating vendor",
      "A split and payout policy everyone has seen",
    ],
    quest_key: "wholesale-account",
  },
  {
    from: "commons",
    to: "hub",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Become the federation other co-ops route through.",
    ceiling:
      "Once several co-ops are coordinating anyway, a hub makes the coordination legible instead of ad hoc.",
    real_world_prerequisites: [
      "A federation council or equivalent",
      "Inter-cooperative agreements",
    ],
  },
  {
    from: "grove",
    to: "commons",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Turn a mutual-aid network into a community-owned institution — a food co-op, a grocery, a café.",
    ceiling:
      "Volunteer energy is not a structure. Ownership is what lets a network outlive the people who started it.",
    real_world_prerequisites: [
      "Incorporation with membership classes",
      "Bylaws and an elected board",
      "A capitalization plan (member shares, loans, or grants)",
    ],
    quest_key: "coop-formation",
  },
  {
    from: "grove",
    to: "hub",
    kind: "replace",
    engines: ["governance"],
    headline:
      "Coordinate distribution for other pantries, fridges, and free stores.",
    ceiling:
      "Several nodes moving the same goods separately duplicate every route and every relationship.",
    real_world_prerequisites: [
      "Agreements with participating nodes",
      "Shared intake and routing practice",
    ],
  },
  {
    from: "service",
    to: "workshop",
    kind: "replace",
    engines: ["governance"],
    headline:
      "The practice becomes worker-owned — a repair co-op, a cleaning co-op, a collectively run clinic.",
    ceiling:
      "Practitioners working side by side without ownership are employees of whoever holds the lease. Worker ownership changes who the surplus belongs to.",
    real_world_prerequisites: [
      "Incorporation as a cooperative",
      "Bylaws and a member agreement",
      "Professional licensure and insurance for the entity, where the trade requires it",
    ],
    quest_key: "coop-formation",
  },

  // ---- land: what ground you have --------------------------------------
  {
    from: "harvest",
    to: "stall",
    kind: "replace",
    engines: ["land"],
    headline:
      "Sell your own surplus under your own name, rather than pooling it with the garden's.",
    ceiling:
      "A collective harvest shares everything. Growers who want their own customers and their own prices need their own storefront.",
    real_world_prerequisites: [
      "Clarity with the garden about what is yours to sell",
    ],
  },
  {
    from: "harvest",
    to: "cycle",
    kind: "replace",
    engines: ["land"],
    headline:
      "Ground of your own and members who subscribe to the season — a CSA rather than a shared plot.",
    ceiling:
      "An allotment gives you rows, not a business. Secure tenure plus subscribers turns growing into predictable income.",
    real_world_prerequisites: [
      "A lease, purchase, or long-term land agreement",
      "Water access and any required agricultural registration",
      "Season planning you can commit to in advance",
    ],
    quest_key: "land-pooling",
  },
  {
    from: "harvest",
    to: "grove",
    kind: "replace",
    engines: ["land", "audience"],
    headline:
      "The point becomes distribution on solidarity terms — a gleaning network, a community fridge, a free store.",
    ceiling:
      "Some gardens are growing to feed people, not to sell. Sliding scale and volunteer coordination fit that better than a price list.",
    real_world_prerequisites: [
      "A volunteer roster and intake practice",
      "A fiscal sponsor if you intend to take donations",
    ],
  },
  {
    from: "harvest",
    to: "workshop",
    kind: "replace",
    engines: ["land", "governance"],
    headline:
      "The people tending the land own the operation together.",
    ceiling:
      "A garden run by a crew doing the work, with no say in what happens to the proceeds, is a job. Worker ownership is the alternative.",
    real_world_prerequisites: [
      "Incorporation as a cooperative",
      "Bylaws and a member agreement",
      "A land agreement that survives the change of entity",
    ],
    quest_key: "coop-formation",
  },
  {
    from: "cycle",
    to: "hub",
    kind: "replace",
    engines: ["land", "governance"],
    headline:
      "Aggregate other farms into your shares and routes — a food hub or a multi-farm CSA.",
    ceiling:
      "One farm cannot fill a diverse box every week of the season. Aggregating other growers can, and gives them an account they could not hold alone.",
    real_world_prerequisites: [
      "Agreements with participating farms",
      "Aggregation and cold-chain capacity",
      "A payout split every farm has seen",
    ],
    quest_key: "wholesale-account",
  },

  // ---- audience: what you have to offer --------------------------------
  {
    from: "creator",
    to: "stall",
    kind: "add_role",
    engines: ["audience"],
    headline:
      "Put physical things in front of the audience you already have — merch, prints, pressings.",
    ceiling:
      "Digital sales and memberships have a ceiling set by audience size. Physical goods raise the amount each listener can spend.",
    real_world_prerequisites: [
      "Somewhere to store and ship stock, or a print-on-demand arrangement",
    ],
  },
  {
    from: "creator",
    to: "atelier",
    kind: "replace",
    engines: ["audience", "governance"],
    headline:
      "The work is a group's now — a recording collective, a zine collective, a studio.",
    ceiling:
      "Splitting revenue by hand across collaborators stops working quickly. Multi-member payouts and a shared catalog do it properly.",
    real_world_prerequisites: [
      "An agreement on how credit and money are split",
    ],
  },
  {
    from: "stall",
    to: "creator",
    kind: "add_role",
    engines: ["audience"],
    headline:
      "The people who follow your work will pay for the work itself — memberships, drops, subscriptions.",
    ceiling:
      "Selling only finished goods leaves the audience unmonetized between releases.",
    real_world_prerequisites: [],
  },
  {
    from: "stall",
    to: "service",
    kind: "add_role",
    engines: ["audience"],
    headline:
      "Sell your time as well as your output — lessons, repairs, commissions, consults.",
    ceiling:
      "Making things is capped by how fast you can make them. Booked time is not.",
    real_world_prerequisites: [
      "Licensure and insurance where the trade requires it",
    ],
  },
  {
    from: "service",
    to: "atelier",
    kind: "replace",
    engines: ["audience", "governance"],
    headline:
      "A few practitioners share a space and a calendar — a group practice.",
    ceiling:
      "A solo practitioner covers rent alone and has no cover when they are sick or away.",
    real_world_prerequisites: [
      "A shared space or shared booking arrangement",
      "An agreement on how the space and income are split",
    ],
  },
  {
    from: "service",
    to: "grove",
    kind: "replace",
    engines: ["audience"],
    headline:
      "Offer the practice on solidarity terms — a repair café, a sliding-scale clinic, a skill share.",
    ceiling:
      "Fixed rates turn away the people who most need the service. Sliding scale and volunteer capacity are how that gets addressed.",
    real_world_prerequisites: [
      "A volunteer roster, if others will help deliver it",
      "A fiscal sponsor if you intend to take donations",
    ],
  },
]

/**
 * Playbooks with no outbound edges — where a ladder ends rather than an
 * oversight. Asserted by the drift-guard test so a newly added playbook cannot
 * silently sit unreachable and unremarked.
 *
 * `hub` is the terminal rung of every engine: aggregating other vendors is the
 * last move, whatever you started as.
 */
export const TERMINAL_PLAYBOOKS: PlaybookId[] = ["hub"]

/** Every edge leaving a playbook. */
export const progressionsFrom = (id: PlaybookId): ProgressionEdge[] =>
  PROGRESSION_EDGES.filter((e) => e.from === id)

/** Every edge arriving at a playbook. */
export const progressionsTo = (id: PlaybookId): ProgressionEdge[] =>
  PROGRESSION_EDGES.filter((e) => e.to === id)

export const findEdge = (
  from: PlaybookId,
  to: PlaybookId
): ProgressionEdge | undefined =>
  PROGRESSION_EDGES.find((e) => e.from === from && e.to === to)

/** Whether a given move is a declared progression rather than an arbitrary switch. */
export const isProgression = (from: PlaybookId, to: PlaybookId): boolean =>
  Boolean(findEdge(from, to))

export type ProgressionDiff = {
  /** Feature keys the target enables that the source does not. */
  featuresGained: Array<keyof PlaybookFeatureDefaults>
  /** Feature keys the source enables that the target does not. */
  featuresLost: Array<keyof PlaybookFeatureDefaults>
  listingTypesGained: ListingTypeId[]
  listingTypesLost: ListingTypeId[]
  /** Commission delta in absolute rate terms; negative means cheaper. */
  commissionDelta: number
}

const enabledFeatureKeys = (
  defaults: PlaybookFeatureDefaults
): Array<keyof PlaybookFeatureDefaults> =>
  (Object.keys(defaults) as Array<keyof PlaybookFeatureDefaults>).filter(
    (k) => defaults[k] === true
  )

/**
 * What a move gains and costs, derived from the recipes rather than restated.
 *
 * The losses matter as much as the gains and are the reason this is computed:
 * Stall allows `digital`, `unique_inventory`, and `campaign` listings and
 * Kitchen does not, so a home baker moving to a commissary needs to know their
 * digital listings no longer fit the playbook. A surface that showed only gains
 * would be an upsell, not a map.
 *
 * Note this describes the *playbook defaults*. A vendor can opt into features
 * their playbook doesn't enable by default, and existing products are never
 * retroactively invalidated — allowed-listing-types is enforced on write, not
 * on read (see `shared/listing-type-guard.ts`).
 */
export const diffPlaybooks = (
  from: PlaybookId,
  to: PlaybookId
): ProgressionDiff => {
  const a = getRecipe(from)
  const b = getRecipe(to)

  const aFeatures = enabledFeatureKeys(a.default_features)
  const bFeatures = enabledFeatureKeys(b.default_features)

  const aListings = a.allowed_listing_types
  const bListings = b.allowed_listing_types

  return {
    featuresGained: bFeatures.filter((k) => !aFeatures.includes(k)),
    featuresLost: aFeatures.filter((k) => !bFeatures.includes(k)),
    listingTypesGained: bListings.filter((t) => !aListings.includes(t)),
    listingTypesLost: aListings.filter((t) => !bListings.includes(t)),
    commissionDelta: b.commission_rate - a.commission_rate,
  }
}

/**
 * An edge plus its computed diff and the target's display copy — the shape the
 * vendor-facing API returns, so no surface has to re-derive any of it.
 */
export type ResolvedProgression = ProgressionEdge & {
  to_display_name: string
  to_social_form: string
  to_member_model: string
  diff: ProgressionDiff
}

export const resolveProgression = (
  edge: ProgressionEdge
): ResolvedProgression => {
  const target = getRecipe(edge.to)
  return {
    ...edge,
    to_display_name: target.display_name,
    to_social_form: target.social_form,
    to_member_model: target.member_model,
    diff: diffPlaybooks(edge.from, edge.to),
  }
}

/** Resolved outbound edges for a playbook, ready to render. */
export const resolveProgressionsFrom = (
  id: PlaybookId
): ResolvedProgression[] => progressionsFrom(id).map(resolveProgression)

/**
 * Outbound edges grouped by engine, skipping engines with no edges.
 * An edge on two engines appears under both — that is the point of the
 * grouping, not a bug to dedupe away.
 */
export const groupByEngine = (
  edges: ResolvedProgression[]
): Array<{ engine: ProgressionEngine; label: string; edges: ResolvedProgression[] }> =>
  PROGRESSION_ENGINES.map((engine) => ({
    engine,
    label: ENGINE_LABELS[engine],
    edges: edges.filter((e) => e.engines.includes(engine)),
  })).filter((g) => g.edges.length > 0)

/**
 * Short "commonly leads to" summary for a playbook — the target display names,
 * deduped and in edge order. Used by the public vendor-types page, where the
 * full card would be too much.
 */
export const commonlyLeadsTo = (id: PlaybookId): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const edge of progressionsFrom(id)) {
    const name = PLAYBOOK_RECIPES[edge.to].display_name
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
