import type SellerExtensionService from "./service"

/**
 * The SellerMetadata methods SellerExtensionService really has (SD-141).
 *
 * MedusaService names a model's methods with Medusa's runtime `pluralize`,
 * which leaves "SellerMetadata" as it is, so the service has
 * `listSellerMetadata`, `createSellerMetadata`, `updateSellerMetadata` and
 * `deleteSellerMetadata`. The generated types name them with the type-level
 * `Pluralize`, which adds an "s", and declare `listSellerMetadatas`,
 * `createSellerMetadatas`, ...: methods that do not exist, so a call to one
 * compiles and throws a TypeError. When this was written it was the only
 * model handed to MedusaService under src/modules whose two names differ.
 *
 * The declared signatures are right about everything but the name, so they
 * type the real methods here. If Medusa ever makes the two agree, these
 * lookups stop compiling rather than going quietly wrong.
 */
type SellerMetadataMethods = {
  listSellerMetadata: SellerExtensionService["listSellerMetadatas"]
  createSellerMetadata: SellerExtensionService["createSellerMetadatas"]
  updateSellerMetadata: SellerExtensionService["updateSellerMetadatas"]
  deleteSellerMetadata: SellerExtensionService["deleteSellerMetadatas"]
}

/**
 * The writes keep the loose input and output they have always had here;
 * typing them is not this change.
 */
type LooseCall = (data: unknown) => Promise<any>

/**
 * A real method, bound to its service. Only the runtime name is tried: a
 * plural name in front of it only ever let a test double that mocked the
 * plural pass while production called something else.
 */
const runtimeMethod = <K extends keyof SellerMetadataMethods>(
  service: SellerExtensionService,
  name: K
): SellerMetadataMethods[K] => {
  const method: unknown = (service as unknown as Record<string, unknown>)[name]
  if (typeof method !== "function") {
    throw new Error(`SellerExtensionService has no ${name}()`)
  }
  return method.bind(service) as SellerMetadataMethods[K]
}

/** `listSellerMetadatas` as declared, called by the name the service has. */
export const listSellerMetadataRecords = (
  service: SellerExtensionService,
  ...args: Parameters<SellerMetadataMethods["listSellerMetadata"]>
): ReturnType<SellerMetadataMethods["listSellerMetadata"]> =>
  runtimeMethod(service, "listSellerMetadata")(...args)

export const createSellerMetadataRecord = async (
  service: SellerExtensionService,
  data: Record<string, unknown> | Record<string, unknown>[]
) => (runtimeMethod(service, "createSellerMetadata") as LooseCall)(data)

export const updateSellerMetadataRecord = async (
  service: SellerExtensionService,
  data: Record<string, unknown> | Record<string, unknown>[]
) => (runtimeMethod(service, "updateSellerMetadata") as LooseCall)(data)

export const deleteSellerMetadataRecord = async (
  service: SellerExtensionService,
  data: string | string[]
) => (runtimeMethod(service, "deleteSellerMetadata") as LooseCall)(data)
