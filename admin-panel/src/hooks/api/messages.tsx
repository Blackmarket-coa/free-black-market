import { useQuery } from "@tanstack/react-query";

export const useTalkJS = () => {
  const { data: talkJs, isLoading } = useQuery({
    queryKey: ["talk-js"],
    queryFn: () =>
      fetch("/admin/talk-js")
        .then((res) => res.json())
        .catch((err) => ({
          message: err,
        })),
  });

  return { ...talkJs, isLoading };
};

export const useMatrixChat = () => {
  // Always fetch from API to get the single-use login token
  const { data: matrixChat, isLoading } = useQuery({
    queryKey: ["matrix-chat"],
    queryFn: () =>
      fetch("/admin/chat", {
        credentials: "include", // Include auth cookies
      })
        .then((res) => res.json())
        .catch((err) => ({
          configured: false,
          message: err,
        })),
  });

  return {
    isConfigured: matrixChat?.configured ?? false,
    elementUrl: matrixChat?.element_url ?? null,
    serverName: matrixChat?.server_name ?? null,
    defaultRoomAlias: matrixChat?.default_room_alias ?? null,
    loginToken: matrixChat?.login?.login_token ?? null,
    isLoading,
  };
};
