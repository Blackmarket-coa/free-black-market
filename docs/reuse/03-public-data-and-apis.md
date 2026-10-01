# Reuse Report — step 0.3, public data and APIs

Researched 2026-10-01 against each provider's own documentation. Terms and
limits are quoted where they exist and marked absent where they do not.

**The single most useful finding is in the last section: there is already an
interchange standard for this entire problem domain, and the organisations FBM
would otherwise integrate one-by-one already speak it.**

---

## Org verification (the Phase 1 capability)

| Source | Access shape | Terms / limits | Freshness |
|---|---|---|---|
| **IRS Tax Exempt Organization Search (TEOS)** — Pub 78 Data, Exempt Organizations Business Master File (EO BMF), Form 990 series, Form 990-N e-Postcard, Automatic Revocation of Exemption List | **Bulk download only — no API.** Pipe-delimited ASCII text; EO BMF is split by state/region | US Government work; the dataset guide is IRS Pub 5891 | Files updated **monthly**; Pub 78 Data last updated **2026-09-10** |
| **ProPublica Nonprofit Explorer** | REST API, base `https://projects.propublica.org/nonprofits/api/v2`. **No authentication — no API key** | "Usage constitutes agreement to our Data Terms of Use." **No request rate limit is published.** The one documented limit is on filing PDFs: *"Note that these download links are rate limited. If you would like to download Form 990 document PDFs in bulk, filings processed since 2017 are available from the IRS."* Docs state the API is *"a work in progress and is subject to change"* | Derived from IRS filings |

### What this implies for the build

Build org verification on the **IRS bulk files as the system of record**, with
ProPublica as *optional enrichment only*. The reasoning:

1. The IRS files are authoritative for the thing being verified — Pub 78
   eligibility to receive tax-deductible contributions, and the Automatic
   Revocation list, which is the one that matters for *not* vouching for an org
   whose status has lapsed.
2. There is no rate limit on a file you already downloaded, and no third
   party's uptime between FBM and the answer.
3. ProPublica's own docs say the API is subject to change and publish no rate
   limit, so its availability cannot be depended on for a verification gate.

Monthly refresh matches the IRS publication cadence, so a monthly ingest is not
a compromise — it is the actual resolution of the underlying data. Any UI must
therefore show the *as-of date*, because "verified" means "verified against the
file published on 2026-09-10", not "verified just now".

**Rejecting a claim must be distinguished from not finding one.** An EIN absent
from Pub 78 is not evidence of anything; an EIN on the Automatic Revocation
list is. These are different states and must not collapse into one "unverified".

---

## Partner and resource directories

| Source | Access shape | Position |
|---|---|---|
| **HRSA — `data.hrsa.gov` (HRSA Data Warehouse)** | Real **APIs**, web services and map services, via registration at `data.hrsa.gov/data/services/registration`. Also CSV/XLSX bulk downloads at `data.hrsa.gov/data/download`, including "Health Center Service Delivery and Look-Alike Sites". Public UI at `findahealthcenter.hrsa.gov`; embeddable widgets at `data.hrsa.gov/tools/widgets` | **Usable.** Registration required; bulk download available as a fallback that needs no registration |
| **Legal Services Corporation (LSC)** | Interactive grantee map and list at `lsc.gov/grants/our-grantees`, covering 129 funded legal-aid programs across every state, DC and the territories. Research/data portal at `lsc.gov/research-data` | **No API found.** Directory data would need a licensed feed or an agreement — do not scrape |
| **LawHelp.org** | National gateway to the LSC-funded statewide website network (50 states + DC + territories); template built by Pro Bono Net | **No API found** |
| **Feeding America** | Public member food bank list at `feedingamerica.org/find-your-local-foodbank/all-food-banks` | **No documented public developer API and no API keys for third-party access.** The "Feeding America API" products that appear in search results are **third-party scrapers** on commercial marketplaces. **Do not build on those** — no terms, no stability, and the data is taken rather than given |
| **findhelp (and 211)** | Partner/customer integrations; connects to 211 CRM databases via iCarol and VisionLink | **Commercial agreement required**, not open access. Partners can integrate findhelp APIs, but as customers |
| **NAFC clinic locator** | — | **Not researched.** Still owed |

