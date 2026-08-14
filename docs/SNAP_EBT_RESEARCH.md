# SNAP/EBT acceptance — research track (Move 4)

What it would take for FBM's food surfaces to accept SNAP benefits, what is
and is not allowed, and the recommended sequence. Research brief — no code
changes ride with this document. Facts below are cited to their sources;
FBM-specific mappings are analysis, marked as such.

**Bottom line:** the shortest credible path is a single authorized
direct-marketing entity (the Move 3 pilot's SC nursery is the natural
candidate) accepting EBT at physical point of sale with free federal
equipment, selling exactly the catalog FBM already grows — seeds and
food-producing plants are SNAP-eligible. Online SNAP through the platform
is a real but much heavier second step: separate federal authorization,
one of three approved payment processors, online PIN entry, and split
tender. Nothing about SNAP touches the CCR ledger — benefits are federal
money and must stay on the cash rails end to end.

## 1. The regulatory shape

- **Authorization first.** No one may accept EBT until authorized by
  USDA FNS and issued a SNAP permit. The application is free and online;
  it names at least one responsible official (with SSN), and decisions
  come in ~45 days.
- **Free EBT equipment for exactly our kind of entity.** Farmers markets,
  direct-marketing farmers, and non-profit food-buying cooperatives
  qualify for free EBT equipment and transaction services. Everyone else
  buys their own.
- **Eligible items include the plant catalog.** SNAP covers food for
  human consumption *and* seeds and plants that produce food — vegetable
  and herb seeds/starts, fruit trees, berry bushes, edible bulbs.
  Excluded: ornamental/decorative plants, anything toxic, and all
  gardening inputs (soil, fertilizer, tools). Prepared hot food is also
  excluded (standard SNAP rule).
- **New stocking rule with a live deadline.** A May 2026 final rule
  tightens the staple-food stocking standards SNAP retailers must meet;
  compliance is required from **November 4, 2026**. Any authorization
  plan has to be evaluated against the new standards, not the old ones.
- **Online SNAP is a second, separate authorization** on top of retailer
  authorization, with concrete platform requirements:
  - EBT payments must flow through an approved third-party processor —
    currently **Fiserv, Worldpay, or Forage** — with secure *online PIN
    entry* integrated via the processor's API.
  - The platform must support SNAP-specific refunds, error messaging,
    and variable/estimated item pricing.
  - **Split tender is mandatory in practice**: SNAP pays only for
    eligible food. Delivery fees, service fees, taxes, and ineligible
    items must be charged to a second payment method.
- **Incentive matching exists and is permanently funded.** GusNIP (Farm
  Bill) funds dollar-for-dollar fruit/vegetable matches — Double Up Food
  Bucks and equivalents — active in 25+ states, typically operated by
  regional nonprofits (e.g. Fair Food Network), often seasonally at
  farmers markets.

## 2. Mapping to FBM (analysis)

**Who is the "retailer"?** SNAP authorizes *entities*, not software.
Three plausible shapes, in ascending order of difficulty:

1. **A direct-marketing farmer or nursery** (the Move 3 pilot's SC
   nursery): applies on its own, gets free EBT equipment, accepts EBT at
   physical point of sale. FBM's role is catalog/inventory/ops tooling —
   no FBM entity touches the benefit transaction. Weeks, not quarters.
2. **A coalition/market operator** (the farmers-market model): one
   FBM-coalition entity holds the permit and operates a scrip/token
   system at markets the way farmers markets do today. Requires the
   coalition to be a real legal entity with a responsible official.
3. **FBM as an online SNAP platform**: individual authorized retailers
   sell through FBM checkout with a TPP (Forage is the one built for
   independent/marketplace retailers) handling PIN entry and split
   tender. This is the heavy build: each *seller* still needs its own
   authorization; the platform needs TPP integration, eligible-item
   flagging, SNAP-aware refunds, and fee separation.

**Catalog implications.** The Plant Network is the wedge: nursery and
botanical inventory that produces food is eligible; ornamentals are not.
That means a per-item `snap_eligible` distinction in the catalog long
before any checkout work — it is also what split tender and the
stocking-standards analysis both need. (No code rides with this brief;
this is the first engineering item *if* the track is greenlit.)

