import { Globe, Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  Heading,
  IconButton,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import {
  EmbedFeatureKey,
  FbmWebsite,
  useUpdateWebsiteDomains,
  useUpdateWebsiteFeatures,
} from "../../../hooks/api/website"
import { CodeBlock, Step } from "./shared"
import { KeysSection } from "./keys-section"
import { EmbedPreview } from "./embed-preview"

/** Bare-hostname validation that mirrors the backend normalizer. */
function cleanHost(input: string): string | null {
  let host = input.trim().toLowerCase()
  if (!host) return null
  host = host.replace(/^[a-z]+:\/\//, "")
  host = host.split("/")[0].split("?")[0]
  host = host.replace(/^www\./, "")
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d{2,5})?$/.test(host)) return null
  return host
}

const SDK_METHODS: Array<{ call: string; desc: string }> = [
  {
    call: "await FBM.getVendor()",
    desc: "Your profile: name, photo, bio, verified, links.",
  },
  {
    call: "await FBM.getProducts({ limit })",
    desc: "Products with _price + _cartUrl pre-computed.",
  },
  { call: "await FBM.getEvents({ limit })", desc: "Upcoming ticketed events." },
  {
    call: "FBM.renderProducts('#shop', { limit })",
    desc: "Inject a styled product grid.",
  },
  { call: "FBM.renderEvents('#events')", desc: "Inject a styled events list." },
  { call: "FBM.renderVendor('#me')", desc: "Inject your profile header." },
  {
    call: "FBM.renderReviews('#reviews')",
    desc: "Inject your verified-purchase reviews.",
  },
  {
    call: "FBM.renderBooking('#book', { product })",
    desc: "Calendar + slot picker for a bookable service (needs a key).",
  },
  {
    call: "FBM.openChat('#chat')",
    desc: "Message button that opens a Blackout chat (needs a key).",
  },
  {
    call: "FBM.cartUrl(product)",
    desc: "Deep-link into FBM checkout for a product.",
  },
  {
    call: "FBM.on('booking:confirmed', fn)",
    desc: "Listen for cart, order, and booking events.",
  },
]

/** Component catalog for the picker / preview. */
const COMPONENTS: Array<{ kind: EmbedFeatureKey; label: string; needsKey?: boolean; attrs?: string }> = [
  { kind: "vendor", label: "Profile header" },
  { kind: "products", label: "Product grid", attrs: ' data-fbm-limit="6"' },
  { kind: "digital", label: "Digital products" },
  { kind: "services", label: "Services" },
  { kind: "events", label: "Events" },
  { kind: "reviews", label: "Reviews" },
  { kind: "booking", label: "Booking", needsKey: true, attrs: ' data-fbm-product="prod_…"' },
  { kind: "chat", label: "Chat", needsKey: true },
]

