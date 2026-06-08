import { useEffect, useState } from "react"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { backendUrl, getAuthToken } from "../../lib/client"

interface PluginRow {
  slug: string
  name: string
  category: string
  description: string
  install_count: number
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const url = `${backendUrl.replace(/\/$/, "")}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`${res.status}: ${res.statusText}`)
  }
  return (await res.json()) as T
}

const categoryColor = (c: string) => {
  if (c === "ANALYTICS") return "blue" as const
  if (c === "AUTOMATION") return "green" as const
  return "purple" as const
}

export const PluginsPage = () => {
  const [available, setAvailable] = useState<PluginRow[]>([])
  const [installed, setInstalled] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const data = await authedFetch<{
        installed: string[]
        available: PluginRow[]
      }>("/v1/seller/plugins/installed")
      setInstalled(data.installed || [])
      setAvailable(data.available || [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const install = async (slug: string) => {
    setBusy(slug)
    try {
      const data = await authedFetch<{ installed: string[] }>(
        `/v1/seller/plugins/${slug}/install`,
        { method: "POST", body: "{}" }
      )
      setInstalled(data.installed || [])
      toast.success("Plugin installed")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Plugins</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Marketplace extensions, analytics, and automation tools for your shop.
        </Text>
      </div>

      {loading && (
        <div className="px-6 py-4">
          <Text size="small">Loading…</Text>
        </div>
      )}

      <div className="flex flex-col divide-y">
        {available.map((p) => {
          const isInstalled = installed.includes(p.slug)
          return (
            <div
              key={p.slug}
              className="flex items-center justify-between px-6 py-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Text weight="plus">{p.name}</Text>
                  <Badge color={categoryColor(p.category)} size="2xsmall">
                    {p.category.toLowerCase().replace("_", " ")}
                  </Badge>
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {p.description}
                </Text>
              </div>
              {isInstalled ? (
                <Badge color="green">Installed</Badge>
              ) : (
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy === p.slug}
                  onClick={() => install(p.slug)}
                >
                  {busy === p.slug ? "Installing…" : "Install"}
                </Button>
              )}
            </div>
          )
        })}
        {!loading && available.length === 0 && (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No plugins available yet.
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}
