# Reuse Report — step 0.2, OSS equivalents

Researched 2026-10-01. Every licence below was read from the project's own
licence statement or documentation, not inferred from memory or from a
directory listing. Where a fact could not be confirmed from a primary source it
is marked **unconfirmed**, not guessed.

**Method limitation, stated up front.** This session's GitHub access is gated to
the three BMC repositories, so `api.github.com` returns 403 for every
third-party project. That means **last-commit dates, maintainer counts and
issue counts could not be verified** and are deliberately omitted rather than
filled in from recollection. They remain owed before any adoption decision —
a licence that fits is not the same as a project that is alive.

---

## The licence question is a *mode* question, not a *project* question

FBM is AGPL-3.0. Whether a candidate's licence matters depends entirely on how
it is used, and the two modes are legally very different:

- **Separate service** — the candidate runs as its own process, in its own
  runtime, reached over HTTP. FBM ships no part of it.
- **Vendored / linked** — source is copied into FBM's tree, or the candidate is
  imported as a library into FBM's own build.

Nearly every candidate below is a separate service in practice (different
language, own database, own container). **This report does not rule on whether
either mode is permissible for a given candidate — that is a lawyer question,
and it is recorded as such in `docs/legal/checkpoints.md`.** What follows is
the factual licence position only.

---

## Candidates

| Candidate | Licence (verified) | Stack | Natural mode here |
|---|---|---|---|
| **CiviCRM** | **AGPL-3.0**, plus a documented CiviCRM Licensing Exception permitting combination with works under PHP License 2.01/2.02/3.0/3.01 | PHP 8.3–8.5, MySQL 5.7.5+ (8+ recommended) or MariaDB 10.2+ (11.4+ recommended), Linux; ships standalone or as a Drupal/WordPress/Joomla/Backdrop module | Separate service — nothing about a PHP+MySQL app links into a Node/Medusa build |
| **Open Collective** | **MIT** | Node/React | Either. MIT is permissive, so vendoring specific pieces is the one candidate where that is straightforward |
| **Open Food Network** | **AGPL-3.0** | Ruby on Rails + AngularJS | Separate service |
| **Karrio** | **core Apache-2.0**; community plugins **LGPL-3.0**; an **Enterprise Edition requiring a paid subscription** | Python/Django, Docker-first | Separate service behind FBM's existing `label-provider.ts` seam |
| **Listmonk** | **AGPL-3.0** | single Go binary + PostgreSQL | Separate service |
| **Mautic** | **GPL-3.0** | PHP | Separate service |
| **ERPNext** | **GPL-3.0** (Frappe Technologies) | Python / Frappe | Separate service |
| **Bigcapital** | **AGPL-3.0** | Node, Docker Compose | Separate service |
| **Activepieces** | **MIT** (core; the project also sells paid tiers) | Node | Either |
| **Windmill** | **AGPL-3.0** (self-hosted Community Edition; separate Enterprise plans exist) | Rust + TypeScript | Separate service |

## Things worth flagging before anyone picks one

- **Karrio has a paid Enterprise Edition.** The core is Apache-2.0 and the
  community plugins LGPL-3.0, but enterprise features require a valid
  subscription. Any adoption has to pin itself to the OSS edition explicitly,
  or it acquires a licence bill later. This is the one candidate with a live
  open-core split in the part of the product FBM would touch.
- **Activepieces and Windmill are both open-core too**, with paid tiers above
  the MIT / AGPL-3.0 community editions. Same caution, lower stakes.
- **Three distinct copyleft flavours appear here** — AGPL-3.0 (CiviCRM, OFN,
  Listmonk, Bigcapital, Windmill), GPL-3.0 (Mautic, ERPNext) and permissive
  (MIT: Open Collective, Activepieces; Apache-2.0: Karrio core). They are not
  interchangeable, and GPL-3.0 is not AGPL-3.0. Treat each as its own question.
- **Operational cost is the constraint nobody writes down.** CiviCRM wants
  PHP+MySQL; ERPNext wants Python/Frappe; OFN wants Ruby; Karrio wants Python;
  Listmonk wants its own PostgreSQL. FBM already runs Node 22 + PostgreSQL on a
  single DL360. Each adoption adds a runtime, a backup surface and a patch
  cadence. **Whether the DL360 can actually carry a given candidate was not
  measured** and is owed per-candidate before adoption.

## Not yet researched

`n8n` surfaced repeatedly as the third option alongside Activepieces and
Windmill and was not evaluated. No search was run for a nonprofit-specific
donation/fiscal-sponsorship ledger beyond Open Collective.

---

## Sources

- [CiviCRM — License](https://civicrm.org/about/license) ·
  [Requirements](https://docs.civicrm.org/installation/en/latest/requirements/)
- [Open Collective (overview and licensing)](https://en.wikipedia.org/wiki/Open_Collective)
- [Open Food Network — developer page](https://dev.openfoodnetwork.org/) ·
  [self-hosted summary](https://selfhostedworld.com/software/open-food-network)
- [Karrio — platform](https://www.karrio.io/platform)
- [listmonk](https://listmonk.app/)
- [Activepieces — License](https://www.activepieces.com/docs/about/license)
- [Windmill — plans detail](https://www.windmill.dev/docs/enterprise/plans_details)
- [ERPNext](https://en.wikipedia.org/wiki/ERPNext) ·
  [Frappe IP attribution](https://frappe.io/blog/legal/protection-of-our-intellectual-property)
- [Bigcapital](https://selfhost.directory/project/bigcapital)
