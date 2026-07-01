import { useState } from "react"
import { useInventory } from "@/hooks/useInventory"
import { PageHeader } from "@bmc/ui"
import { Tabs } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { DataTable, type Column } from "@bmc/ui"
import { BatchCard } from "@/components/inventory/BatchCard"
import { SpeciesIcon } from "@/components/inventory/SpeciesIcon"
import { NewBatchForm } from "@/components/inventory/NewBatchForm"
import type { InventoryItem, MotherPlant } from "@/types"
import { shortDate } from "@bmc/portal-kit"

export function InventoryPage() {
  const { data, isLoading, isError } = useInventory()
  const [tab, setTab] = useState("ready")
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState("")

  const readyCols: Column<InventoryItem>[] = [
    {
      key: "species",
      header: "Species",
      render: (r) => (
        <span className="text-cream-100">
          <SpeciesIcon name={r.species_name} /> {r.species_name}
        </span>
      ),
      sortValue: (r) => r.species_name,
    },
    { key: "method", header: "Method", render: (r) => <span className="capitalize text-mist">{r.method}</span>, sortValue: (r) => r.method },
    { key: "qty", header: "Qty", render: (r) => r.quantity, sortValue: (r) => r.quantity },
    { key: "pot", header: "Pot", render: (r) => r.pot_size ?? "—" },
    { key: "age", header: "Age", render: (r) => r.age_label ?? "—" },
    { key: "days", header: "Days in stock", render: (r) => r.days_in_stock ?? "—", sortValue: (r) => r.days_in_stock ?? 0 },
    {
      key: "actions",
      header: "",
      render: () => <button className="btn-primary text-xs">List on FBM</button>,
    },
  ]

  const motherCols: Column<MotherPlant>[] = [
    { key: "species", header: "Species", render: (r) => <span className="text-cream-100"><SpeciesIcon name={r.species_name} /> {r.species_name}</span>, sortValue: (r) => r.species_name },
    { key: "location", header: "Location", render: (r) => <span className="text-mist">{r.location}</span> },
    { key: "last", header: "Last harvest", render: (r) => shortDate(r.last_harvest_at), sortValue: (r) => r.last_harvest_at ?? "" },
    { key: "next", header: "Next window", render: (r) => <span className="text-mist">{r.next_harvest_window ?? "—"}</span> },
    { key: "yield", header: "Est. yield", render: (r) => r.estimated_yield ?? "—", sortValue: (r) => r.estimated_yield ?? 0 },
    { key: "actions", header: "", render: () => <button className="btn-ghost text-xs">Record harvest</button> },
  ]

  const filterReady = (items: InventoryItem[] = []) =>
    items.filter((i) => i.species_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="What you have, what's rooting, and your mother stock"
        action={
          <button className="btn-primary text-sm" onClick={() => setShowForm((s) => !s)}>
            + New batch
          </button>
        }
      />

      {showForm && (
        <div className="mb-4">
          <NewBatchForm onClose={() => setShowForm(false)} />
        </div>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "ready", label: "Ready to sell", count: data?.ready.length },
          { key: "prop", label: "In propagation", count: data?.in_propagation.length },
          { key: "mother", label: "Mother plants", count: data?.mother_plants.length },
        ]}
      />

      <QueryState isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {tab === "ready" && (
              <div className="space-y-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search species…"
                  className="w-full sm:w-64 bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 placeholder:text-ghost focus:outline-none focus:border-forest-600"
                />
                <DataTable
                  columns={readyCols}
                  rows={filterReady(data.ready)}
                  exportName="inventory-ready"
                  empty="Nothing ready to sell yet."
                />
              </div>
            )}

            {tab === "prop" && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.in_propagation.map((b) => (
                  <BatchCard key={b.id} batch={b} onPhoto={() => {}} />
                ))}
              </div>
            )}

            {tab === "mother" && (
              <DataTable
                columns={motherCols}
                rows={data.mother_plants}
                exportName="mother-plants"
                empty="No mother plants recorded."
              />
            )}
          </>
        )}
      </QueryState>
    </div>
  )
}
