# Reuse Report — step 0.4, platforms to partner with rather than compete against

Researched 2026-10-01 against each platform's own pages, feeds and terms;
live feeds were probed, not described from memory. Where a claim rests on a
search snippet, a third-party listing or a page that would not load, it is
marked **unverified**. Every entry carries the URLs actually read.

**Method and its limits, stated up front.** Five research angles ran in
parallel (HSDS publishers, the 211 network, mutual aid, food access, giving
platforms), each meant to be followed by an adversarial fact-check against
primary sources. **Only the HSDS fact-check completed**; the other four and the
synthesis step were cut off by a rate limit. So the HSDS section below carries
the fact-checker's fourteen corrections, and the other four sections carry only
the researcher's own "unverified" labels. The GitHub API returns 403 in this
environment, so code licences that live only in a repository README are
**unverified** throughout, and no "last commit" date is given for anything.

---

## 1. The one-line answer

**Do not build a partner directory or a resource finder. Publish FBM's
partner directory as an HSDS 3.x feed, consume the handful of open HSDS feeds
that already exist, and route money to whichever fiscal host a partner already
has.** Everything that follows is evidence for those three clauses and for
where each breaks down.

Step 0.3 reframed 0.4 from "who will grant us API access" to "who already
speaks HSDS". The answer turned out narrower than hoped: **in the US there are
exactly two live, open, unauthenticated HSDS 3.x feeds** (Feed America and
Mutual Aid NYC), one UK-profile feed (WeGov NYC), and one national gated
doorway (the 211 National Data Platform). Everyone else is bilateral.

---

## 2. HSDS publishers and consumers

Corrections from the fact-check are applied; where it refuted the researcher,
the refuted claim is dropped and the correction stated.

