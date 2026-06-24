import { Text } from "@medusajs/ui"
import { useMemo } from "react"
import { FbmWebsite } from "../../../hooks/api/website"

/**
 * Live, sandboxed preview of the vendor's embed. We render the real connect.js
 * SDK against the public catalog API inside an isolated iframe (sandboxed to
 * scripts only — no same-origin access to the panel). Booking/chat appear but
 * stay inert here since no publishable key is injected into the preview.
 */
export const EmbedPreview = ({
  website,
  components,
}: {
  website: FbmWebsite
  components: string[]
}) => {
  const srcDoc = useMemo(() => {
    const blocks = (components.length ? components : ["products"])
      .map((kind) => {
        const attrs =
          kind === "products"
            ? ' data-fbm-limit="6"'
            : kind === "booking"
              ? ' data-fbm-product="preview"'
              : ""
        return `<div data-fbm="${kind}"${attrs}></div>`
      })
      .join("\n")

    return `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:14px;color:#111}</style>
</head><body>
${blocks}
<script src="${website.sdk_url}"
        data-fbm-vendor="${website.handle}"
        data-fbm-api="${website.api_base}"
        data-fbm-storefront="${website.storefront_url}"></script>
</body></html>`
  }, [components, website])

  return (
    <div className="border-ui-border-base overflow-hidden rounded-lg border">
      <div className="bg-ui-bg-subtle border-ui-border-base flex items-center justify-between border-b px-3 py-1.5">
        <Text size="xsmall" className="text-ui-fg-muted">
          Live preview
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {website.handle}
        </Text>
      </div>
      <iframe
        title="FBM embed preview"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-[420px] w-full bg-white"
      />
    </div>
  )
}
