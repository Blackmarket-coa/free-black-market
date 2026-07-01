import { useState } from "react"
import { useActivePathways } from "@/hooks/useActivePathways"
import { usePathwayTemplates } from "@/hooks/usePathwayTemplates"
import { PageHeader } from "@/components/ui/PageHeader"
import { QueryState } from "@/components/ui/QueryState"
import { COMPLIANCE_FRAMEWORKS, iconForOutput } from "@/lib/pathways"
import { classNames } from "@bmc/portal-kit"
import type { PathwayTemplate } from "@/types"

// Onboarding surface: the maker shapes everything else here by activating one or
// more production pathways. Lead with "what do you make?" — not regulation.
export function PathwaysPage() {
  const { data: pathways = [], isLoading, isError } = useActivePathways()
  const { data: templates = [] } = usePathwayTemplates()
  const [selected, setSelected] = useState<PathwayTemplate | null>(null)

  return (
    <div>
      <PageHeader
        title="Production Pathways"
        subtitle="Configure what you make. Each pathway adapts compliance, labeling, and workflow to its product type."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        <div className="space-y-8">
          {/* SECTION 1 — active pathways */}
          <section>
            <h2 className="heading text-base mb-3">Active pathways</h2>
            {pathways.length === 0 ? (
              <div className="panel-pad text-sm text-mist">
                No pathways yet. Pick a template below to get started.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pathways.map((p) => {
                  const fw = COMPLIANCE_FRAMEWORKS[p.compliance_framework_id]
                  return (
                    <div key={p.id} className="panel-pad">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{iconForOutput(p.output_category)}</span>
                          <div>
                            <div className="text-sm font-medium text-cream-50">{p.name}</div>
                            <div className="text-[11px] text-ghost">{fw.name}</div>
                          </div>
                        </div>
                        {p.batch_number_prefix && (
                          <span className="text-[10px] font-mono text-forest-300 border border-forest-700 rounded-sm px-1.5 py-0.5">
                            {p.batch_number_prefix}-
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex gap-4 text-xs text-mist">
                        <span>{p.formula_count ?? 0} formulas</span>
                        <span>{p.active_run_count ?? 0} active runs</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.requires_ph_testing && <Tag>pH testing</Tag>}
                        {(p.default_cure_time_days ?? 0) > 0 && (
                          <Tag>{p.default_cure_time_days}d cure</Tag>
                        )}
                        {p.counts_toward_cottage_food_limit && <Tag>Cottage food</Tag>}
                        {p.coa_required_for_wholesale && <Tag>COA</Tag>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* SECTION 2 — add a pathway from a template */}
          <section>
            <h2 className="heading text-base mb-1">Add a pathway</h2>
            <p className="text-sm text-mist mb-3">
              Start from a template. You can rename it and adjust the details in the next step.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className={classNames(
                    "text-left panel-pad transition-colors hover:border-forest-600",
                    selected?.id === t.id && "border-forest-500 bg-forest-900/20"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{t.icon}</span>
                    <span className="text-sm font-medium text-cream-50">{t.name}</span>
                  </div>
                  <p className="text-xs text-mist mt-2">{t.blurb}</p>
                  <p className="text-[11px] text-ghost mt-2">{t.compliance_note}</p>
                </button>
              ))}
            </div>
          </section>

          {/* SECTION 3 + 4 — configure + compliance reference */}
          {selected && (
            <ConfigurePanel template={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      </QueryState>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] rounded-sm bg-moss text-mist px-1.5 py-0.5">{children}</span>
  )
}

// Configure step. In the mock build this previews the template-derived defaults
// (editable locally); wiring POST /vendor/botanical/pathways is a follow-up.
function ConfigurePanel({
  template,
  onClose,
}: {
  template: PathwayTemplate
  onClose: () => void
}) {
  const fw = COMPLIANCE_FRAMEWORKS[template.compliance_framework_id]
  const [name, setName] = useState(template.name)
  const [prefix, setPrefix] = useState(template.batch_number_prefix ?? "")
  const [cure, setCure] = useState(template.default_cure_time_days ?? 0)
  const [cottage, setCottage] = useState(template.counts_toward_cottage_food_limit)

  return (
    <section className="grid lg:grid-cols-2 gap-4">
      {/* Configure */}
      <div className="panel-pad">
        <div className="flex items-center justify-between mb-3">
          <h3 className="heading text-sm">
            {template.icon} Configure “{template.name}”
          </h3>
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Pathway name (your name for this line)">
            <input
              className="w-full bg-soil border border-moss rounded-sm px-2 py-1.5 text-sm text-cream-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Compliance framework">
            <div className="text-sm text-cream-100">{fw.name}</div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch prefix (2–4 chars)">
              <input
                className="w-full bg-soil border border-moss rounded-sm px-2 py-1.5 text-sm text-cream-100 font-mono"
                value={prefix}
                maxLength={4}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Cure time (days)">
              <input
                type="number"
                min={0}
                className="w-full bg-soil border border-moss rounded-sm px-2 py-1.5 text-sm text-cream-100"
                value={cure}
                onChange={(e) => setCure(Number(e.target.value))}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-cream-100">
            <input
              type="checkbox"
              checked={cottage}
              onChange={(e) => setCottage(e.target.checked)}
            />
            Counts toward cottage food limit
          </label>
          {template.shelf_life_note && (
            <Field label="Shelf life">
              <div className="text-xs text-mist">{template.shelf_life_note}</div>
            </Field>
          )}
          <button className="btn-primary w-full mt-1" disabled>
            Activate pathway (backend follow-up)
          </button>
        </div>
      </div>

      {/* Compliance reference (read-only) */}
      <div className="panel-pad">
        <h3 className="heading text-sm mb-2">{fw.name}</h3>
        <p className="text-sm text-mist">{fw.summary}</p>

        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ghost mb-1">
            Required label fields
          </div>
          <ul className="text-sm text-cream-100 list-disc list-inside space-y-0.5">
            {fw.label_required_fields.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>

        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ghost mb-1">
            Claim rules
          </div>
          <p className="text-sm text-cream-100">
            {fw.forbidden_patterns.length > 0
              ? `${fw.forbidden_patterns.length} forbidden claim patterns enforced by the claim checker.`
              : "No claim restrictions for this framework."}
            {fw.disclaimer_required && " A disclaimer is required on the label."}
          </p>
        </div>

        {fw.facility_requirements.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-ghost mb-1">
              Facility
            </div>
            <ul className="text-sm text-cream-100 list-disc list-inside space-y-0.5">
              {fw.facility_requirements.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {fw.source_url && (
          <a
            href={fw.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-forest-300 mt-3 inline-block"
          >
            Official source →
          </a>
        )}
        <p className="text-[11px] text-ghost mt-3">
          BMC provides general guidance only, not legal advice.
        </p>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ghost mb-1">{label}</div>
      {children}
    </div>
  )
}
