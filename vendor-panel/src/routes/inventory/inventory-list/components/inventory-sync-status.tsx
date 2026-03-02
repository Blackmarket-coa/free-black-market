import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useWooSync, useWooSyncStatus } from "../../../../hooks/api/woocommerce"

const formatSyncTimestamp = (value?: string | null) => {
  if (!value) {
    return "Not yet synced"
  }

  return new Date(value).toLocaleString()
}

export const InventorySyncStatus = () => {
  const { t } = useTranslation()
  const { sync, isPending, isError } = useWooSyncStatus()
  const syncMutation = useWooSync({
    onSuccess: () => {
      toast.success("Inventory sync queued successfully")
    },
    onError: (error) => {
      toast.error(error.message || "Inventory sync failed")
    },
  })

  const report = sync?.last_sync_report
  const hasErrors = Boolean(report?.errors?.length)

  return (
    <Container className="mb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Heading level="h3">{t("inventory.domain")} sync status</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Last sync: {isPending ? "Loading..." : formatSyncTimestamp(sync?.last_synced_at)}
          </Text>
          {isError ? (
            <Text size="small" className="text-ui-fg-error">
              Unable to load sync status right now.
            </Text>
          ) : null}
          {report?.summary ? (
            <Text size="small" className="text-ui-fg-subtle">
              {report.summary}
            </Text>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Badge color={hasErrors ? "orange" : "green"}>
            {hasErrors ? "Errors detected" : "Healthy"}
          </Badge>
          <Button
            size="small"
            variant="secondary"
            isLoading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            Retry sync
          </Button>
        </div>
      </div>
    </Container>
  )
}
