/**
 * @deprecated use `playbook-provider` instead.
 *
 * `vendor-type-provider` continues to work for existing call sites
 * during the migration to the canonical playbook concept. New code
 * should import from `../playbook-provider`:
 *
 *   import { usePlaybook, type Playbook } from "../playbook-provider"
 *
 * See `docs/PLAYBOOK_SYSTEM.md` for the migration map (6 legacy
 * vendor types → 10 playbooks) and the rename rationale.
 */
export {
  VendorTypeProvider,
  useVendorType,
  useIsVendorType,
  getFeaturesByType,
  ALL_EXTENSION_OPTIONS,
  ALL_FEATURE_KEYS,
  type VendorType,
  type VendorFeatures,
} from "./vendor-type-context"
