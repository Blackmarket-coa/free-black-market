import { Container, Heading, Text } from "@medusajs/ui";
import { ChatBubbleLeftRight } from "@medusajs/icons";

import { useMatrixChat } from "@hooks/api/messages";

export const Messages = () => {
  const { isConfigured, elementUrl, defaultRoomAlias, loginToken, isLoading } =
    useMatrixChat();

  // Build the Element URL: auto-login via the single-use loginToken query param,
  // and deep-link to the default room via the hash route when available.
  const getIframeUrl = () => {
    if (!elementUrl) return "";

    const base = elementUrl.replace(/\/$/, "");
    const query = loginToken
      ? `?loginToken=${encodeURIComponent(loginToken)}`
      : "";
    const hash = defaultRoomAlias
      ? `#/room/${encodeURIComponent(defaultRoomAlias)}`
      : "";

    return `${base}/${query}${hash}`;
  };

  const finalIframeUrl = getIframeUrl();

  return (
    <Container>
      <div className="flex items-center justify-between mb-4">
        <Heading>Messages</Heading>
        {isConfigured && elementUrl && (
          <a
            href={elementUrl}
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
            title="Matrix Messages"
            className="w-full h-full border-0 rounded-lg"
            allow="camera; microphone; fullscreen; display-capture"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center">
            <ChatBubbleLeftRight className="w-12 h-12 text-ui-fg-muted mb-4" />
            <Heading>Chat Not Configured</Heading>
            <Text className="mt-4 text-ui-fg-muted text-center max-w-md">
              Please set the MATRIX_HOMESERVER_URL and MATRIX_ELEMENT_URL
              environment variables in your backend to enable chat functionality.
            </Text>
          </div>
        )}
      </div>
    </Container>
  );
};
