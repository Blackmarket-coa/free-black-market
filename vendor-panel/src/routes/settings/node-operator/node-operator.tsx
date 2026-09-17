import { useState } from "react"
import {
  Button,
  Container,
  Heading,
  Prompt,
  Switch,
  Text,
  Tooltip,
  toast,
} from "@medusajs/ui"

import { CodeBlock } from "../../my-website/components/shared"
import {
  useNodeOperator,
  useSetNodeOperatorOptIn,
} from "../../../hooks/api/node-operator"

/**
 * Run deliveries through Blackstar.
 *
 * The opt-in is asked during onboarding, and this is the "or later" surface —
 * a seller who did not tick it then, or who wants to stop, does it here.
 *
 * It is also the only place a node credential is ever visible. The secret is
 * stored encrypted with no read-back path, so it is shown exactly once at
 * issue and afterwards only the key id appears. Losing it means re-issuing,
 * which is why the toggle can be turned on again while already on.
 */
export const NodeOperator = () => {
  const { node_operator, isPending } = useNodeOperator()
  const [revealSecret, setRevealSecret] = useState<string | null>(null)

  const { mutate, isPending: isSaving } = useSetNodeOperatorOptIn({
    onSuccess: (data) => {
      const secret = data.node_operator.secret
      if (secret) {
        setRevealSecret(secret)
        return
      }
      toast.success(
        data.node_operator.opted_in
          ? "Node operating is on."
          : "Node operating is off. Your credential has been revoked."
      )
    },
    onError: (error) => {
      toast.error(error.message || "Could not save that. Try again.")
    },
  })

  const optedIn = node_operator?.opted_in === true
  const credential = node_operator?.credential ?? null

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Run deliveries</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1 max-w-[560px]">
            Carry shipments for the network through Blackstar. Turning this on
            registers you as a node operator and issues the credential your node
            signs with. You can sell whatever you already sell — this is in
            addition, not instead.
          </Text>
        </div>
        <Switch
          checked={optedIn}
          disabled={isPending || isSaving}
          onCheckedChange={(checked) => mutate({ opted_in: checked })}
        />
      </div>

      {optedIn && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus">
            Your node credential
          </Text>
          <div className="mt-3 flex items-center justify-between gap-4">
            {credential ? (
              <div>
                <Text size="small" className="font-mono">
                  {credential.key_id}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  {credential.issued_at
                    ? `Issued ${new Date(credential.issued_at).toLocaleDateString()}`
                    : "Issued"}
                  {" · the secret is only shown once, when it is issued"}
                </Text>
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No active credential yet.
              </Text>
            )}
            <Tooltip
              content={
                credential
                  ? "Issues a new credential and revokes this one. Your node must be updated with the new secret."
                  : "Issues a credential and shows its secret once."
              }
            >
              <Button
                size="small"
                variant="secondary"
                disabled={isSaving}
                onClick={() => mutate({ opted_in: true })}
              >
                {credential ? "Rotate" : "Issue credential"}
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* One-time reveal. There is no read-back path for this value. */}
      <Prompt open={!!revealSecret} onOpenChange={(o) => !o && setRevealSecret(null)}>
        <Prompt.Content>
          <Prompt.Header>
            <Prompt.Title>Copy your node secret now</Prompt.Title>
            <Prompt.Description>
              This is the only time it is shown. Put it in your node&apos;s
              configuration before closing this — if you lose it, rotate to
              issue a new one.
            </Prompt.Description>
          </Prompt.Header>
          <div className="px-6 pb-2">
            {revealSecret && <CodeBlock code={revealSecret} />}
          </div>
          <Prompt.Footer>
            <Button onClick={() => setRevealSecret(null)}>Done</Button>
          </Prompt.Footer>
        </Prompt.Content>
      </Prompt>
    </Container>
  )
}
