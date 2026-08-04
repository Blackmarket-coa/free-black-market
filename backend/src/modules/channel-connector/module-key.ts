/**
 * The module key alone, split out from `index.ts`.
 *
 * Importing `index.ts` executes `Module()`, which boot-path callers must not
 * trigger. Same split as `vendor-usage/module-key.ts`, for the same reason.
 */
export const CHANNEL_CONNECTOR_MODULE = "channelConnector"
