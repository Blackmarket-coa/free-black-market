export interface HomeKitchenDisclosureData {
  operation_type: "SHELF_STABLE" | "HOME_KITCHEN" | "BOTH"
  disclosure_text: string | null
  business_name: string | null
  /** Null unless the seller opted to publish it — usually a home address. */
  address: string | null
  jurisdiction_label: string | null
  permit_number: string | null
  permit_type_label: string | null
  allergens: Array<{ key: string; label: string }>
  channels: {
    pickup: boolean
    delivery: boolean
    shipping: boolean
  }
}

const OPERATION_HEADINGS: Record<
  HomeKitchenDisclosureData["operation_type"],
  string
> = {
  SHELF_STABLE: "Made in a home kitchen",
  HOME_KITCHEN: "Cooked in a home kitchen",
  BOTH: "Made in a home kitchen",
}

/**
 * Buyer-facing home-kitchen disclosure.
 *
 * Shown on producer and product pages so a shopper knows what they're buying
 * and, if they have an allergy, can see it before they order rather than after
 * the box arrives.
 *
 * Framed as information, not warning. Home kitchens are legitimate, permitted
 * businesses; the disclosure exists because the law asks for it and because
 * buyers deserve to know, not because there is something wrong with the food.
 *
 * The wording in `disclosure_text` is the seller's own — whatever their
 * jurisdiction requires, verbatim. Nothing here is generated or paraphrased.
 */
export const HomeKitchenDisclosure = ({
  data,
  className = "",
}: {
  data: HomeKitchenDisclosureData | null
  className?: string
}) => {
  if (!data) return null

  const hasAnything =
    data.disclosure_text ||
    data.allergens.length > 0 ||
    data.permit_number ||
    data.business_name
  if (!hasAnything) return null

  const fulfilment = [
    data.channels.pickup && "pickup",
    data.channels.delivery && "local delivery",
    data.channels.shipping && "shipping",
  ].filter(Boolean) as string[]

  return (
    <section
      className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${className}`}
      aria-label="Home kitchen information"
    >
      <h3 className="text-sm font-semibold text-gray-900">
        {OPERATION_HEADINGS[data.operation_type]}
      </h3>

      {data.disclosure_text && (
        <p className="mt-2 text-sm text-gray-700">{data.disclosure_text}</p>
      )}

      {data.allergens.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Allergens
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {data.allergens.map((allergen) => (
              <li
                key={allergen.key}
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900"
              >
                {allergen.label}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-gray-500">
            Declared by the maker across their products. Message them if you need
            to check a specific item.
          </p>
        </div>
      )}

      <dl className="mt-3 space-y-1 text-xs text-gray-600">
        {data.business_name && (
          <div className="flex gap-x-1">
            <dt className="font-medium">Made by:</dt>
            <dd>{data.business_name}</dd>
          </div>
        )}
        {/* Present only when the seller explicitly chose to publish it. */}
        {data.address && (
          <div className="flex gap-x-1">
            <dt className="font-medium">Address:</dt>
            <dd>{data.address}</dd>
          </div>
        )}
        {data.jurisdiction_label && (
          <div className="flex gap-x-1">
            <dt className="font-medium">Permitted in:</dt>
            <dd>{data.jurisdiction_label}</dd>
          </div>
        )}
        {data.permit_number && (
          <div className="flex gap-x-1">
            <dt className="font-medium">
              {data.permit_type_label || "Permit"}:
            </dt>
            <dd>{data.permit_number}</dd>
          </div>
        )}
        {fulfilment.length > 0 && (
          <div className="flex gap-x-1">
            <dt className="font-medium">Available for:</dt>
            <dd>{fulfilment.join(", ")}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/**
 * Compact allergen chips for product cards and listings, where the full
 * disclosure block would crowd everything else out.
 */
export const AllergenChips = ({
  allergens,
  className = "",
}: {
  allergens: Array<{ key: string; label: string }>
  className?: string
}) => {
  if (!allergens.length) return null

  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Allergens">
      {allergens.map((allergen) => (
        <li
          key={allergen.key}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
        >
          {allergen.label}
        </li>
      ))}
    </ul>
  )
}
