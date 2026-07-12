/**
 * The platform's plugin-host compatibility version — the single source of truth
 * a plugin's `min_host_version` / `max_host_version` range is checked against at
 * install time. Bump this when a breaking change to the plugin host contract
 * ships so incompatible plugins are gated out. Overridable per environment via
 * `FBM_PLATFORM_VERSION` (e.g. staging pinned to a pre-release host).
 */
export const PLATFORM_VERSION = process.env.FBM_PLATFORM_VERSION ?? "1.0.0"
