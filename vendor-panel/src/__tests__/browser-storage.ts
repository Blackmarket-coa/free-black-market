/**
 * A browser `window` with `localStorage`, for specs that load lib/client.
 *
 * lib/client decides once, when it loads, whether it runs in a browser, and
 * the JS SDK reads `window.localStorage` on every request, so the storage has
 * to exist before any module that imports lib/client is evaluated. Call it
 * from `vi.hoisted`, which runs before a spec's imports:
 *
 *   const browser = await vi.hoisted(async () =>
 *     (await import("../__tests__/browser-storage")).installBrowserStorage()
 *   )
 *   afterAll(() => browser.restore())
 */
export const installBrowserStorage = () => {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
  const g = globalThis as { window?: unknown }
  const previousWindow = g.window
  g.window = { localStorage, location: { origin: "http://panel.test" } }
  return {
    store,
    restore: () => {
      g.window = previousWindow
    },
  }
}
