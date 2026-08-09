# Vendor Progressions

A **playbook** describes what a vendor is now (see `docs/PLAYBOOK_SYSTEM.md`).
Several playbooks are rungs on the same ladder: a home cook selling under a
cottage-food permit rents time in a shared commissary to get past their annual
cap, and eventually holds the lease on their own kitchen. Same person, three
playbooks, in order.

Until this document the playbook set was flat — eleven options, no ordering, no
`from`/`to`, nothing that said one playbook is where people commonly go from
another. This is that map.

The edges live in `backend/src/modules/playbook/progressions.ts`. Code is the
source of truth; the table below is kept in sync by
`backend/src/modules/playbook/__tests__/progressions.unit.spec.ts`, which fails
if the counts diverge.

## This describes, it does not prescribe

`docs/PLAYBOOK_SYSTEM.md` calls the playbook system "the firewall that prevents
solo sellers from being conscripted into cooperation they did not ask for."
Nothing built on this file may become a nag.

Concretely, that means:

- **No uninvited prompts.** The vendor-panel surface is opened from playbook
  settings; it does not appear on the dashboard, and it has no badge or counter.
- **No ranking by desirability.** Edges are grouped by engine, not sorted by
  how "advanced" a target is. There is no score.
- **Nothing is a funnel.** A Stall that stays a Stall forever is a success. The
  onboarding preview says so in as many words, so a first rung never reads as a
  lesser choice.
- **Losses are shown next to gains.** Stall allows `digital`,
  `unique_inventory`, and `campaign` listings; Kitchen does not. A surface that
  showed only what you'd gain would be an upsell, not a map.
- **No gate.** Nothing here blocks a switch, and switching never invalidates an
  existing product — allowed-listing-types is enforced on write, not
  retroactively (`shared/listing-type-guard.ts`).

This follows the same stance as the cottage-food module, whose non-blocking
contract is enforced by test, and the quest engine, whose quests are "never
auto-enrolled and never a prerequisite for selling."

## The four engines

Movement is driven by four different ceilings. An edge can sit on more than one.

| Engine | Ceiling | Shape |
|---|---|---|
| `facility` | Permit class plus the capital for a licensed space | Home → shared → own |
| `governance` | How many of you there are and how you decide | Solo → affinity → worker-owned → multi-stakeholder → federation |
| `land` | Tenure on ground | Borrowed plot → own ground with subscribers → aggregating growers |
| `audience` | What you have to offer | An audience, a skill, or a box of goods becoming a catalog |

`governance` is the one already latent in the codebase: `member_model` runs
`solo → flat → sociocratic → multi_stakeholder → federation`, in order, and the
picker's `SIMPLICITY_RANK` plus its tie-break rule ("Stall over Atelier; Atelier
over Workshop") are this same ladder used to choose a *default* rather than to
describe a *path*.

## Two kinds of move

- **`replace`** — the social form actually changed. Stall→Atelier, Harvest→Cycle.
- **`add_role`** — still what you were, plus something. Creator+Stall,
  Cycle+Kitchen, Kitchen+Hub.

`add_role` already works end to end: multi-role assignment unions each role's
default feature keys into `seller_metadata.enabled_extensions`, and the Stall
card already markets "Add more playbook roles later." A Creator who starts
selling merch does not stop being a Creator.

## The edges

23 edges, covering every playbook. `hub` has no outbound edges — it is the
terminal rung of all four engines, and is declared in `TERMINAL_PLAYBOOKS` so a
newly added playbook cannot silently sit unreachable.

| From | To | Kind | Engines | The move | Quest |
|---|---|---|---|---|---|
| stall | kitchen | replace | facility | Production moves out of the home kitchen into a licensed one | `compliance-tracker` |
| kitchen | hub | add_role | facility, governance | Rent idle kitchen hours to other cooks — become the commissary | |
| cycle | kitchen | add_role | facility | Turn what doesn't sell fresh into preserves, sauces, frozen shares | `compliance-tracker` |
| stall | atelier | replace | governance, facility | You're not working alone anymore; a few of you share a table or a kiln | |
| atelier | workshop | replace | governance | The crew owns the shop together, with patronage refunds | `coop-formation` |
| atelier | commons | replace | governance | Ownership opens beyond the people doing the work | `coop-formation` |
| workshop | commons | replace | governance | Buyers and supporters join the workers in ownership | `coop-formation` |
| workshop | hub | replace | governance | Aggregate other vendors and sell as one storefront | `wholesale-account` |
| commons | hub | replace | governance | Become the federation other co-ops route through | |
| grove | commons | replace | governance | A mutual-aid network becomes a community-owned institution | `coop-formation` |
| grove | hub | replace | governance | Coordinate distribution for other pantries and free stores | |
| service | workshop | replace | governance | The practice becomes worker-owned | `coop-formation` |
| harvest | stall | replace | land | Sell your own surplus under your own name | |
| harvest | cycle | replace | land | Ground of your own and members who subscribe to the season | `land-pooling` |
| harvest | grove | replace | land, audience | The point becomes distribution on solidarity terms | |
| harvest | workshop | replace | land, governance | The people tending the land own the operation together | `coop-formation` |
| cycle | hub | replace | land, governance | Aggregate other farms into your shares and routes | `wholesale-account` |
| creator | stall | add_role | audience | Put physical things in front of the audience you already have | |
| creator | atelier | replace | audience, governance | The work is a group's now — a recording or zine collective | |
| stall | creator | add_role | audience | The people who follow your work will pay for the work itself | |
| stall | service | add_role | audience | Sell your time as well as your output | |
| service | atelier | replace | audience, governance | A few practitioners share a space and a calendar | |
| service | grove | replace | audience | Offer the practice on solidarity terms — a repair café, a sliding-scale clinic | |

## The recurring shape: the graduate becomes the host

Every ladder ends the same way — you become the infrastructure you used.

- Home cook → rents a commissary → **runs one** (`kitchen_type: incubator`)
- Garden plot → own farm → **food hub** aggregating farms
- Solo maker → shares a studio → **worker-owned shop others join**
- Solo seller → co-op member → **federation hub**

`hub` is not a separate species. It is the top rung of all four engines, which
is why it is the only terminal playbook.

## Surfaces

| Surface | Where | Behaviour |
|---|---|---|
| Panel | `vendor-panel` playbook settings | Opened, never pushed. Grouped by engine, shows gains, losses, prerequisites, and the seller's own affected listings |
| Onboarding | Picker reveal step | A short "where this can lead" strip that states staying put is normal |
| Public | `storefront` `/vendor-types` | A "commonly leads to" line per card |

## Data

- `GET /vendor/playbook/progressions` — outbound edges for the caller's current
  playbook, each with the computed diff and a preflight count of the seller's
  listings the target would not allow. Returns `listings_checked: false` when
  the listing read failed, so a zero count is never mistaken for reassurance.
- `POST /vendor/playbook/assign` — accepts an optional `reason`; returns the
  `transition` that was written, or null when nothing changed.
- `playbook_transition` — append-only history, one row per change. First
  assignments write nothing (there is no `from`). Rows are written for
  undeclared moves too, with `matched_progression: false`, which is how we learn
  whether this edge set matches what vendors actually do.

## Adding an edge

1. Add it to `PROGRESSION_EDGES` in
   `backend/src/modules/playbook/progressions.ts`.
2. Add a row to the table above.
3. Run `pnpm test src/modules/playbook` — the drift guard checks ids, duplicates,
   quest keys, terminal coverage, and that the counts here match the code.

Gains and losses are computed from the recipes, so no edge ever restates a
feature list or a listing-type set.
