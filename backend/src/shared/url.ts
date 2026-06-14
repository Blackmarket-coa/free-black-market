export const appendPath = (baseUrl: string, path: string): string => {
  if (!baseUrl) {
    return ""
  }

  try {
    const url = new URL(baseUrl)
    const normalizedBasePath = url.pathname.replace(/\/+$/, "")
    const normalizedPath = path.startsWith("/") ? path : `/${path}`

    url.pathname = `${normalizedBasePath}${normalizedPath}`

    return url.toString()
  } catch (_error) {
    return ""
  }
}
