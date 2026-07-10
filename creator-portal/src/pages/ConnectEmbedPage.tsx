import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { MetricCard } from "@bmc/ui"
import { QueryState } from "@bmc/ui"
import { useEmbedConfig } from "@/hooks/useCreatorData"
import { classNames } from "@bmc/portal-kit"

const THEMES = ["warm", "forest", "minimal", "dark"] as const

export function ConnectEmbedPage() {
  const { data, isLoading, isError } = useEmbedConfig()
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("warm")
  const [copied, setCopied] = useState(false)

  function copy(snippet: string) {
    navigator.clipboard?.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Embed (connect.js)"
        subtitle="Embed your memberships and drops on your own site with the connect.js SDK."
      />
      <QueryState isLoading={isLoading} isError={isError}>
        {data && (() => {
          const themedSnippet = data.snippet.replace(
            'data-fbm-theme="warm"',
            `data-fbm-theme="${theme}"`
          )
          return (
          <>
            <section className="panel-pad space-y-2">
              <div className="flex items-center justify-between">
                <div className="heading text-sm text-cream-50">Embed snippet</div>
                <span className="text-xs text-ghost">Key: {data.masked_key ?? "none yet"}</span>
              </div>
              <pre className="bg-soil border border-moss rounded-sm p-3 text-xs text-mist overflow-x-auto scroll-area whitespace-pre">
                {themedSnippet}
              </pre>
              <div className="flex gap-2">
                <button onClick={() => copy(themedSnippet)} className="btn-primary text-sm">
                  {copied ? "Copied!" : "Copy snippet"}
                </button>
              </div>
            </section>

            <section className="panel-pad">
              <div className="heading text-sm text-cream-50 mb-2">Appearance</div>
              <div className="flex gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={classNames(
                      "px-3 py-1.5 rounded-sm text-sm capitalize border",
                      theme === t ? "border-amber-600 text-cream-50 bg-amber-900/20" : "border-moss text-mist"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid md:grid-cols-2 gap-4">
              <div className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-2">What's embedded</div>
                <div className="space-y-1.5 text-sm">
                  {[...data.embeddable.memberships, ...data.embeddable.products].map((o) => (
                    <div key={o.id} className="flex items-center justify-between">
                      <span className="text-cream-100">{o.name}</span>
                      <span className={o.embedded ? "text-amber-400 text-xs" : "text-ghost text-xs"}>
                        {o.embedded ? "Embedded" : "Hidden"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel-pad">
                <div className="heading text-sm text-cream-50 mb-2">Embed analytics</div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label="Views" value={data.analytics.views} />
                  <MetricCard label="Clicks → FBM" value={data.analytics.clicks} />
                  <MetricCard label="Purchases" value={data.analytics.purchases} />
                  <MetricCard label="Conversion" value={`${data.analytics.conversion_pct}%`} />
                </div>
              </div>
            </section>
          </>
          )
        })()}
      </QueryState>
    </div>
  )
}
