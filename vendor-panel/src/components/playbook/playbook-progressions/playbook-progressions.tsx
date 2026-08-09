import { Badge, Container, Heading, Text } from "@medusajs/ui"

import {
  usePlaybookProgressions,
  type Progression,
  type ProgressionGroup,
} from "../../../hooks/api/playbook"

/**
 * "Where this can go" — the playbook progressions map.
 *
 * This is a map, not a prompt. It renders only where the seller opened it
 * (settings → playbook); it never appears on the dashboard, carries no badge or
 * counter, and ranks nothing by desirability. `docs/PLAYBOOK_SYSTEM.md` calls
 * the playbook system "the firewall that prevents solo sellers from being
 * conscripted into cooperation they did not ask for", and a vendor who stays
 * where they are is not behind.
 *
 * Every card shows what a move would cost as well as what it opens up. Showing
 * only the gains would make this an upsell rather than a map.
 */

/** Feature keys are an internal vocabulary; label them or fall back to the key. */
const FEATURE_LABELS: Record<string, string> = {
  hasProducts: "Products",
  hasInventory: "Inventory",
  hasSeasons: "Seasons",
  hasVolunteers: "Volunteers",
  hasMenu: "Menu",
  hasDeliveryZones: "Delivery zones",
  hasDonations: "Donations",
  hasSubscriptions: "Subscriptions",
  hasSupport: "Support",
  hasHarvests: "Harvests",
  hasPlots: "Plots",
  hasRequests: "Requests",
  hasFarm: "Farm profile",
  hasShows: "Shows",
}

const LISTING_TYPE_LABELS: Record<string, string> = {
  physical_product: "Physical",
  event: "Events",
  digital: "Digital",
  recurring: "Subscriptions",
  wholesale: "Wholesale",
  consignment: "Consignment",
  unique_inventory: "One-of-a-kind",
  bookable: "Bookable",
  campaign: "Campaigns",
}

const KIND_COPY: Record<Progression["kind"], string> = {
  replace: "Changes your playbook",
  add_role: "Adds a role — you stay what you are",
}

const label = (map: Record<string, string>, key: string) => map[key] ?? key