---

## The finding that changes the shape of the work

**Open Referral / Human Services Data Specification (HSDS) 3.0** is an
established interchange format for exactly this data — "machine-readable
information about health, human, and social services: their locations, and the
organizations that provide them."

- **Licence: Creative Commons Attribution-ShareAlike 4.0** for the
  specification and its documentation. It is a *data standard*, not code, so it
  raises no linking question against FBM's AGPL-3.0.
- **Already adopted by findhelp, United Way 211, Unite Us** and most academic
  SDOH research projects. There is a separate API specification published at
  `openreferral.github.io/api-specification`.
- Real feeds exist in the wild: Feed America publishes an HSDS 3.0 Open Referral
  feed at `feedam.org/hsds`, consumed by findhelp, United Way 211 and Unite Us.

So the integration target is **HSDS 3.0**, not N proprietary APIs. Speaking one
documented standard — consuming it, and publishing FBM's own partner directory
in it — replaces a stack of bilateral integrations, and is the difference
between asking each organisation for special access and being readable by
everything in the ecosystem already. It also makes the "partner with rather
than compete against" posture of step 0.4 mechanical rather than political.

**CC-BY-SA-4.0 carries an attribution and share-alike obligation on the
specification text.** Whether reproducing schema fragments in FBM's own docs or
code triggers it is a legal checkpoint, not something this report resolves.

---

## Legal checkpoints raised by this step

Recorded in `docs/legal/checkpoints.md`, unresolved here by design:

1. Whether presenting IRS Pub 78 / EO BMF status to users constitutes a
   representation FBM is making about a third party, and what disclaimer that
   requires.
2. Whether the CC-BY-SA-4.0 terms on the HSDS specification reach FBM's own
   schema definitions and documentation.
3. Whether republishing any partner directory data requires each partner's
   consent independently of the source licence.
4. ProPublica's Data Terms of Use have not been read line-by-line and must be
   before any dependency on that API ships.

---

## Sources

- [IRS — TEOS bulk data downloads](https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads) ·
  [TEOS](https://www.irs.gov/charities-non-profits/tax-exempt-organization-search) ·
  [TEOS Dataset Guide (Pub 5891)](https://www.irs.gov/pub/irs-pdf/p5891.pdf)
- [ProPublica — Nonprofit Explorer API](https://projects.propublica.org/nonprofits/api) ·
  [announcement](https://www.propublica.org/nerds/announcing-the-nonprofit-explorer-api)
- [data.hrsa.gov FAQ](https://data.hrsa.gov/about/faq) ·
  [data downloads](https://data.hrsa.gov/data/download) ·
  [widgets](https://data.hrsa.gov/tools/widgets)
- [LSC — Our Grantees](https://www.lsc.gov/grants/our-grantees) ·
  [Research & Data](https://www.lsc.gov/research-data)
- [LawHelp.org — overview of statewide websites](https://www.lawhelp.org/resource/overview-of-legal-services-statewide-websites)
- [Feeding America — member food bank list](https://www.feedingamerica.org/find-your-local-foodbank/all-food-banks)
- [findhelp — customer integrations](https://company.findhelp.com/products/customer-integrations/) ·
  [APIs in action](https://company.findhelp.com/blog/2024/07/10/findhelps-apis-in-action/)
- [Open Referral — licence](https://docs.openreferral.org/en/latest/about/license.html) ·
  [design principles](https://openreferral.readthedocs.io/en/3.0/design_principles.html) ·
  [HSDS FAQs](http://docs.openreferral.org/en/latest/hsds/hsds_faqs.html) ·
  [API specification](https://openreferral.github.io/api-specification/) ·
  [a live HSDS 3.0 feed](https://feedam.org/hsds)
