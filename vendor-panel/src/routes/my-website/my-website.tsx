import { Code, RocketLaunch } from "@medusajs/icons"
import { Container, Heading, Tabs, Text } from "@medusajs/ui"
import { useState } from "react"
import { useWebsite } from "../../hooks/api/website"
import { ConnectPanel } from "./components/connect-panel"
import { LaunchPanel } from "./components/launch-panel"

/**
 * "My Website" — the vendor's commerce-anywhere control panel.
 *
 *   Connect : embed FBM on a site you already have (Mode 1)
 *   Launch  : provision a standardized FBM-hosted site (Mode 2)
 */
export const MyWebsite = () => {
  const { website, isPending, isError, error } = useWebsite()
  const [tab, setTab] = useState("connect")

  if (isError) {
    throw error
  }

  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading>My Website</Heading>
        <Text className="text-ui-fg-subtle mt-1" size="small">
          Sell anywhere. Embed FBM on your own site, or launch a ready-made one.
        </Text>
      </div>

      {isPending || !website ? (
        <div className="px-6 py-10">
          <Text className="text-ui-fg-subtle" size="small">
            Loading…
          </Text>
        </div>
      ) : (
        <div className="px-6 pb-6">
          <Tabs value={tab} onValueChange={setTab}>
            <Tabs.List>
              <Tabs.Trigger value="connect" className="flex items-center gap-2">
                <Code />
                Connect
              </Tabs.Trigger>
              <Tabs.Trigger value="launch" className="flex items-center gap-2">
                <RocketLaunch />
                Launch
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="connect">
              <ConnectPanel website={website} />
            </Tabs.Content>
            <Tabs.Content value="launch">
              <LaunchPanel website={website} />
            </Tabs.Content>
          </Tabs>
        </div>
      )}
    </Container>
  )
}

export const Component = MyWebsite