const ProgressionCard = ({
  edge,
  listingsChecked,
}: {
  edge: Progression
  listingsChecked: boolean
}) => {
  const { diff, preflight } = edge
  const stranded = preflight?.checked ? preflight.stranded_listing_count : 0

  return (
    <div className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Heading level="h3">{edge.to_display_name}</Heading>
        <Badge size="2xsmall" color={edge.kind === "add_role" ? "green" : "grey"}>
          {KIND_COPY[edge.kind]}
        </Badge>
      </div>

      <Text size="small">{edge.headline}</Text>

      <div className="flex flex-col gap-y-1">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
          Why people make this move
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          {edge.ceiling}
        </Text>
      </div>

      {(diff.listingTypesGained.length > 0 || diff.featuresGained.length > 0) && (
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            Opens up
          </Text>
          <div className="flex flex-wrap gap-1">
            {diff.listingTypesGained.map((t) => (
              <Badge key={`lt-${t}`} size="2xsmall" color="green">
                {label(LISTING_TYPE_LABELS, t)}
              </Badge>
            ))}
            {diff.featuresGained.map((f) => (
              <Badge key={`f-${f}`} size="2xsmall" color="green">
                {label(FEATURE_LABELS, f)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/*
        The half that keeps this honest. Moving from Stall to Kitchen drops
        digital, one-of-a-kind, and campaign listings from the playbook's
        defaults — someone deciding needs to see that next to the gains.
      */}
      {(diff.listingTypesLost.length > 0 || diff.featuresLost.length > 0) && (
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            No longer part of the playbook's defaults
          </Text>
          <div className="flex flex-wrap gap-1">
            {diff.listingTypesLost.map((t) => (
              <Badge key={`lt-${t}`} size="2xsmall" color="orange">
                {label(LISTING_TYPE_LABELS, t)}
              </Badge>
            ))}
            {diff.featuresLost.map((f) => (
              <Badge key={`f-${f}`} size="2xsmall" color="orange">
                {label(FEATURE_LABELS, f)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/*
        Existing products keep selling either way — allowed listing-types are
        checked when a product is written, not retroactively. Say so plainly,
        so a non-zero count reads as "plan for this" rather than "you'll lose
        these".
      */}
      {listingsChecked && stranded > 0 && (
        <div className="flex flex-col gap-y-1 rounded-md bg-ui-bg-subtle p-3">
          <Text size="xsmall" weight="plus">
            {stranded} of your listings would sit outside this playbook
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            They keep selling and keep fulfilling — nothing is removed. You would
            not be able to edit them without changing their listing type.
          </Text>
          {preflight?.stranded_listings.length ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {preflight.stranded_listings.map((l) => l.title).join(", ")}
              {stranded > preflight.stranded_listings.length ? ", …" : ""}
            </Text>
          ) : null}
        </div>
      )}

      {!listingsChecked && (
        <Text size="xsmall" className="text-ui-fg-muted">
          We couldn't check your listings against this playbook just now.
        </Text>
      )}

      {edge.real_world_prerequisites.length > 0 && (
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            Arranged outside FBM first
          </Text>
          <ul className="list-disc pl-4">
            {edge.real_world_prerequisites.map((p) => (
              <li key={p}>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {p}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edge.quest_key && (
        <Text size="xsmall" className="text-ui-fg-muted">
          There's a readiness quest that assembles the paperwork for this step.
        </Text>
      )}
    </div>
  )
}

const EngineGroup = ({
  group,
  listingsChecked,
}: {
  group: ProgressionGroup
  listingsChecked: boolean
}) => (
  <div className="flex flex-col gap-y-3">
    <Text size="small" weight="plus" className="text-ui-fg-subtle">
      {group.label}
    </Text>
    <div className="grid gap-3 md:grid-cols-2">
      {group.edges.map((edge) => (
        <ProgressionCard
          key={`${edge.from}-${edge.to}`}
          edge={edge}
          listingsChecked={listingsChecked}
        />
      ))}
    </div>
  </div>
)

export const PlaybookProgressions = () => {
  const { data, isLoading, isError } = usePlaybookProgressions()

  if (isLoading) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          Loading…
        </Text>
      </Container>
    )
  }

  if (isError) {
    return (
      <Container>
        <Text size="small" className="text-ui-fg-subtle">
          Couldn't load this just now.
        </Text>
      </Container>
    )
  }

  if (!data?.current_playbook) {
    return (
      <Container className="flex flex-col gap-y-2">
        <Heading level="h2">Where this can go</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Pick a playbook first and this will show what other shapes people
          commonly move into from there.
        </Text>
      </Container>
    )
  }

  return (
    <Container className="flex flex-col gap-y-6">
      <div className="flex flex-col gap-y-2">
        <Heading level="h2">Where this can go</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Some playbooks are rungs on the same ladder — a home kitchen that
          outgrows its permit, a solo maker who takes on partners, a garden plot
          that becomes a farm. This is the map, not a suggestion.{" "}
          <span className="text-ui-fg-muted">
            Staying exactly where you are is a normal, permanent answer.
          </span>
        </Text>
      </div>

      {data.is_terminal || data.groups.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          This playbook is the far end of every ladder we've mapped — it's what
          other vendors grow into, rather than a step toward something else.
        </Text>
      ) : (
        data.groups.map((group) => (
          <EngineGroup
            key={group.engine}
            group={group}
            listingsChecked={data.listings_checked}
          />
        ))
      )}

      {data.history.length > 0 && (
        <div className="flex flex-col gap-y-2 border-t border-ui-border-base pt-4">
          <Text size="small" weight="plus" className="text-ui-fg-subtle">
            Your playbook history
          </Text>
          {data.history.map((t) => (
            <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
              {t.from_recipe_id} → {t.to_recipe_id}
              {t.occurred_at
                ? ` · ${new Date(t.occurred_at).toLocaleDateString()}`
                : ""}
              {t.reason ? ` · ${t.reason}` : ""}
            </Text>
          ))}
        </div>
      )}
    </Container>
  )
}
