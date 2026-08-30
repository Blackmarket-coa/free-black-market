/**
 * Env gate for the Blackout spatial consumer (W5, decision D5) — the
 * `build-auth-module.ts` idiom: a pure function over an env object so the
 * on/off combinations are unit-testable without importing medusa-config.
 *
 * OFF by default. Enabling requires all three:
 *   FBM_BLACKOUT_SPATIAL=1     — the master flag (mirrors FBM_BLACKOUT_INTEGRATION)
 *   BLACKOUT_API_BASE          — reused from the existing Blackout block
 *   BLACKOUT_SPATIAL_TOKEN     — the service token Blackout's /v1/spatial
 *                                 surface checks (x-spatial-token header)
 */

export interface BlackoutSpatialConfig {
  baseUrl: string
  token: string
}

export function buildBlackoutSpatialConfig(
  env: NodeJS.ProcessEnv = process.env
): BlackoutSpatialConfig | null {
  const enabled = env.FBM_BLACKOUT_SPATIAL === "1" || env.FBM_BLACKOUT_SPATIAL === "true"
  if (!enabled) return null
  const base = env.BLACKOUT_API_BASE?.trim()
  const token = env.BLACKOUT_SPATIAL_TOKEN?.trim()
  if (!base || !token) return null
  return { baseUrl: base.replace(/\/+$/, ""), token }
}