**What SNAP must never touch.** Benefits are federal cash. They cannot
buy CCR, fund wallets, route through the hawala ledger's closed-loop
rails, or pay platform fees. Any SNAP flow is USD-rail only, processed by
the TPP, settled to the authorized retailer. The closed-loop posture
(Posture A) is an asset here: CCR's is-not-cash property is what keeps
the two worlds cleanly separable.

**Where CCR *can* meet SNAP: the incentive pattern.** GusNIP-style
matches are run by nonprofits granting *produce-restricted* incentive
value alongside SNAP spending. A coalition nonprofit could operate a
Double-Up-style match at FBM markets — and the match instrument could be
CCR restricted to produce context, which Posture A's purchase-context
enforcement already models. That is a partnership/grants conversation
(regional GusNIP operators, Fair Food Network), not an engineering task,
but it is the strategically interesting join point: federal benefits
bring demand, CCR carries the match, the loop stays closed.

## 3. Open questions (for counsel / the operator)

1. Which legal entity would apply — the pilot nursery alone, or a
   coalition entity? (Determines free-equipment eligibility category.)
2. Do the November 2026 stocking standards fit a plants-and-produce
   catalog, or does authorization need a fuller staple-food inventory?
3. For the online path: does FBM-as-marketplace mean per-seller
   authorization (Amazon/Instacart model) — and is Forage's
   marketplace integration compatible with Medusa's payment
   architecture and our split-tender needs?
4. GusNIP: which regional operator covers South Carolina, and would a
   produce-restricted CCR instrument qualify as an incentive delivery
   mechanism under their grant terms?

## 4. Recommended sequence

1. **Now (ops, zero code):** pilot nursery applies for SNAP retailer
   authorization as a direct-marketing farmer; free EBT equipment;
   physical-POS acceptance for the eligible plant catalog. Unblocks
   learning with near-zero engineering.
2. **With the pilot (small code):** add `snap_eligible` item flagging to
   the catalog so eligibility is data, not folklore — needed by every
   later step and useful immediately for signage/receipts.
3. **Later, evidence-gated (heavy code):** online SNAP via a TPP
   (evaluate Forage first), only once physical acceptance proves demand
   — same "ship the interface, gate the operation" discipline as the
   federation decision.
4. **In parallel (partnership):** open the GusNIP conversation with the
   regional operator about a produce-restricted match at pilot markets.

Sources:
- [FNA: How Do I Apply to Accept SNAP Benefits?](https://www.fna.usda.gov/snap/retailer/apply-to-accept)
- [FNA: Retailer Criteria to Provide Online Purchasing to SNAP Households](https://www.fna.usda.gov/snap/retailer/online/requirements)
- [FNA: Store Eligibility Requirements](https://www.fna.usda.gov/snap/retailer/eligible)
- [USDA press release, 2026-05-07: updated staple food stocking standards](https://www.usda.gov/about-usda/news/press-releases/2026/05/07/usda-requires-snap-authorized-retailers-carry-more-real-food)
- [Farmers Market Legal Toolkit: Becoming an Authorized SNAP Retailer](https://farmersmarketlegaltoolkit.org/snap/legal-topics/becoming-a-retailer/)
- [SDSU Extension: SNAP Benefits for Seed and Plant Purchases](https://extension.sdstate.edu/snap-benefits-seed-and-plant-purchases)
- [Food Revolution Network: Using SNAP to Grow Your Own Food](https://foodrevolution.org/blog/snap-benefits-buy-plants-seeds-with-ebt/)
- [National Grocers Association: SNAP Online FAQ](https://www.nationalgrocers.org/semtac/snap-online/frequently-asked-questions/)
- [IGA: How Forage Tackles SNAP Online for Independents](https://www.iga.com/insights/how-forage-tackles-snap-online-for-independents)
- [Supermarket News: Forage approved as online SNAP EBT payment enabler](https://www.supermarketnews.com/grocery-trends-data/forage-approved-as-online-snap-ebt-payment-enabler)
- [Fair Food Network: Nutrition Incentives](https://fairfoodnetwork.org/what-we-do/nutrition-incentives/)
- [County Health Rankings: Fruit & Vegetable Incentive Programs](https://www.countyhealthrankings.org/strategies-and-solutions/what-works-for-health/strategies/fruit-vegetable-incentive-programs)
