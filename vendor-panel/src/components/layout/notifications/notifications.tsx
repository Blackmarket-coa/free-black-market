import {
  BellAlert,
  BellAlertDone,
  InformationCircleSolid,
} from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { clx, Drawer, Heading, IconButton, Tabs, Text } from "@medusajs/ui"
import { formatDistance } from "date-fns"
import { TFunction } from "i18next"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  useNotificationBuckets,
  useNotifications,
  type NotificationBucket,
} from "../../../hooks/api"
import { FilePreview } from "../../common/file-preview"

interface NotificationData {
  title: string
  description?: string
  file?: {
    filename?: string
    url?: string
    mimeType?: string
  }
}

const LAST_READ_NOTIFICATION_KEY = "notificationsLastReadAt"

const BUCKET_TAB_LABELS: Record<NotificationBucket, string> = {
  awaits_me: "Awaits me",
  about_me: "About me",
  fyi: "FYI",
}

const BUCKET_TAB_ORDER: NotificationBucket[] = ["awaits_me", "about_me", "fyi"]

export const Notifications = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [hasUnread, setHasUnread] = useUnreadNotifications()
  const [activeTab, setActiveTab] = useState<NotificationBucket>("awaits_me")
  // This is used to show the unread icon on the notification when the drawer is open,
  // so it should lag behind the local storage data and should only be reset on close
  const [lastReadAt, setLastReadAt] = useState(
    localStorage.getItem(LAST_READ_NOTIFICATION_KEY)
  )

  // Buckets feed: counts + samples. Powers both the bell badge and the
  // tab strip. Refetches on a 30s interval.
  const { data: buckets } = useNotificationBuckets({ limit: 20 })

  const awaitsMeCount = buckets?.counts.awaits_me ?? 0

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  const handleOnOpen = (shouldOpen: boolean) => {
    if (shouldOpen) {
      setHasUnread(false)
      setOpen(true)
      localStorage.setItem(LAST_READ_NOTIFICATION_KEY, new Date().toISOString())
    } else {
      setOpen(false)
      setLastReadAt(localStorage.getItem(LAST_READ_NOTIFICATION_KEY))
    }
  }

  const activeSamples = buckets?.samples[activeTab] ?? []
  const activeCount = buckets?.counts[activeTab] ?? 0

  return (
    <Drawer open={open} onOpenChange={handleOnOpen}>
      <Drawer.Trigger asChild>
        <IconButton
          variant="transparent"
          className="text-ui-fg-muted hover:text-ui-fg-subtle relative"
        >
          {hasUnread || awaitsMeCount > 0 ? <BellAlertDone /> : <BellAlert />}
          {awaitsMeCount > 0 && (
            <span
              className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-tag-red-bg px-1 text-[10px] font-semibold text-ui-tag-red-text"
              role="status"
              aria-label={`${awaitsMeCount} awaiting action`}
            >
              {awaitsMeCount > 99 ? "99+" : awaitsMeCount}
            </span>
          )}
        </IconButton>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading>{t("notifications.domain")}</Heading>
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            {t("notifications.accessibility.description")}
          </Drawer.Description>
        </Drawer.Header>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as NotificationBucket)}
        >
          <Tabs.List className="border-b px-4">
            {BUCKET_TAB_ORDER.map((bucket) => {
              const count = buckets?.counts[bucket] ?? 0
              return (
                <Tabs.Trigger key={bucket} value={bucket}>
                  {BUCKET_TAB_LABELS[bucket]}
                  {count > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-tag-neutral-bg px-1 text-[10px] font-semibold text-ui-tag-neutral-text">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Tabs.Trigger>
              )
            })}
          </Tabs.List>
          <Drawer.Body className="overflow-y-auto px-0">
            {activeSamples.length === 0 ? (
              <NotificationsEmptyState t={t} />
            ) : (
              activeSamples.map((notification) => (
                <Notification
                  key={notification.id}
                  notification={notification as unknown as HttpTypes.AdminNotification}
                  unread={
                    Date.parse(notification.created_at) >
                    (lastReadAt ? Date.parse(lastReadAt) : 0)
                  }
                />
              ))
            )}
            {activeCount > activeSamples.length && (
              <p className="text-ui-fg-muted px-6 py-3 text-xs">
                Showing the {activeSamples.length} most recent of {activeCount}.
              </p>
            )}
          </Drawer.Body>
        </Tabs>
      </Drawer.Content>
    </Drawer>
  )
}

