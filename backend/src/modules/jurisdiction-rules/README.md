# Jurisdiction Rules Module

What FBM's archived sources say about selling food made at home in a given
state, one rule per row. Phase 2 of the Plates pilot
(`docs/PLATES_SC_PILOT_PLAN.md`). South Carolina is the first state; every
other state reads "not covered".

Registration key: `JURISDICTION_RULES_MODULE` (`"jurisdictionRulesModuleService"`).
Import it from `./index`; never type it.

## What it is for

The cottage-food module ships no state-law table: its profile is the seller's
own declaration, and that stays true. This module is where *sourced* rule text
lives instead. A rule here always carries:

- the wording FBM shows (`display_text`);
- the source's own words, verbatim (`citations[].quote`), with the document
  and where in it to look;
- the document it came from: issuer, title, document id, printed date, and
  the SHA-256 of the archived file;
- whether the wording has been reviewed against the document, by whom and
  when.

A date or document id the source does not print is stored as null and shown
as "not stated". Nothing is inferred to fill a gap.

## Three decisions

**1. Rules are information only.**

Nothing here blocks a sale, touches a cart or a checkout, or returns a verdict
about a seller. A rule of kind `prohibition` is a sentence for a person to
read. `__tests__/information-only.unit.spec.ts` pins the complete list of files
that read this module and fails if anything on the cart, checkout or order
path joins it.

**2. A version's content is written once.**

A rule is (`jurisdiction_code`, `program`, `rule_key`). Each change of wording
is a new row with the next `version`; nothing edits an existing one. What
changes on a row is only its place in the history:

| Standing | Meaning |
|---|---|
| `pending_draft` | proposed, not yet reviewed; at most one per rule |
| `reviewed_in_force` | reviewed and current; at most one per rule |
| `superseded` | replaced by a later version |
| `withdrawn` | taken down, with who, when and why |

A reviewed version stays in force while a correction to it waits as a draft,
and is superseded only when the correction is itself reviewed.

The service has three writers of a rule (`createDraftVersion`, `markReviewed`,
`withdrawRule`) and closes every generated `create*` / `update*` / `delete*` /
`softDelete*` / `restore*` method. Under it, three partial unique indexes hold
the "at most one" rules, CHECK constraints refuse a row with no citation or
with a review record that does not add up, and on a database built from the
migration triggers hold the history whoever writes: a rule version is
inserted only as a draft, never deleted or soft-deleted, and its content, a
review record, a supersession and a withdrawal never change once written; a
source is never updated or deleted; a coverage row is never deleted or
re-pointed, and its required keys only grow.

**3. A sign-off names the text, not only the row.**

`content_sha256` is the SHA-256 of a version's canonical content
(`content-hash.ts`), including the hash of every file it cites. A reviewer
sends back the hash of the text they were shown, and `markReviewed` is one
conditional UPDATE that matches only while that version is still the pending
draft carrying that hash. Anything else writes nothing.

Who reviewed is the authenticated admin, passed in by the route from the
session; the user id, name and email the user module returns are recorded.
No request body can name a reviewer. Who *may* review is the operator's
allowlist of admin **user ids**, `JURISDICTION_RULE_REVIEWER_USER_IDS`
(`src/api/admin/jurisdiction-rules/reviewers.ts`); unset means nobody. Not
emails: a deleted admin's email can be registered again by another admin,
while a user id is never reused.

Readers are shown, for each citation, the copy of the document's details
signed with the version, not the live source row; and a version whose stored
content no longer hashes to its `content_sha256` is never shown or counted as
reviewed. Every key coverage requires has a place in a reader's list: its
rule, or a placeholder saying there is nothing to show (withdrawn, or its
text unavailable).

## Coverage

`jurisdiction_coverage` has one row per (jurisdiction, program) that a seed
has opened, with the rule keys coverage requires. Its status is computed
(`coverage.ts`), in the same transaction as every change to the rules, and
never set:

- `not_covered`: nothing on file. A state with no row reads this.
- `draft`: rules on file, at least one required key without a reviewed
  version in force.
- `covered`: every required key has a reviewed version in force.
- `withdrawn`: rules were on file and all have been withdrawn.

There is no route that sets a status or changes the required keys.

## `not_stated`

A rule can say that the sources are silent. `sales.online_delivery` for South
Carolina is one: neither archived document addresses online orders, shipping
or delivery. Such a rule cites the documents that were read in full, carries
no quote, and is reviewed like any other. A reviewed `not_stated` rule is the
reviewer confirming the absence.

## Sources and the seed

A source is a file archived in the repository (`docs/sources/<state>/`) and
its hash. Sources, the opening of a jurisdiction and version 1 of its rules
come from a seed, run by the operator:

```bash
pnpm medusa exec ./src/scripts/seed-jurisdiction-rules.ts
```

The seed is additive and safe to run again. It never writes a review field,
never adds a version to a rule that already has one, and never edits a source
on file. After it has run, the database is the source of truth: the fixture
in `seeds/` is only version 1, and a correction goes through
`POST /admin/jurisdiction-rules`.

There is no route that adds a source. A new document is archived and hashed in
a pull request, added to the seed's source list, and recorded by running the
seed again.

Read `seeds/us-sc-home-based-food.ts` before adding a state: its header lists
the ways the South Carolina documents invite a wrong reading.

## Routes

Admin, not behind a flag (sign-off happens before launch):

| Route | |
|---|---|
| `GET /admin/jurisdiction-rules` | every version, with history |
| `POST /admin/jurisdiction-rules` | propose a draft version (any admin) |
| `GET /admin/jurisdiction-rules/:id` | one version, its history, its sources |
| `POST /admin/jurisdiction-rules/:id/review` | sign off (allowlisted admin user; 403 otherwise, 409 on a stale hash) |
| `POST /admin/jurisdiction-rules/:id/withdraw` | withdraw (any admin user) |
| `GET /admin/jurisdiction-sources` | archived documents |
| `GET /admin/jurisdiction-coverage` | every state's coverage |

Seller, behind `FF_PLATES_V1` (404 when off):

| Route | |
|---|---|
| `GET /vendor/plates/jurisdictions` | every state with its coverage |
| `GET /vendor/plates/jurisdictions/:code` | the rules in force, drafts marked |

## Tests

- Unit: `__tests__/*.unit.spec.ts` (normaliser, hash, coverage, draft rules,
  fixture shape, migration shape, the information-only contract), and the
  route specs beside the routes.
- Module integration, on Postgres with the schema built from the models:
  `__tests__/jurisdiction-rules.integration.spec.ts`.
- HTTP integration, on a database built from the migrations:
  `integration-tests/http/jurisdiction-rules-signoff.spec.ts`.
