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
import { useEffect, useState } from "react"
import { FbmWebsite, useUpdateWebsiteDomains } from "../../../hooks/api/website"
import { CodeBlock, Step } from "./shared"

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
    call: "FBM.cartUrl(product)",
    desc: "Deep-link into FBM checkout for a product.",
  },
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

  const zeroJsExample = [
    "<!-- Your profile header -->",
    '<div data-fbm="vendor"></div>',
    "",
    "<!-- A grid of your products -->",
    '<div data-fbm="products" data-fbm-limit="6"></div>',
    "",
    "<!-- Your upcoming events -->",
    '<div data-fbm="events"></div>',
  ].join("\n")

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

      <Step n={2} title="Show your store — no code required">
        <Text className="text-ui-fg-subtle mb-2" size="small">
          Paste any of these where you want them to appear. They render
          themselves and stay in sync with your catalog.
        </Text>
        <CodeBlock code={zeroJsExample} />
      </Step>

      <Step n={3} title="Want full control? Use the JavaScript API">
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

      <Step n={4} title="Whitelist your domains (optional)">
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
