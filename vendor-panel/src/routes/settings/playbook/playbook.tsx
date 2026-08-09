import { Badge, Container, Heading, Text } from "@medusajs/ui"

import { usePlaybookAssignment } from "../../../hooks/api/playbook"
import { PlaybookProgressions } from "../../../components/playbook/playbook-progressions"
import { PLAYBOOK_DISPLAY_NAMES } from "../../../components/playbook/playbook-picker"

/**
 * Settings → Playbook.
 *
 * Shows the seller which playbook they're on, and — below it — the map of what
 * other shapes people commonly move into from there. The map lives here, behind
 * a deliberate navigation, rather than anywhere a seller would meet it without
 * asking.
 */
export const PlaybookSettings = () => {
  const { data, isLoading } = usePlaybookAssignment()
  const assignment = data?.playbook_assignment
  const roles = assignment?.metadata?.roles ?? []

  return (
    <div className="flex w-full flex-col gap-y-3">
      <Container className="flex flex-col gap-y-3">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">Your playbook</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            A playbook is the shape of your operation — who's selling, how you
            decide things, and how what you earn gets shared. It sets your
            dashboard, the kinds of listings you can post, and your payout
            structure.
          </Text>
        </div>

        {isLoading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        ) : assignment ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="small">
              {PLAYBOOK_DISPLAY_NAMES[assignment.recipe_id] ??
                assignment.recipe_id}
            </Badge>
            {roles
              .filter((role) => role !== assignment.recipe_id)
              .map((role) => (
                <Badge key={role} size="small" color="grey">
                  also {PLAYBOOK_DISPLAY_NAMES[role] ?? role}
                </Badge>
              ))}
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            You haven't picked a playbook yet.
          </Text>
        )}
      </Container>

      <PlaybookProgressions />
    </div>
  )
}
