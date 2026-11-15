/**
 * What a buyer can rely on about shipping and returns on a listing.
 *
 * This section used to be template text from the storefront starter: "Free
 * standard shipping on all orders within the continental U.S." and "a 30-day
 * return policy ... return the chair for a full refund", rendered on every
 * shippable listing. FBM promises neither. Each seller sets their own shipping
 * options and return terms (see /legal/refunds, section 2), and no listing
 * carries structured shipping or returns data yet, so the honest statement is
 * the platform rule: shipping is chosen and priced at checkout, and a listing
 * without published return terms is not returnable except where the law says
 * otherwise or a claim applies. When listings gain structured terms, render
 * the seller's own here instead.
 */
export const SHIPPING_COPY =
  'Shipping options and costs are set by the seller. You will see the options available for your address, and the total including shipping, at checkout before you pay.';

export const RETURNS_COPY =
  'Each seller sets their own return terms and publishes them on the listing. If this listing does not state return terms, treat it as not returnable, except where the law says otherwise or a claim applies (for example, the order never arrived, arrived damaged or is not what was described).';
