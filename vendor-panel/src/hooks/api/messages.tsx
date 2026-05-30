import { useQuery } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export const useMatrixChatConfig = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["matrix-chat-config"],
    queryFn: async () => await fetchQuery(`/vendor/chat`, { method: "GET" }),
  })

  return {
    isConfigured: data?.configured ?? false,
    elementUrl: data?.element_url ?? null,
    serverName: data?.server_name ?? null,
    defaultRoomAlias: data?.default_room_alias ?? null,
    loginToken: data?.login?.login_token ?? null,
    ...rest,
  }
}