| Who | What they actually offer | Access | Partner / compete |
|---|---|---|---|
| **Open Referral Initiative** | The HSDS specification (CC BY-SA 4.0 for spec and docs), a public Discourse forum, a Standing Technical Committee meeting monthly, a **Data Collaboration Toolkit (Jan 2026) with a templated partnership memorandum**, and a free Network Summit 7–8 Oct 2026. No membership, no fee, no certification. **No maintained registry of adopters or of consumer apps exists** — the `/about/projects` sheet and map were not retrievable. | Open | **Partner.** A standards community, not a platform. The MOU template is the closest thing in the ecosystem to a ready-made "partner, don't compete" instrument. Nothing to sign — and therefore nothing to rely on contractually. |
| **HSDS 3.x specification** | Fact-check correction: the required endpoint set is `GET /`, `GET /services`, `GET /services/{id}` and (per the latest reference) `POST /services` — **not** just the first two as first reported. Bulk form is a Tabular Data Package; `?format=ndjson` streaming. 3.2 (Sep 2025) added provenance metadata naming publisher and technology provider; 3.3 approved Aug 2026. **The spec specifies no authentication at all.** | Open | The target format. A compliant FBM feed is small. |
| **Feed America (feedam.org)** | **The one verified open US HSDS 3.0 publisher.** Live `https://feedam.org/hsds/v3/` with `/organizations`, `/services`, `/locations`, `/service_at_location`, `/phones`, `/addresses`, `/schedules`, `/taxonomy_terms`; JSON or `?format=csv`; a service record `last_modified` 2026-04-27 was read on 2026-10-01. Aggregates USDA SNAP retailer data, school meals, HRSA health centres, state WIC, and "curated nonprofit partners" — a sample record's website was `ampleharvest.org`. **Fact-check corrections:** the about page does *not* say "does not hold or move money"; it says "operates a search engine, not a food bank" and that it does not sell user data, charge fees or accept paid placements. Its claim that findhelp, Unite Us and 211s consume the feed is **self-reported only**. **Licence conflict:** the feed and terms say CC BY-SA 4.0; the footer and HTTP headers say CC BY 4.0. A 501(c)(3), EIN 92-1761881, files 990-N. | Open, no key; "600 req/min/IP" stated | **Partner.** The cheapest way to seed a food/mutual-aid directory, and the working model for how FBM should publish its own. Not to be confused with Feeding America®. |
| **UWW 211 National Data Platform** (`apiportal.211.org`) | Fact-check correction: the API catalogue **is** visible without sign-in — Search V2, Export V2 (bulk export "to external systems"), Query V2, Suggest V2, Filter V2, EPIC V2 — and a "Trial" product exists. Keys are issued by **each local 211's data steward**; the standard data-sharing agreement and API request form sit in a members-only toolkit. A 5% fee on 211 revenue applies to contributors; whether a marketplace "leverages the NDP in a way that brings in revenue" is **undefined** in anything public. | Registration + per-211 sponsorship + agreement | **Partner, gated.** The single national doorway to US 211 resource data, and it speaks HSDS. Expect one agreement per region. |
| **Open Referral UK (ORUK)** under iStandUK | The **only live, maintained HSDS 3.x validator** found anywhere (`openreferraluk.org/developers/validator`, no login; BSD-3-Clause per a Jun 2026 post). A public feed dashboard: of 11 registered UK feeds, 3 fully compliant, 4 live-but-invalid, 3 offline. | Open | **Tooling.** Will validate a US feed's structure (UK-profile fields aside). The dashboard ratio is the lesson: a published feed is not a maintained one. |
| **Connect 211** | HSDS data replication, commercial AI search API, an open-licence "Record-Matcher" dedupe tool; builds pipelines for 211s in 20+ states; WellSky partnership Sep 2024. Fact-check: its wording is "We standardize data to HSDS by Open Referral". Code licences **unverified**. | Commercial | **Both.** A plausible consumer of an FBM feed, and a competitor for any "embed 211 search" feature. Present as a data publisher, not a buyer. |
| **Sarapis** (ORServices, HSD Airtable-to-API) | Open-source Laravel directory and an Airtable-fed HSDS feed generator; Open Referral's technical support. Fact-check: the CC BY-SA on its posts is the blog footer, **not** a software licence — code licences unverified. | Open | **Tooling.** HSD is a near-zero-cost way for a partner org with no tech capacity to publish its own feed. |
| **Open Referral Airtable template** (HSDS 3.1, Mar 2025) | Free template on Airtable Universe; Airtable's own API for data out; free tier fits ~200–300 services (fact-check: that figure is from the forum, not Airtable). | Open | **Tooling.** Realistic for a small partner; Airtable is the partner's dependency, not FBM's. |
| **HSDS Transformer** (Stevens Institute, May 2026) | Web UI converting spreadsheets to HSDS. Fact-check: the project page links `hsds-validator`, not `hsds-transformer` — repo name unverified. Licence unknown. | Open | **Tooling** for partner spreadsheet ingest. |
| **Open Referral's own validator** | `openreferral.github.io/hsds-validator` → **404** on 2026-10-01. | Dead | Recorded so nobody builds on it. Use ORUK's. |
| **Inform USA** (formerly AIRS) and the **211HSIS taxonomy** | Standards v10.1 (free PDF) require published directories to match "the open standard" — i.e. HSDS. The taxonomy is a **paid subscription licensed by 211 LA County**, with a subscriber API. Fact-check: cite 211 LA's own Subscription Agreement, not the IBM third-party page. | Open (standards) / commercial (taxonomy) | **Gatekeeper, not partner.** Any HSDS record ingested from a 211 carries 211HSIS codes; republishing them is a licence question (L17 below). |
| **State CIEs** — NCCARE360 (NC), Nexus SD | Fact-check: NCCARE360 confirmed — "Using HSDS, UniteUs receives resource data" under non-commercial public-utility governance (Nov 2020). Nexus SD runs on findhelp with Connect211 supplying data via "a Human Service Data API". No open feed either. | Governance approval | **Avoid.** CIEs hold consented client PII. FBM stays on the resource-directory side only. |
| 211 Ontario Open211, Benetech Service Net, Ohana, Link-SF | Historic. Fact-check: the 2016 Ontario post does **not** state "HSDS 1.0" or a data licence; Service Net's archive date is **unverified**. | — | Precedent only. Do not cite as live consumers. |

**Searched for and not found:** any US 211 or government publishing an open,
unauthenticated HSDS feed; any HSDS dataset on data.gov; any HSDS package on
npm; any Open Referral-maintained list of consumer applications.

---

## 3. The 211 network: brand, local provider, CRM vendor

Three things get called "211" and they are not interchangeable:

- **The brand** (United Way Worldwide + Inform USA) offers no data. Using the
  "211" mark in FBM's UI is a trademark question.
- **The local 211** owns its data and decides access — per region. Of those
  examined: **Michigan 2-1-1** runs an HSDS-shaped partner API consumed by MI
  Bridges and others (the clearest US example; terms by request); **211 LA**
  has no API for resource data but licenses the taxonomy; **211 San Diego**
  contributes to the NDP via its own API; **2-1-1 Texas** (HHSC + 25 centres)
  has no data door at all; **211 Connecticut** is "email the manager".
  **Miami Open211**'s historic open API is the only documented US 211 open-API
  experiment; current status **unverified**.
