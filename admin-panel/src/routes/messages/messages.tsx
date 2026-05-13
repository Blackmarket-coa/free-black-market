import { Container, Heading, Text } from "@medusajs/ui";
import { ChatBubbleLeftRight } from "@medusajs/icons";

import { useRocketChat } from "@hooks/api/messages";

export const Messages = () => {
  const { isConfigured, rocketChatUrl, iframeUrl, loginToken, isLoading } = useRocketChat();

  // Build iframe URL with auto-login token
  const getIframeUrl = () => {
    if (!iframeUrl) return ""

    // If we have a login token, add it to the URL for auto-login
    if (loginToken) {
      const url = new URL(iframeUrl)
      url.searchParams.set('resumeToken', loginToken)
      
return url.toString()
    }

    return iframeUrl
  }

  const finalIframeUrl = getIframeUrl();

  return (
    <Container>
      <div className="flex items-center justify-between mb-4">
        <Heading>Messages</Heading>
        {isConfigured && rocketChatUrl && (
          <a
            href={rocketChatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ui-fg-interactive hover:underline text-sm"
          >
            Open in new tab
          </a>
        )}
      </div>
      <div className="h-[600px] py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            Loading...
          </div>
        ) : isConfigured && finalIframeUrl ? (
          <iframe
            src={finalIframeUrl}
            title="Rocket.Chat Messages"
            className="w-full h-full border-0 rounded-lg"
            allow="camera; microphone; fullscreen; display-capture"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <ChatBubbleLeftRight className="w-12 h-12 text-ui-fg-muted mb-4" />
            <Heading>Chat Not Configured</Heading>
            <Text className="mt-4 text-ui-fg-muted text-center max-w-md">
              Please set the ROCKETCHAT_URL environment variable in your backend
              to enable chat functionality.
            </Text>
          </div>
        )}
      </div>
    </Container>
  );
};
