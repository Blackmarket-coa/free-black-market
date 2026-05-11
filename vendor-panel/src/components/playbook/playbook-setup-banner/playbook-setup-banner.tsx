import { Alert, Button, FocusModal, Text, toast } from "@medusajs/ui"
import { useState } from "react"
import { useLocation } from "react-router-dom"

import { PlaybookPicker } from "../playbook-picker"
import { useMe } from "../../../hooks/api/users"
import {
  useAssignPlaybook,
  usePlaybookAssignment,
} from "../../../hooks/api/playbook"

/**
 * Dashboard banner shown to sellers who don't yet have a playbook
 * assignment. Surfaces the 3-question picker in a focus modal so legacy
 * sellers (and any backfill miss) can migrate themselves without
 * needing operator intervention.
 *
 * Skipped on `/onboarding/*` because the wizard there mounts the picker
 * as a gate already — showing both would be redundant.
 */
export const PlaybookSetupBanner = () => {
  const location = useLocation()
  const { seller, isPending: meLoading } = useMe()
  const {
    data: assignmentData,
    isPending: assignmentLoading,
  } = usePlaybookAssignment()
  const { mutateAsync: assignPlaybook, isPending: assigning } = useAssignPlaybook()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (meLoading || assignmentLoading) return null
  if (!seller) return null
  if (assignmentData?.playbook_assignment) return null
  if (location.pathname.startsWith("/onboarding")) return null
  if (dismissed) return null

  return (
    <>
      <Alert variant="warning" className="bg-ui-bg-base">
        <div className="flex flex-col gap-y-3">
          <div className="flex flex-col">
            <Text size="small" leading="compact" weight="plus" asChild>
              <h2>Pick your playbook</h2>
            </Text>
            <Text size="small" leading="compact" className="text-pretty">
              We've updated how vendors are categorized. Spend 30 seconds picking
              the playbook that matches your operation — it unlocks the right
              tools for your shape of work.
            </Text>
          </div>
          <div className="flex items-center gap-x-3">
            <Button variant="secondary" size="small" onClick={() => setOpen(true)}>
              Pick your playbook
            </Button>
            <Button
              variant="transparent"
              size="small"
              onClick={() => setDismissed(true)}
            >
              Not now
            </Button>
          </div>
        </div>
      </Alert>

      <FocusModal open={open} onOpenChange={setOpen}>
        <FocusModal.Content>
          <FocusModal.Header />
          <FocusModal.Body className="overflow-y-auto">
            <PlaybookPicker
              onCancel={() => setOpen(false)}
              onComplete={async (result) => {
                try {
                  await assignPlaybook({
                    recipe_id: result.recipe_id,
                    answers: result.answers,
                    recommended_recipe_id: result.recommended_recipe_id,
                    overridden: result.overridden,
                  })
                  toast.success("Playbook saved")
                  setOpen(false)
                } catch (err) {
                  toast.error("Could not save playbook", {
                    description: (err as Error).message,
                  })
                }
              }}
            />
            {assigning ? (
              <div className="text-center mt-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Saving…
                </Text>
              </div>
            ) : null}
          </FocusModal.Body>
        </FocusModal.Content>
      </FocusModal>
    </>
  )
}

export default PlaybookSetupBanner
