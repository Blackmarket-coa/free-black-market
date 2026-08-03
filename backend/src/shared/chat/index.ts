import { createLogger } from "../logger"
import { getMatrixService } from "../matrix-service"
import { BlackoutChatProvider } from "./blackout-provider"
import { isChatProviderKind, type ChatProvider, type ChatProviderKind } from "./types"

const log = createLogger("shared/chat")

/**
 * Resolve the configured chat backend, or null when chat is unavailable.
 *
 * **Returning null is the load-bearing part of this contract.** Every caller
 * already handles a null chat service — that is how the codebase has always
 * treated an unconfigured homeserver, and it is why a marketplace running
 * without chat degrades instead of erroring. Any adapter added here must
 * preserve that: "not configured" is null, not a throw.
 *
 * Selection is by `CHAT_PROVIDER`, defaulting to `matrix` so an existing
 * deployment that sets nothing keeps exactly today's behaviour. An
 * unrecognised value falls back to `matrix` with a warning rather than
 * disabling chat: a typo in an env var should not silently take a
 * marketplace's messaging offline.
 */
let cached: { kind: ChatProviderKind; provider: ChatProvider } | null = null

export function configuredChatProviderKind(): ChatProviderKind {
  const raw = (process.env.CHAT_PROVIDER || "").trim().toLowerCase()
  if (!raw) return "matrix"
  if (isChatProviderKind(raw)) return raw

  log.warn(
    `[chat] Unknown CHAT_PROVIDER "${raw}"; falling back to "matrix". ` +
      `Valid values: matrix, blackout.`
  )
  return "matrix"
}

export function getChatProvider(): ChatProvider | null {
  const kind = configuredChatProviderKind()

  if (cached?.kind === kind) return cached.provider

  if (kind === "blackout") {
    // Constructed eagerly and cached: it is the *operations* that fail, not
    // the construction. Returning null here would read as "chat is switched
    // off" and silently skip every chat side effect, which is precisely the
    // misconfiguration this must surface rather than hide.
    const provider = new BlackoutChatProvider()
    cached = { kind, provider }
    return provider
  }

  // `getMatrixService` already returns null when the homeserver env is absent
  // and logs why, so unconfigured Matrix keeps behaving exactly as before.
  const matrix = getMatrixService()
  if (!matrix) return null

  const provider = matrix as unknown as ChatProvider
  // The Matrix service predates this interface and has no `kind`; attach one
  // so diagnostics can name the backend without instanceof checks.
  if (!(provider as { kind?: string }).kind) {
    Object.defineProperty(provider, "kind", {
      value: "matrix",
      enumerable: false,
      configurable: true,
    })
  }

  cached = { kind, provider }
  return provider
}

/** Drop the memoised provider. For tests and for config reloads. */
export function resetChatProvider(): void {
  cached = null
}

export * from "./types"
