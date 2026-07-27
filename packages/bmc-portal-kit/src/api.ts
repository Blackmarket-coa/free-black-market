import axios from "axios"

// The FBM login surface to bounce unauthenticated users to. The portals live on
// their own hosts, so "/login" (the previous target) is a dead route on the
// portal origin — an unauthenticated user just looped. Point at the real vendor
// auth surface; override per deploy with VITE_FBM_LOGIN_URL.
export const LOGIN_URL =
  (import.meta.env.VITE_FBM_LOGIN_URL as string | undefined) ||
  "https://vendor.freeblackmarket.com/login"

// Axios instance for the FBM backend. In dev, Vite proxies /api → VITE_FBM_API_URL.
// All Blackout (Matrix) traffic also goes through this backend — the bot access
// token is never exposed to the browser.
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      // Session expired / missing — bounce to the real FBM login surface.
      window.location.href = LOGIN_URL
    }
    return Promise.reject(error)
  }
)

// Toggle for the data seam. In development the typed mock layer is on by default
// (the portal backend routes are still being built). In a PRODUCTION build mocks
// are OFF unless explicitly opted in with VITE_USE_MOCK_DATA=true — otherwise a
// prod deploy that simply forgot to set the flag would serve fake data to real
// users. Set VITE_USE_MOCK_DATA=false in dev to hit the real API.
export const USE_MOCK_DATA = import.meta.env.PROD
  ? import.meta.env.VITE_USE_MOCK_DATA === "true"
  : import.meta.env.VITE_USE_MOCK_DATA !== "false"

// Small helper so mock hooks share a realistic async shape.
export function mockResolve<T>(data: T, delayMs = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), delayMs))
}
