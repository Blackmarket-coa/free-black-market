import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import type PluginRegistryService from "../../../../../modules/plugin-registry/service"
import { ENTITLEMENT_MODULE } from "../../../../../modules/entitlement"
import type EntitlementModuleService from "../../../../../modules/entitlement/service"
import {
  buildPluginGrantInput,
  pluginFeatureKey,
} from "../../../../../modules/plugin-registry/entitlement"
import { isInstallable } from "../../../../../modules/plugin-registry/compat"
import {
  buildPluginInstalledPayload,
  buildPluginUninstalledPayload,
  pluginHookChannelId,
} from "../../../../../modules/plugin-registry/hooks"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../../../../../modules/marketplace-webhooks/service"
import { PLATFORM_VERSION } from "../../../../../shared/platform-version"
import { createLogger } from "../../../../../shared/logger"

const log = createLogger("api/store/plugins/install")

/**
 * POST /store/plugins/:slug/install
 *
 * Install a plugin for the authenticated customer: grants a `plugin:<slug>`
 * entitlement and bumps the plugin's install counter. Idempotent — a customer
 * who already holds the entitlement is not re-granted and the counter is not
 * re-incremented.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const slug = req.params.slug
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    return res.status(404).json({ message: `Plugin '${slug}' not found` })
  }

  // Compatibility gate: block deprecated plugins and host-version mismatches
  // before granting.
  const compat = isInstallable(
    {
      status: (plugin as { status?: string | null }).status,
      min_host_version: (plugin as { min_host_version?: string | null }).min_host_version,
      max_host_version: (plugin as { max_host_version?: string | null }).max_host_version,
    },
    PLATFORM_VERSION
  )
  if (!compat.ok) {
    return res.status(409).json({
      installed: false,
      slug,
      code: compat.code,
      message: compat.message,
      host_version: PLATFORM_VERSION,
    })
  }

  const featureKey = pluginFeatureKey(slug)
  const existing = await entitlements.verify({ customer_id: customerId, feature_key: featureKey })
  if (existing.entitled) {
    return res.status(200).json({
      installed: true,
      already_installed: true,
      slug,
      feature_key: featureKey,
      entitlement_id: existing.entitlements[0]?.id ?? null,
    })
  }

  const entitlement = await entitlements.grant(
    buildPluginGrantInput({ slug, customerId })
  )
  const updated = await registry.incrementInstallCount(slug)

  // Plugin hook registry (§1.4): notify the plugin's registered hook
  // endpoints. Privacy: customer installs never ship the customer id.
  // Best-effort — a hook hiccup never fails the install.
  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "plugin.installed",
      pluginHookChannelId(slug),
      buildPluginInstalledPayload({
        slug,
        installer_type: "customer",
        install_count: updated ? Number((updated as any).install_count) : null,
      })
    )
  } catch (err) {
    log.error("[plugins/install] plugin.installed hook dispatch failed", err)
  }

  return res.status(201).json({
    installed: true,
    already_installed: false,
    slug,
    feature_key: featureKey,
    entitlement_id: entitlement.id,
    install_count: updated ? Number((updated as any).install_count) : undefined,
  })
}

/**
 * DELETE /store/plugins/:slug/install (W3)
 *
 * Uninstall: revoke the customer's live `plugin:<slug>` entitlement rows and
 * decrement the counter. Idempotent — no live entitlement is a 200 no-op.
 * Privacy posture matches installs: the hook payload never carries the
 * customer id.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id as string | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Authentication required" })
  }

  const slug = req.params.slug
  const registry = req.scope.resolve<PluginRegistryService>(PLUGIN_REGISTRY_MODULE)
  const entitlements = req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE)

  const plugin = await registry.getBySlug(slug)
  if (!plugin) {
    return res.status(404).json({ message: `Plugin '${slug}' not found` })
  }

  const featureKey = pluginFeatureKey(slug)
  const existing = await entitlements.verify({ customer_id: customerId, feature_key: featureKey })
  if (!existing.entitled) {
    return res.status(200).json({ uninstalled: false, already: true, slug })
  }

  for (const row of existing.entitlements) {
    await entitlements.revoke(row.id, "plugin_uninstalled")
  }
  let updated: { install_count?: unknown } | null = null
  try {
    updated = (await registry.decrementInstallCount(slug)) as { install_count?: unknown }
  } catch (err) {
    log.error("[plugins/uninstall] install-count decrement failed", err)
  }

  try {
    const webhooks = req.scope.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    await webhooks.dispatch(
      "plugin.uninstalled",
      pluginHookChannelId(slug),
      buildPluginUninstalledPayload({ slug, installer_type: "customer" })
    )
  } catch (err) {
    log.error("[plugins/uninstall] plugin.uninstalled hook dispatch failed", err)
  }

  return res.status(200).json({
    uninstalled: true,
    already: false,
    slug,
    revoked: existing.entitlements.length,
    install_count: updated ? Number(updated.install_count) : undefined,
  })
}