- **The CRM vendor** is who the data actually lives with. **iCarol** exports
  "HSDS 1.1 schema" as an optional add-on, one monthly export included;
  **VisionLink** offers an "API Builder" (bespoke shape; a 2019 HSDS
  commitment, shipped export **unverified**); **WellSky**'s provider API
  "generally aligns" with HSDS and carries an annual fee the 211 bears. FBM
  never contracts with any of them — it asks a 211 to point a key at FBM.

**Two things that shape the build regardless of partner:** vendor exports are
**HSDS 1.1-era** while the spec is at 3.3, so FBM's ingest owns a version
upgrade; and findhelp and Unite Us are *peer consumers* of the same 211 feeds,
which is the best evidence that 211s already license data to commercial
platforms — the door exists, for paying partners.

**Avoid:** `us211-api` (an unofficial GitHub federator/scraper). Same posture
0.3 took on Feeding America scrapers: data the owners did not authorise is not
a source, and would poison FBM's standing with the 211s it wants.

---

## 4. Mutual-aid platforms

*Fact-check did not run on this section; "unverified" labels are the
researcher's own.*

| Platform | Data / integration | Holds money? | Active in 2026? | Stance |
|---|---|---|---|---|
| **Mutual Aid NYC** | **Live unauthenticated JSON** at `lists.mutualaid.nyc/api/services` (682 records; `last_modified` to 2026-10-01) plus an HSDS 3.0 API on Open Referral tooling. Data licence CC BY 4.0 **asserted by a third-party listing, not by MANYC**. The dump includes records marked "Do Not Publish" and internal reviewer fields. | Unverified | Yes | **Partner — strongest candidate.** Consuming/contributing HSDS here is mechanical. Filter on status before use; confirm the licence with them. |
| **WeGov NYC HSDirectory** | Public API at `services-api.wegov.nyc` returning `"version":"HSDS-UK-3.0"` (UK profile, not core). Small dataset. No terms or licence published. | n/a | Serving | **Partner / interop test target.** Ask before ingesting; confirm the parser handles UK-profile differences. |
| **Mutual Aid Hub** (Ground Game LA) | No documented API — but the Firestore collection `mutual_aid_networks` is **publicly readable** (901 documents updated 2026-09-25 onward). Data stated as PDDL 1.0. | No (links out) | Yes | **Partner — ask, don't scrape.** The only national permissively-licensed group dataset found. Reading an undocumented-but-public collection was not *offered*; outreach for an HSDS export is the right move. |
| **Mutual Aid Wiki** | Documented JSON API and embeddable map — **API returned 502 on every probe**. Data CC BY-NC-SA (from a README excerpt, unverified). | No | Dormant | Irrelevant now; the embed pattern is a useful precedent. |
| **Mutual Aid LA Network** | **Directory taken offline over safety of groups and individuals.** | Unverified | Site live, directory not | **A design signal**, not a partner: default-private contact details and group-controlled publication belong in FBM's directory design (L20). |
| **Mutual Aid Disaster Relief** | HTML "co-conspirators" list, no data. Accepts donations incl. crypto. | **Yes** | Yes (Aug 2026 post) | Directory reciprocity only. Not a money-path partner for a Posture A platform; any "verified" listing must surface its ProPublica diversion-of-assets disclosure neutrally. |
| **Goodkeep** | Web-only directory (529+ groups), onboarding ex-OCF groups. "We never touch your money… cryptographic keys only members hold." | No, by its account | Yes (Mar 2026) | **Both.** Overlaps FBM's partner-directory ambition and targets the same audience; its key-based treasury strongly suggests crypto/multisig custody — Posture A review before any linkage. |
| **Open Collective** (OFi Technologies / OFiCo) | Public GraphQL v2, verified unauthenticated (a "mutual aid" search returned 1,934 accounts). Embeddable contribution iframe. **ToS says third-party apps need "prior written consent"** while the developer docs invite self-serve — a contradiction. | **No** (hosts hold; platform doesn't) | Yes (ToS Aug 2026) | **Partner.** Same no-custody posture as BMC. It does the thing BMC won't. |
| **Open Collective Foundation** | **Dissolved 2024-12-31.** | — | No | Irrelevant — but it is *why* groups are re-homing, and why a 5% host fee could not cover compliance for hundreds of small groups. Bears directly on Open Decision 1 (0% donation fee). |
| **Hack Club HCB** (The Hack Foundation) | **Unauthenticated public REST API v3** (verified live) exposing Transparency-Mode org ledgers. 501(c)(3) host. **Eligibility: "exclusively focused on teen-led organizations"** per its help centre — conflicts with the researcher's note that it hosts adult mutual-aid groups; **unresolved**. | **Yes** | Yes | Partner *if* eligibility fits. No API terms published. Confirm with HCB before pointing anyone there. |
| **Pact Collective** (NYC host) | OC platform only. Ledger public: income $368k, **balance −$40k**. NY-only. | Yes | Yes (Oct 2026 ledger) | Partner for NY groups — with due diligence on that balance. |
| **Karrot**, **Bonfire**, **Ruby for Good mutual-aid**, **Shareish** | Self-hostable coordination tools. Karrot: mixed MIT/AGPL. Bonfire: AGPL. Others unverified/dormant. | No | Mixed | **Tooling references** for a "groups coordinate pickups/offers" module — separate-service mode, per 0.2. |
| **Food Oasis** (Hack for LA) | Website only; aims "to share data" but no endpoint found. **GPL-2.0** — not AGPL-3.0 compatible for linking. | No | Listed active | Separate-service only, if at all. |
| **Buy Nothing** | No API, no partner programme, no data sharing. | No | Yes | Compete-adjacent to the circular-economy module; no surface. |

**Searched for and not found:** any national US mutual-aid directory publishing
HSDS; any mutual-aid directory with a documented partnership or data-sharing
programme; a documented API from Mutual Aid Hub.

---

## 5. Food-access partners for the Phase 2 pilot

*Fact-check did not run on this section.*

| Who | What's actually on offer | Money | Stance for the pilot |
|---|---|---|---|
| **Feeding America member banks** | No API, no feed (0.3). Partnership is **in kind**: product donation via MealConnect or the Food Industry Partnerships team (which names "growers, farmers, packers"); or a pantry becoming a *partner agency* of its local bank, which inherits food-safety and 501(c)(3) vetting. | In-kind only | **Partner — the anchor.** A pantry already in the network is the obvious partner-org shape. Naming a bank as a "partner" in FBM's directory likely needs its written consent (L19). |
| **MealConnect** | Donor accounts, free. **Terms prohibit "any commercial purpose"**; no API; the "Core / Real Time / Logistics" split is third-party press, not the site. | In-kind | **Partner — link out, never mirror.** The operator's farm can list surplus directly. |
| **Feed America** (feedam.org) | The HSDS feed in §2. Aggregates SNAP retailers, WIC, HRSA, pantries. | No | **Partner** as a directory seed; also the model for publishing back. Licence conflict (BY vs BY-SA) is L15. |
| **AmpleHarvest** | Pantry registration is open; **terms forbid any automated data access**. Feed America's records appear to include AmpleHarvest-derived pantries. | No | Partner by asking only. Do not ingest — and check whether feedam.org records with an `ampleharvest.org` website are data AmpleHarvest's terms cover (L16). |
| **The Farmlink Project** | Contact form only; funds transport itself. | No | **Partner — the most farm-specific donation route found.** Zero cost to the operator's farm. |
| **Food Rescue US**, **Replate**, **Rescuing Leftover Cuisine**, **Copia** | Web apps / per-pickup fees / contact-only APIs; regional coverage varies. Food Rescue US licenses its platform to local 501(c)(3)s. | Fees for logistics, not food | Partner as haulers where present; Copia is enterprise-priced. |
| **Food Rescue Hero** (412 Food Rescue) | SaaS at **$500–1,250/month** for nonprofits. | Subscription | **Compete** — this is the market rate for any volunteer-rescue logistics module FBM might build, and the buyers are nonprofits, not marketplaces. |
| **Too Good To Go** | Partner pages returned **HTTP 429** on every attempt — terms **unverified**. Sells surplus bags and remits to the business on commission. | **Yes** | Both: a listing outlet for surplus, and an overlap with FBM's paid-box flow. |
| **Open Food Network USA** | OFN API v1 "fully supported", v0 "not supported"; access by contacting the instance manager; its "API and Data Use Policy" **was not found**. Instance appears **thinly resourced** (small Open Collective contributions through Mar 2026). | No | **Both.** Closest OSS analogue to the food-hub/order-cycle model (0.2); interoperate via its API or the DFC standard rather than re-implement — if the US instance is still there to interoperate with. |
| **GrownBy** (Farm Generations Co-op) | No public API (JS-only site). Farmer-owned; the only platform documented offering **free SNAP Online** for direct-marketing farmers, via MarketLink. | **Yes** | **Compete** — the direct analogue of FBM's paid-box/CSA flow. |
| **MarketLink** (FFAB) | Grant programme + technical assistance for direct-marketing farmers to become SNAP-authorised; free during the grant year; **ties the farmer to GrownBy** for that year. | No | Partner for the operator's farm specifically; eligibility is per individual producer, not marketplace (L21). |
| **Forage** (SNAP EBT processor) | Public REST API, SDKs, sandbox. Merchant must already be FNS-authorised. | **Yes** (settles EBT to the merchant) | **Partner** for the technical half of SNAP Online. Does not remove the authorisation requirement. EBT settlement vs Posture A is L22. |

### USDA programme pages read, and what they say

Each is a **checkpoint**, not a conclusion that BMC qualifies.

- **SNAP retailer authorisation / SNAP Online Purchasing** (`fna.usda.gov`, pages dated Sep 2026): online requires an authorised retailer, a third-party processor, **no guest checkout**, eligible-item flagging, and an LOI for online-only retailers. Whether a multi-vendor marketplace can be "the retailer" or each vendor must be authorised separately is **not answered on the page** (L21).
- **LFPA / LFS** (`ams.usda.gov`): no new federal funding; some pre-LFPA25 state agreements may still be in performance. State-by-state fact to check.
- **TEFAP Farm to Food Bank** (`fna.usda.gov`, FY2026 allocations updated Apr and Sep 2026): **the one federal programme live in FY2026** that reimburses getting donated produce to food banks. Counterpart is the state TEFAP agency. Whether paid "sponsor-a-box" produce can coexist with donated produce under it is L23.
- **GusNIP** (`nifa.usda.gov`, FY2026 RFA May–Jul 2026): grant programme; **BMC cannot apply** (no nonprofit entity). A partner org could, with SNAP-authorised FBM vendors as redemption sites.
- **Double Up Food Bucks** (Fair Food Network): per-state, SNAP-authorised sites only; **no state programme read supports online redemption.**

**Not found:** any Feeding America API (re-confirmed); any US business programme for Olio; developer docs for Too Good To Go.

---

## 6. Giving and fiscal-hosting platforms: partner or compete

*Fact-check did not run on this section.* Framed against FBM's posture: flat
3% never increased; BMC holds no money; 0% BMC fee on donations is Open
Decision 1, unresolved.

The recurring shape is **"a 501(c)(3) in the middle takes legal title and
regrants"** — PayPal Giving Fund, Benevity, Every.org, Pledge, Change, Daffy
all work that way. That satisfies "BMC holds no money" exactly, at the cost of
(a) 501(c)(3)-only recipients, (b) the intermediary's variance power to
redirect, and (c) a fee stack. **The only pattern found where a donation
reaches a nonprofit's own account with FBM never holding it is a Stripe Connect
direct charge on the nonprofit's connected account** — already FBM's processor.
Destination charges transit FBM's balance and are the Posture A question (L24).

| Platform | Model | FBM holds? | Fee to donor/charity | Verdict |
|---|---|---|---|---|
| **Stripe Connect** direct charge | Nonprofit as connected account; `application_fee_amount = 0` on the donation line | **No** | Stripe processing only | **Already in use; the pattern to build on.** Whether Stripe's nonprofit discount applies to platform-created charges is unverified. |
| **Open Collective** + a host (Raft Foundation, Pact, Superbloom…) | Link/iframe to the collective's page; read-only API for transparency | No | Host fee (5–12% observed) | **Partner.** Raft is the closest live 501(c)(3) umbrella for mutual-aid groups. A "verified recipient" is a *host + collective pair*, so FBM's directory needs a host field, not just an EIN. |
| **Every.org** | Nonprofits API (1M+ 501(c)(3)s), open-source Donate Button, Donate Link with `partner_donation_id`, webhooks | No (Every.org receives and disburses) | 0% platform | **Partner — closest to FBM's values.** Open question whether a founder-run marketplace is "commercial use" under its API terms; Donate Button licence unread. |
| **PayPal Giving Fund** | Charity Search API for partners; PPGF takes title and regrants | No | 0% to charity | Partner in model; **partner-gated**, 501(c)(3)-only, variance power must be disclosed at point of donation. |
| **Zeffy** | Per-organisation read API; **EIN-eligible, not 501(c)(3)-only**; 0% fee, tip-funded | n/a | 0% + optional tip | **Both.** The most permissive eligibility found for small groups, and a live proof a tip-funded 0% model operates at scale — with its own safeguard against "high card volume, minimal tips". Directly relevant to Decision 1. |
| **Givebutter** | Per-organisation API, 500 req/min | n/a | 3% platform or tips | **Both.** A direct analogue of FBM's own 3%; features gated on "verified nonprofit". |
| **Change** (getchange.io) | API; **invoices the business monthly**; prices commercial co-venturer and professional-fundraiser compliance **explicitly** as separate plans | No | Varies | Partner in model — and the one vendor that puts a price on the legal surface FBM would otherwise discover later (L25). |
| **Pledge**, **Benevity**, **Daffy**, **GlobalGiving**, **GoFundMe Pro** | Regrant APIs with 3–15% stacks, enterprise motions, DAF-origin only (Daffy), or international focus | No | Above FBM's 3% | Irrelevant or poor fit. |
| **Donorbox**, **Give Lively** | Per-nonprofit tools; paywalled or no API | — | — | Compete-adjacent; fee benchmarks only. |
| **Charity Navigator GraphQL** | Data only; beta tier free, **1,000 searches/day**, 30-day termination right | No | Free (beta) | Enrichment only. Cannot be a verification gate — reinforces 0.3's IRS-bulk-file decision. |
| **HCB**, **Social Good Fund**, **Fractured Atlas**, **ioby** | Fiscal hosts with eligibility limits (teen-led; "no direct financial mutual aid" per an **unverified** snippet; arts only; 25%-on-platform rule) | — | 6–8% typical | Referral targets at most; each has a reason it does not fit generally. |

**Not found:** any giving platform that publishes or consumes HSDS; any
"donate to any recipient" API whose recipient set includes unincorporated
groups — **every regrant API found is 501(c)(3)-only**, which is the gap
mutual-aid groups actually fall into.

---

## 7. What this means for the BUILD NEW gate

**Do not build — integrate instead:**

| Instead of building… | Use | Evidence |
|---|---|---|
| A partner directory data model | **HSDS 3.x**, published and consumed | §2: the standard, the validator (ORUK), two live US feeds, the 211 NDP all speak it |
| A resource finder / 211 search | Nothing — FBM is not an I&R service | §3: findhelp, Unite Us, Connect 211 already do this against the same data, for money |
| Donation custody or a donor ledger | **Stripe Connect direct charges** to the partner's own account; link to the partner's fiscal host otherwise | §6: the only no-custody pattern; every alternative is a regranting intermediary |
| A fiscal-sponsorship product | Open Collective hosts (Raft), Zeffy for EIN-only groups | §6; BMC has no entity to sponsor with |
| Food-rescue logistics | Farmlink, Food Rescue US, Replate as haulers | §5; the SaaS market rate is $500–1,250/month and buyers are nonprofits |
| Partner MOU / data-stewardship terms from scratch | Open Referral's **Data Collaboration Toolkit** memorandum template, adapted | §2; CC BY-SA, written for coalitions — L18 |

**Nothing exists — building is justified, narrowly:**

| What | Why nothing covers it |
|---|---|
| **An HSDS 1.1 → 3.x upgrade path in FBM's ingest** | 211 vendor exports are 1.1-era; the spec is at 3.3; no public tool found that does the upgrade |
| **A "host + collective" recipient model** in the partner record | Every giving platform treats the recipient as an EIN; mutual-aid reality is a fiscal-host pair, and no API models it |
| **Group-controlled, default-private publication** of directory contact details | Mutual Aid LA pulled its directory offline over safety; no consumed feed enforces this, so FBM must at the write boundary |
| **Status/consent filtering on ingest** | Mutual Aid NYC's public dump includes "Do Not Publish" records; the open feeds do not pre-filter |

The 0.3 conclusion stands: **org verification is built on the IRS bulk files**,
with ProPublica or Charity Navigator as enrichment only.

---

## 8. New legal checkpoints

Recorded in `docs/legal/checkpoints.md` as L15–L25, all `needs counsel`,
unresolved here by design. In brief: the Feed America BY vs BY-SA conflict and
what share-alike means for a derived feed (L15); AmpleHarvest's no-automation
terms reaching records that arrive via feedam.org (L16); **211HSIS taxonomy
codes inside ingested HSDS records** — storing, displaying, or stripping them
(L17); adapting the Open Referral MOU template when BMC has no entity to sign
(L18); naming a Feeding America bank or agency as a "partner" (L19);
default-private contact data and partner consent before any feed leaves a
feature flag, given HSDS specifies no auth (L20); whether a marketplace can be
the SNAP "retailer" or each vendor must be authorised (L21); EBT settlement via
a third-party processor against Posture A's no-balance-holding (L22);
paid boxes coexisting with donated produce under TEFAP Farm to Food Bank (L23);
Stripe destination charges transiting FBM's balance vs direct charges (L24);
whether checkout donations make BMC a **commercial co-venturer or charitable
solicitor** under state law — the compliance surface Change prices explicitly
(L25).

---

## 9. Stated limitations

- **Four of five sections were not fact-checked.** §2 was; §3–§6 carry the
  researcher's own labels only.
- **GitHub 403**: every code licence that lives in a repository (Connect 211's
  tools, Sarapis, HSDS Transformer, Every.org's Donate Button, Donorbox's API
  docs) is unverified. No last-commit dates anywhere.
- **Pages that would not load:** Too Good To Go partner pages (429), Social
  Good Fund (blocked), Ribbon (TLS error), GrownBy and GusNIP hub (JS-only),
  iCarol (bot challenge). Their terms are unread.
- **Members-only material not read:** the 211 NDP standard data-sharing
  agreement and API request form; Michigan 2-1-1's partner terms; PayPal
  Giving Fund, Benevity and Daffy partner agreements; ProPublica's Data Terms
  (carried from 0.3, L14).
- **Self-reported claims not independently confirmed:** Feed America's
  consumer list; Mutual Aid NYC's CC BY licence; HCB's adult mutual-aid hosting.
- **Nothing here is a legal conclusion.** Where a licence or term looks like a
  conflict, it is listed as a checkpoint.

---

## Sources

Open Referral: [home](https://openreferral.org/) · [get involved](https://openreferral.org/about/get-involved/) · [FAQ](https://openreferral.org/faq/) · [technology overview](https://openreferral.org/about/technology-overview/) · [HSDS 3.1](https://openreferral.org/upgrading-our-standards-introducing-version-3-1-of-the-human-service-data-specifications/) · [Data Collaboration Toolkit](https://openreferral.org/introducing-open-referrals-data-collaboration-toolkit/) · [API reference](https://docs.openreferral.org/en/latest/hsds/api_reference.html) · [licence](https://docs.openreferral.org/en/latest/about/license.html) · [HSDS 3.3 approval](https://forum.openreferral.org/t/action-approval-for-hsds-3-3/855) · [Network Summit](https://forum.openreferral.org/t/network-summit-october-7-8/865)
Feeds probed: [feedam.org/hsds](https://feedam.org/hsds) · [feedam.org/hsds/v3/datapackage.json](https://feedam.org/hsds/v3/datapackage.json) · [lists.mutualaid.nyc/api/services](https://lists.mutualaid.nyc/api/services) · [services-api.wegov.nyc](https://services-api.wegov.nyc/) · [Shropshire ORUK feed](https://shropshire.openplace.directory/o/OpenReferralService/v3/) · [HCB API v3](https://hcb.hackclub.com/api/v3/swagger_doc) · [Open Collective GraphQL v2](https://api.opencollective.com/graphql/v2)
211: [apiportal.211.org](https://apiportal.211.org/apis) · [register.211.org FAQs](https://register.211.org/Home/FAQs) · [integrations overview](https://register.211.org/Home/IntegrationsOverview) · [Michigan 2-1-1 (Open Referral)](https://openreferral.org/michigan-211s-new-resource-data-infrastructure-providing-social-service-information-as-a-service/) · [mi211.org/cie](https://mi211.org/cie) · [NCCARE360](https://openreferral.org/introducing-nccare360-a-coordinated-statewide-resource-referral-platform/) · [211 LA organizations](https://211la.org/organizations) · [211HSIS Subscription Agreement](https://211hsis.org/library/Subscription_Agreement.pdf) · [iCarol HSDS 1.1 export](https://www.icarol.com/icarols-resource-api-supports-open-referrals-hsds-1-1-schema/) · [VisionLink (Open Referral)](https://openreferral.org/visionlink-adopts-open-referral-for-resource-data-interoperability/) · [WellSky + Connect 211](https://wellsky.com/wellsky-partners-with-connect-211-to-improve-online-data-sharing-and-make-community-resources-easier-to-find/) · [Inform USA standards](https://www.informusa.org/standards) · [ORUK validator](https://openreferraluk.org/developers/validator) · [ORUK dashboard](https://openreferraluk.org/developers/dashboard) · [Connect 211](https://connect211.com/)
Mutual aid: [Mutual Aid NYC](https://mutualaid.nyc/) · [Mutual Aid Hub](https://www.mutualaidhub.org/) · [Mutual Aid Wiki](https://mutualaid.wiki/) · [Mutual Aid LA listings](https://mutualaidla.org/listings/) · [MADR](https://mutualaiddisasterrelief.org/) · [Goodkeep](https://goodkeep.org/) · [OCF dissolution](https://opencollective.com/foundation/updates/announcement-we-are-dissolving-open-collective-foundation-at-the-end-of-this-year) · [OC fiscal-hosting options](https://blog.opencollective.com/fiscal-hosting-options/) · [Pact Collective](https://opencollective.com/pact_collective) · [HCB fiscal sponsorship](https://hackclub.com/fiscal-sponsorship/) · [HCB eligibility](https://help.hcb.hackclub.com/en/articles/15409923-who-can-apply-for-fiscal-sponsorship) · [Karrot docs](https://docs.karrot.world/) · [Food Oasis](https://www.hackforla.org/projects/food-oasis)
Food access: [Feeding America network](https://www.feedingamerica.org/our-work/food-bank-network) · [product partners](https://www.feedingamerica.org/ways-to-give/corporate-and-foundations/product-partner) · [MealConnect terms](https://mealconnect.org/terms) · [AmpleHarvest terms](https://ampleharvest.org/terms-use/) · [Farmlink for farmers](https://www.farmlinkproject.org/for-farmers) · [Food Rescue US FAQ](https://foodrescue.us/about/faqs/) · [Food Rescue Hero pricing](https://foodrescuehero.org/pricing) · [Replate pricing](https://www.replate.org/pricing) · [OFN USA](https://about.openfoodnetwork.net/) · [GrownBy SNAP](https://coop.grownby.com/snap) · [MarketLink](https://marketlink.org/services/) · [Forage docs](https://docs.joinforage.app/reference/introduction) · [SNAP Online requirements](https://www.fna.usda.gov/snap/retailer/online/requirements) · [LFPA](https://www.ams.usda.gov/selling-food-to-usda/lfpacap) · [TEFAP Farm to Food Bank FY26](https://www.fna.usda.gov/tefap/farm-to-food-bank-project-grants/state-requests-allocations-fy26) · [GusNIP](https://www.nifa.usda.gov/grants/programs/hunger-food-security-programs/gus-schumacher-nutrition-incentive-program) · [Double Up](https://doubleupfoodbucks.org/get-involved/become-a-participating-location/)
Giving: [Stripe Connect charges](https://docs.stripe.com/connect/charges) · [destination charges](https://docs.stripe.com/connect/destination-charges) · [Open Collective ToS](https://opencollective.com/tos) · [OC developers](https://developers.opencollective.com/welcome) · [Raft Foundation](https://raft.foundation/) · [Every.org docs](https://docs.every.org/docs/intro) · [Every.org charity API](https://www.every.org/charity-api) · [PayPal Giving Fund partners](https://www.paypal.com/us/webapps/mpp/givingfund/partner) · [Benevity developer](https://developer.benevity.org/) · [Zeffy API](https://www.zeffy.com/integration/api) · [Zeffy eligibility](https://support.zeffy.com/is-my-organization-eligible-to-use-zeffy-8m24r) · [Givebutter pricing](https://help.givebutter.com/en/articles/1512762-givebutter-standard-pricing-explained) · [Change pricing](https://getchange.io/pricing/companies) · [Pledge API fees](https://help.pledgeling.com/support/solutions/articles/36000233798-what-are-the-fees-for-donations-made-via-the-api-) · [Daffy developer](https://www.daffy.org/developer) · [Charity Navigator API terms](https://www.charitynavigator.org/products-and-services/graphql-api/api-terms-of-use/) · [Social Good Fund rates](https://www.socialgoodfund.org/fiscal-sponsorship/sponsorship-rates/) · [ioby fees](https://ioby.org/fee) · [Mutual Aid NYC fundraising FAQ](https://mutualaid.nyc/fundraisingfaq/)
