import axios from "axios"

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
      // Session expired — bounce to login (the FBM vendor auth surface).
      window.location.href = "/login"
    }
    return Promise.reject(error)
  }
)

// Toggle for the data seam. While the creator-hub backend routes are still being
// wired, read hooks resolve from the typed mock layer. The genuinely-live bridge
// mutations (stream overlay URL, Blackout membership force-resync) post to the
// real backend regardless — see hooks/useCreatorData.ts.
export const USE_MOCK_DATA = true

// Small helper so mock hooks share a realistic async shape.
export function mockResolve<T>(data: T, delayMs = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), delayMs))
}