export const ConnectPanel = ({ website }: { website: FbmWebsite }) => {
  const [domains, setDomains] = useState<string[]>(
    website.connect_domains || []
  )
  const [draft, setDraft] = useState("")
  const { mutate: saveDomains, isPending } = useUpdateWebsiteDomains()

  useEffect(() => {
    setDomains(website.connect_domains || [])
  }, [website.connect_domains])

  const { mutate: saveFeatures, isPending: isSavingFeatures } =
    useUpdateWebsiteFeatures()

  // Enabled surfaces persisted on the seller — the authoritative list of what
  // the embed shows, in catalog order. Default (all on) yields every kind.
  const enabledKeys = useMemo(
    () => COMPONENTS.filter((c) => website.embed_features?.[c.kind]).map((c) => c.kind),
    [website.embed_features]
  )

  const [picked, setPicked] = useState<EmbedFeatureKey[]>(enabledKeys)

  // Re-sync local toggles whenever the persisted selection changes (e.g. after
  // a save or a refetch).
  useEffect(() => {
    setPicked(enabledKeys)
  }, [enabledKeys])

  const togglePicked = (kind: EmbedFeatureKey) => {
    setPicked((cur) =>
      cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]
    )
  }

  const featuresDirty =
    JSON.stringify([...picked].sort()) !==
    JSON.stringify([...enabledKeys].sort())

  const persistFeatures = () => {
    // Preserve catalog order so the stored list is stable/readable.
    const ordered = COMPONENTS.filter((c) => picked.includes(c.kind)).map(
      (c) => c.kind
    )
    saveFeatures(ordered, {
      onSuccess: () => toast.success("Embed visibility saved"),
      onError: () => toast.error("Could not save embed visibility"),
    })
  }

  // Build the component markup from the picker, preserving catalog order.
  const componentSnippet = useMemo(() => {
    const lines = COMPONENTS.filter((c) => picked.includes(c.kind)).map(
      (c) => `<div data-fbm="${c.kind}"${c.attrs || ""}></div>`
    )
    return lines.length ? lines.join("\n") : '<div data-fbm="products"></div>'
  }, [picked])

  const addDomain = () => {
    const host = cleanHost(draft)
    if (!host) {
      toast.error("Enter a valid domain, e.g. shaktiinnergy.com")
      return
    }
    if (domains.includes(host)) {
      setDraft("")
      return
    }
    setDomains([...domains, host])
    setDraft("")
  }

  const removeDomain = (host: string) => {
    setDomains(domains.filter((d) => d !== host))
  }

  const persist = () => {
    saveDomains(domains, {
      onSuccess: () => toast.success("Connected domains saved"),
      onError: () => toast.error("Could not save domains"),
    })
  }

  const dirty =
    JSON.stringify([...domains].sort()) !==
    JSON.stringify([...(website.connect_domains || [])].sort())

  return (
    <div className="flex flex-col gap-y-8 py-6">
      <div>
        <Heading level="h2">Keep customers on your own site</Heading>
        <Text className="text-ui-fg-subtle mt-1" size="small">
          Drop one script tag onto any website — Squarespace, Webflow, Wix,
          WordPress, or raw HTML — and your FBM catalog and checkout show up
          right there. No developer needed.
        </Text>
      </div>

      <Step n={1} title="Paste this snippet before </body>">
        <CodeBlock code={website.snippet} />
        <Text className="text-ui-fg-muted mt-2" size="xsmall">
          That's it for the connection. The next steps are how you show things.
        </Text>
      </Step>

      <Step
        n={2}
        title="Create a publishable key (for booking, chat & analytics)"
      >
        <Text className="text-ui-fg-subtle mb-3" size="small">
          The catalog works keyless. Add a key to your snippet —{" "}
          <code className="bg-ui-bg-subtle rounded px-1">
            data-fbm-key="pk_live_…"
          </code>{" "}
          — to unlock bookings, chat, and analytics. Keys only work from the
          domains you whitelist in step&nbsp;4.
        </Text>
        <KeysSection />
      </Step>

      <Step n={3} title="Pick what to show — then preview it live">
        <Text className="text-ui-fg-subtle mb-2" size="small">
          These toggles control what your embed is allowed to show on your
          external site. Turn a surface off and it won't render anywhere — even
          if its markup is still on the page. Save to apply, then paste the
          markup below where each component should appear.
        </Text>
        <div className="mb-3 flex flex-wrap gap-2">
          {COMPONENTS.map((c) => {
            const on = picked.includes(c.kind)
            return (
              <Button
                key={c.kind}
                size="small"
                variant={on ? "primary" : "secondary"}
                onClick={() => togglePicked(c.kind)}
                type="button"
              >
                {c.label}
                {c.needsKey ? " 🔑" : ""}
              </Button>
            )
          })}
        </div>
        {featuresDirty && (
          <div className="mb-3">
            <Button
              size="small"
              onClick={persistFeatures}
              isLoading={isSavingFeatures}
              type="button"
            >
              Save visibility
            </Button>
          </div>
        )}
        <CodeBlock code={componentSnippet} />
        <div className="mt-3">
          <EmbedPreview website={website} components={picked} />
        </div>
      </Step>

      <Step n={4} title="Want full control? Use the JavaScript API">
        <Text className="text-ui-fg-subtle mb-3" size="small">
          Every method returns enriched objects with{" "}
          <code className="bg-ui-bg-subtle rounded px-1">_price</code> and{" "}
          <code className="bg-ui-bg-subtle rounded px-1">_cartUrl</code> already
          computed, so you can build any UI you like.
        </Text>
        <div className="border-ui-border-base divide-ui-border-base divide-y rounded-lg border">
          {SDK_METHODS.map((m) => (
            <div
              key={m.call}
              className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <code className="text-ui-fg-base bg-ui-bg-subtle shrink-0 rounded px-2 py-1 text-xs sm:w-80">
                {m.call}
              </code>
              <Text className="text-ui-fg-subtle" size="xsmall">
                {m.desc}
              </Text>
            </div>
          ))}
        </div>
      </Step>

      <Step n={5} title="Whitelist your domains (required for keys)">
        <Text className="text-ui-fg-subtle mb-3" size="small">
          The catalog API is public and read-only, so the snippet works
          everywhere immediately. Listing your domains here keeps a record of
          where you've embedded FBM.
        </Text>
        <div className="flex gap-2">
          <Input
            placeholder="shaktiinnergy.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addDomain()
              }
            }}
          />
          <Button variant="secondary" onClick={addDomain} type="button">
            Add
          </Button>
        </div>
        {domains.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {domains.map((d) => (
              <Badge key={d} size="small" className="flex items-center gap-1">
                <Globe className="text-ui-fg-muted" />
                {d}
                <IconButton
                  size="2xsmall"
                  variant="transparent"
                  onClick={() => removeDomain(d)}
                  aria-label={`Remove ${d}`}
                  type="button"
                >
                  <Trash />
                </IconButton>
              </Badge>
            ))}
          </div>
        )}
        {dirty && (
          <div className="mt-3">
            <Button
              size="small"
              onClick={persist}
              isLoading={isPending}
              type="button"
            >
              Save domains
            </Button>
          </div>
        )}
      </Step>
    </div>
  )
}
