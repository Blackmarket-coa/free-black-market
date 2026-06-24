import { Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  IconButton,
  Input,
  Prompt,
  Text,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import {
  useCreateEmbedKey,
  useEmbedKeys,
  useRevokeEmbedKey,
} from "../../../hooks/api/embed-keys"
import { CodeBlock } from "./shared"

/**
 * Publishable-key manager. Keys unlock the booking, chat, and analytics embed
 * features (origin-validated against your whitelisted domains). The plaintext
 * key is shown exactly once at creation — afterward only a masked form is kept.
 */
export const KeysSection = () => {
  const { keys, isPending } = useEmbedKeys()
  const { mutate: createKey, isPending: creating } = useCreateEmbedKey()
  const { mutate: revokeKey } = useRevokeEmbedKey()

  const [label, setLabel] = useState("")
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)

  const onCreate = () => {
    createKey(
      { label: label.trim() || undefined },
      {
        onSuccess: (data) => {
          setRevealKey(data.key)
          setLabel("")
        },
        onError: () => toast.error("Could not create key"),
      }
    )
  }

  const onRevoke = (id: string) => {
    revokeKey(id, {
      onSuccess: () => toast.success("Key revoked"),
      onError: () => toast.error("Could not revoke key"),
    })
    setRevokeId(null)
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="Key label (e.g. Squarespace site)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onCreate()
            }
          }}
        />
        <Button
          variant="secondary"
          onClick={onCreate}
          isLoading={creating}
          type="button"
        >
          Create key
        </Button>
      </div>

      {!isPending && keys.length === 0 && (
        <Text className="text-ui-fg-muted mt-3" size="xsmall">
          No keys yet. Create one to enable booking, chat, and analytics on your
          embed.
        </Text>
      )}

      {keys.length > 0 && (
        <div className="border-ui-border-base divide-ui-border-base mt-3 divide-y rounded-lg border">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <code className="text-ui-fg-base bg-ui-bg-subtle rounded px-2 py-0.5 text-xs">
                    {k.masked}
                  </code>
                  {k.label && (
                    <Text className="text-ui-fg-subtle" size="xsmall">
                      {k.label}
                    </Text>
                  )}
                  {!k.active && (
                    <Badge size="2xsmall" color="red">
                      Revoked
                    </Badge>
                  )}
                </div>
                <Text className="text-ui-fg-muted" size="xsmall">
                  {k.last_used_at
                    ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                    : "Never used"}
                </Text>
              </div>
              {k.active && (
                <IconButton
                  size="small"
                  variant="transparent"
                  onClick={() => setRevokeId(k.id)}
                  aria-label="Revoke key"
                  type="button"
                >
                  <Trash />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}

      {/* One-time reveal of the plaintext key. */}
      <Prompt open={!!revealKey} onOpenChange={(o) => !o && setRevealKey(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Copy your new key now</Prompt.Title>
            <Prompt.Description>
              This is the only time the full key is shown. Store it somewhere
              safe — you can revoke it and create a new one anytime.
            </Prompt.Description>
          </Prompt.Header>
          <div className="px-6 pb-2">
            {revealKey && <CodeBlock code={revealKey} />}
          </div>
          <Prompt.Footer>
            <Button onClick={() => setRevealKey(null)}>Done</Button>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>

      {/* Revoke confirmation. */}
      <Prompt open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Revoke this key?</Prompt.Title>
            <Prompt.Description>
              Any site using this key will immediately stop being able to take
              bookings, chats, or report analytics. This cannot be undone.
            </Prompt.Description>
          </Prompt.Header>
          <Prompt.Footer>
            <Prompt.Cancel>Cancel</Prompt.Cancel>
            <Prompt.Action onClick={() => revokeId && onRevoke(revokeId)}>
              Revoke
            </Prompt.Action>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </div>
  )
}
