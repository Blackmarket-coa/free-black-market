import {
  CheckCircleSolid,
  ComputerDesktop,
  ExclamationCircle,
  RocketLaunch,
} from "@medusajs/icons"
import { Alert, Badge, Button, Heading, Text, toast } from "@medusajs/ui"
import { FbmWebsite, useLaunchWebsite } from "../../../hooks/api/website"
import { CodeBlock } from "./shared"

const PERKS = [
  "A clean, mobile-ready storefront at your own FBM address",
  "Your products, profile, and events — always in sync with your catalog",
  "FBM checkout built in, nothing to wire up",
  "Connect a custom domain whenever you're ready",
]

function StatusBadge({ status }: { status: FbmWebsite["site_status"] }) {
  if (status === "live") {
    return (
      <Badge color="green" size="small" className="flex items-center gap-1">
        <CheckCircleSolid /> Live
      </Badge>
    )
  }
  if (status === "provisioning") {
    return (
      <Badge color="orange" size="small">
        Provisioning…
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge color="red" size="small">
        Failed
      </Badge>
    )
  }
  return null
}

export const LaunchPanel = ({ website }: { website: FbmWebsite }) => {
  const { mutate: launch, isPending } = useLaunchWebsite()
  const launched =
    website.site_status === "live" || website.site_status === "provisioning"

  const previewUrl =
    website.site_url || `https://${website.handle}.sites.freeblackmarket.com`

  const onLaunch = () => {
    launch(undefined, {
      onSuccess: () =>
        toast.success("Your site is being provisioned — live shortly!"),
      onError: (err) => {
        const msg =
          (err as { message?: string })?.message ||
          "Launch failed. Please try again."
        toast.error(msg)
      },
    })
  }

  return (
    <div className="flex flex-col gap-y-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Heading level="h2">No website? Launch one in a click</Heading>
          <Text className="text-ui-fg-subtle mt-1" size="small">
            We provision a standardized FBM site pointed at your catalog. It's
            the same building blocks as Connect, pre-assembled and hosted for
            you.
          </Text>
        </div>
        <StatusBadge status={website.site_status} />
      </div>

      {/* Live / provisioning state */}
      {launched && (
        <div className="border-ui-border-base flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <ComputerDesktop className="text-ui-fg-subtle" />
            <div className="flex-1">
              <Text className="text-ui-fg-base font-medium" size="small">
                {website.site_status === "live"
                  ? "Your site is live"
                  : "Your site is on its way"}
              </Text>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ui-fg-interactive text-sm"
              >
                {previewUrl}
              </a>
            </div>
            <Button variant="secondary" size="small" asChild>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            </Button>
          </div>

          {website.site_status === "provisioning" && (
            <Alert variant="info">
              First build takes about a minute. Refresh this page to check the
              status.
            </Alert>
          )}

          <div>
            <Text className="text-ui-fg-base mb-1 font-medium" size="small">
              Use your own domain
            </Text>
            <Text className="text-ui-fg-subtle mb-2" size="xsmall">
              Add this CNAME record at your domain registrar, then point us to
              it.
            </Text>
            <CodeBlock
              code={`CNAME   shop   ${website.handle}.sites.freeblackmarket.com`}
            />
          </div>

          {website.site_repo && (
            <Text className="text-ui-fg-muted" size="xsmall">
              Source repository: {website.site_repo}
            </Text>
          )}
        </div>
      )}

      {/* Failed state */}
      {website.site_status === "failed" && (
        <Alert variant="error">
          <div className="flex items-center gap-2">
            <ExclamationCircle />
            Provisioning didn't finish. You can try launching again below.
          </div>
        </Alert>
      )}

      {/* Initial state — what you get + launch */}
      {!launched && (
        <>
          <div className="border-ui-border-base rounded-lg border p-4">
            <Text className="text-ui-fg-base mb-3 font-medium" size="small">
              What you get
            </Text>
            <ul className="flex flex-col gap-2">
              {PERKS.map((p) => (
                <li key={p} className="flex items-start gap-2">
                  <CheckCircleSolid className="text-ui-tag-green-icon mt-0.5 shrink-0" />
                  <Text className="text-ui-fg-subtle" size="small">
                    {p}
                  </Text>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-3 rounded-lg border p-4">
            <Text className="text-ui-fg-subtle" size="small">
              Your site will live at
            </Text>
            <Text className="text-ui-fg-base font-mono" size="small">
              {website.handle}.sites.freeblackmarket.com
            </Text>

            {website.launch_available ? (
              <div>
                <Button onClick={onLaunch} isLoading={isPending} type="button">
                  <RocketLaunch />
                  Launch my site
                </Button>
              </div>
            ) : (
              <Alert variant="warning">
                Site Launch isn't enabled on this deployment yet. You can still
                use the <strong>Connect</strong> tab to embed your store on an
                existing website today.
              </Alert>
            )}
          </div>
        </>
      )}
    </div>
  )
}