const NOTIFICATION_TEMPLATES = {
  seller_product_collection_request_accepted_notification:
    "Your product collection request has been accepted",
  seller_product_collection_request_rejected_notification:
    "Your product collection request has been rejected",
  seller_new_order_notification: "You have a new order",
  seller_product_category_request_accepted_notification:
    "Your product category request has been accepted",
  seller_product_category_request_rejected_notification:
    "Your product category request has been rejected",
  seller_product_tag_request_accepted_notification:
    "Your product tag request has been accepted",
  seller_product_tag_request_rejected_notification:
    "Your product tag request has been rejected",
  seller_product_type_request_accepted_notification:
    "Your product type request has been accepted",
  seller_product_type_request_rejected_notification:
    "Your product type request has been rejected",
  seller_product_request_accepted_notification:
    "Your product request has been accepted",
  seller_product_request_rejected_notification:
    "Your product request has been rejected",
}

const Notification = ({
  notification,
  unread,
}: {
  notification: HttpTypes.AdminNotification
  unread?: boolean
}) => {
  const data = notification.data as unknown as NotificationData | undefined

  // We need at least the title to render a notification in the feed
  if (!notification.template) {
    return null
  }

  return (
    <>
      <div className="relative flex items-start justify-center gap-3 border-b p-6">
        <div className="text-ui-fg-muted flex size-5 items-center justify-center">
          <InformationCircleSolid />
        </div>
        <div className="flex w-full flex-col gap-y-3">
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <Text size="small" leading="compact" weight="plus">
                {data?.title
                  ? data.title
                  : NOTIFICATION_TEMPLATES[
                      notification.template as keyof typeof NOTIFICATION_TEMPLATES
                    ]}
              </Text>
              <div className="align-center flex items-center justify-center gap-2">
                <Text
                  as={"span"}
                  className={clx("text-ui-fg-subtle", {
                    "text-ui-fg-base": unread,
                  })}
                  size="small"
                  leading="compact"
                  weight="plus"
                >
                  {formatDistance(notification.created_at, new Date(), {
                    addSuffix: true,
                  })}
                </Text>
                {unread && (
                  <div
                    className="bg-ui-bg-interactive h-2 w-2 rounded"
                    role="status"
                  />
                )}
              </div>
            </div>
            {data?.title &&
              !!NOTIFICATION_TEMPLATES[
                notification.template as keyof typeof NOTIFICATION_TEMPLATES
              ] && (
                <Text
                  className="text-ui-fg-subtle whitespace-pre-line"
                  size="small"
                >
                  {
                    NOTIFICATION_TEMPLATES[
                      notification.template as keyof typeof NOTIFICATION_TEMPLATES
                    ]
                  }
                </Text>
              )}
          </div>
          {!!data?.file?.url && (
            <FilePreview
              filename={data.file.filename ?? ""}
              url={data.file.url}
              hideThumbnail
            />
          )}
        </div>
      </div>
    </>
  )
}

const NotificationsEmptyState = ({ t }: { t: TFunction }) => {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <BellAlertDone />
      <Text size="small" leading="compact" weight="plus" className="mt-3">
        {t("notifications.emptyState.title")}
      </Text>
      <Text
        size="small"
        className="text-ui-fg-muted mt-1 max-w-[294px] text-center"
      >
        {t("notifications.emptyState.description")}
      </Text>
    </div>
  )
}

const useUnreadNotifications = () => {
  const [hasUnread, setHasUnread] = useState(false)
  const { notifications } = useNotifications(
    { limit: 1, offset: 0, fields: "created_at" },
    { refetchInterval: 60_000 }
  )
  const lastNotification = notifications?.[0]

  useEffect(() => {
    if (!lastNotification) {
      return
    }

    const lastNotificationAsTimestamp = Date.parse(lastNotification.created_at)

    const lastReadDatetime = localStorage.getItem(LAST_READ_NOTIFICATION_KEY)
    const lastReadAsTimestamp = lastReadDatetime
      ? Date.parse(lastReadDatetime)
      : 0

    if (lastNotificationAsTimestamp > lastReadAsTimestamp) {
      setHasUnread(true)
    }
  }, [lastNotification])

  return [hasUnread, setHasUnread] as const
}
