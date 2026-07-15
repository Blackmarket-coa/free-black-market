# @bmc/ui

Shared React component library for the [Free Black Market](../../README.md)
(FBM) vertical portals (`nursery-portal`, `wellness-portal`,
`botanical-portal`, `creator-portal`). Depends on `@bmc/portal-kit` for
underlying data/formatting logic.

## What's in here

Layout and data-display primitives shared across portals: `PageHeader`,
`Tabs`, `DataTable`, `MetricCard`, `EmptyState`, `QueryState`, `StubPage`,
`UrgentBanner`, `TierBadge`, `KarmaBar`, `MessageFeed` (Blackout/Matrix
feed).

## Usage

Consumed as a workspace dependency (`@bmc/ui`) by the portal apps — not
published or run standalone.
