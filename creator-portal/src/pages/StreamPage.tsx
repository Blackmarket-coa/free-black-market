import { useState } from "react"
import { PageHeader } from "@bmc/ui"
import { useOverlayUrl } from "@/hooks/useCreatorData"
import { dateTime } from "@bmc/portal-kit"
import type { OverlayUrlResponse } from "@/types"

export function StreamPage() {
  const overlay = useOverlayUrl()
  const [data, setData] = useState<OverlayUrlResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  function generate() {
    overlay.mutate(undefined, { onSuccess: (r) => setData(r) })
  }

  function copy() {
    if (!data) return
    navigator.clipboard?.writeText(data.overlay_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stream"
        subtitle="Generate a signed OBS overlay URL that surfaces tips, boosts, and new members live on stream."
      />

      <section className="panel-pad space-y-3">
        <div className="heading text-sm text-cream-50">OBS browser-source overlay</div>
        <p className="text-xs text-mist">
          The overlay is served by your Blackout Space and signed by FBM. The
          token expires after 24 hours — regenerate before long streams.
        </p>

        {!data ? (
          <button className="btn-primary text-sm" onClick={generate} disabled={overlay.isPending}>
            {overlay.isPending ? "Generating…" : "Generate overlay URL"}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                readOnly
                value={data.overlay_url}
                className="flex-1 bg-soil border border-moss rounded-sm px-3 py-1.5 text-xs text-cream-100 focus:outline-none focus:border-amber-600"
              />
              <button className="btn-primary text-sm" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-ghost">Expires {dateTime(data.expires_at)}</span>
              <button className="btn-ghost text-xs" onClick={generate} disabled={overlay.isPending}>
                Regenerate
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowPreview((s) => !s)}>
                {showPreview ? "Hide preview" : "Open preview"}
              </button>
            </div>
            <p className="text-[11px] text-mist">{data.instructions}</p>
          </div>
        )}

        {overlay.isError && (
          <div className="text-xs text-clay">
            Couldn't generate the overlay URL. The overlay may be unconfigured
            (BLACKOUT_OVERLAY_SECRET) or your session expired.
          </div>
        )}
      </section>

      {data && showPreview && (
        <section className="panel-pad">
          <div className="heading text-sm text-cream-50 mb-2">Preview (1920×1080, scaled)</div>
          {/* Scaled-down OBS capture preview. */}
          <div className="overflow-hidden rounded-sm border border-moss" style={{ width: 576, height: 324 }}>
            <iframe
              title="overlay-preview"
              src={data.overlay_url}
              width={1920}
              height={1080}
              style={{ transform: "scale(0.3)", transformOrigin: "top left", border: "0" }}
            />
          </div>
          <p className="text-[11px] text-ghost mt-2">
            If the preview is blank, the overlay page is served by Blackout in
            production — it won't render against a local-only setup.
          </p>
        </section>
      )}
    </div>
  )
}
