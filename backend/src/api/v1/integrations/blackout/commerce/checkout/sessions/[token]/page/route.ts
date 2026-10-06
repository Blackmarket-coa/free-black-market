import { createLogger } from "../../../../../../../../../shared/logger";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import jwt from "jsonwebtoken";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows";
import { config } from "../../../../../../../../../shared/config";
import { MARKETPLACE_LISTING_MODULE } from "../../../../../../../../../modules/marketplace-listing";
import type MarketplaceListingService from "../../../../../../../../../modules/marketplace-listing/service";
import {
  BlackoutCheckoutSessionStatus,
  CreatorListingStatus,
} from "../../../../../../../../../modules/marketplace-listing/models";
import { SUBSCRIPTION_MODULE } from "../../../../../../../../../modules/subscription";
import type SubscriptionModuleService from "../../../../../../../../../modules/subscription/service";
import {
  SubscriptionInterval,
  SubscriptionType,
} from "../../../../../../../../../modules/subscription/types";
import { createSubscriptionWorkflow } from "../../../../../../../../../workflows/subscription";
import { SUBSCRIPTION_PAYMENT_PROVIDER_ID } from "../../../../../../../../../workflows/subscription/renew-helpers";
import createDigitalProductOrderWorkflow from "../../../../../../../../../workflows/create-digital-product-order";
import { ENTITLEMENT_MODULE } from "../../../../../../../../../modules/entitlement";
import type EntitlementModuleService from "../../../../../../../../../modules/entitlement/service";
import { EntitlementKind } from "../../../../../../../../../modules/entitlement/models";
import { resolveOrCreateCustomerForBlackoutUser } from "../../../../../../../../../lib/blackout-identity";
import {
  ensureListingProduct,
  ensureRecurringListingMarkedUntilCanceled,
} from "../../../../../../../../../lib/blackout-listing-product";
import {
  AUTO_RENEW_APPROVAL_METADATA_KEY,
  extractPaymentMethodId,
  extractStripeClientSecret,
  formatCheckoutPrice,
  getCustomerEmailAndMxid,
  mapListingRecurrence,
  navigatedFromOwnPage,
  parseAutoRenewAnswer,
  paymentSessionAnswer,
  paymentSessionMayBePaid,
  resolveRegionIdForCurrency,
  sanitizeCheckoutMetadata,
  type PaymentSessionAnswer,
} from "../../../../../../../../../lib/blackout-checkout";
import {
  consumerSubscriptionsEnabled,
  isUntilCanceledForProduct,
} from "../../../../../../../../../workflows/subscription/grace-lifecycle";
import { saveAutoRenewPaymentMethod } from "../../../../../../../../../workflows/subscription/auto-renew";
import { AUTO_RENEW_DISCLOSURE_VERSION } from "../../../../../../../../../modules/subscription/utils/auto-renew";
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  autoRenewDisclosure,
  oneTimeTerms,
} from "../../../../../../../../../modules/subscription/utils/auto-renew-copy";

const log = createLogger(
  "api/v1/integrations/blackout/commerce/checkout/sessions/[token]/page",
);

/**
 * Hosted FBM checkout page for a Blackout-initiated session (§5, W1b).
 *
 * The session token resolves a stateful `blackout_checkout_session` row; this
 * page materializes the real purchase around it, idempotently:
 *   render → ensure customer (create-on-miss) → ensure the listing's shadow
 *   product → ensure cart (+ payment collection + Stripe payment session,
 *   saved for off-session renewals) → the member pays →
 *   ?action=complete → subscription listings run createSubscriptionWorkflow
 *   (cart → order → subscription → tier entitlement bundle), everything else
 *   runs the standard digital-product order flow → the order.placed webhook
 *   posts `purchase.succeeded` (metadata echo included) back to Blackout.
 *
 * Re-renders and retries reuse the recorded cart; a completed session renders
 * (and postMessages) the completed state instead of purchasing twice.
 *
 * FF_CONSUMER_SUBSCRIPTIONS_V1, recurring listings only (operator answer
 * 2026-10-05: "renew upon approval" applies here too): the page asks the
 * auto-renew question with the storefront's exact checkbox and disclosure
 * (modules/subscription/utils/auto-renew-copy.ts), unticked by default, and
 * `?action=complete` refuses to run without an explicit
 * `auto_renew_approved=true|false`. The box renders ticked only on a
 * navigation the page's own toggle made (`navigatedFromOwnPage`): whoever
 * builds the page URL — the integrator setting the iframe src included —
 * cannot deliver it pre-ticked. Only such a render starts a payment session
 * that keeps the card, and it marks the intent with the disclosure version
 * approved; the completion accepts an approval only against a session so
 * marked. Approved → the terms the store route
 * gives (until cancelled only for a product marked
 * `subscription_until_canceled`, which the page writes once onto a recurring
 * listing's own shadow product — see `autoRenewOffered`), the approval
 * recorded with its time and
 * disclosure version, the card kept for off-session renewals. Declined →
 * exactly one period, never renewed, and the payment session is started
 * WITHOUT off-session setup, so the card is not kept at all. Flag off, or a
 * one-off listing: every byte of the page, the completion and the stored rows
 * is what it always was. See `AutoRenewAnswer` and `autoRenewMode`.
 */

interface TokenPayload {
  sid: string;
}

type SessionRow = {
  id: string;
  blackout_user_id: string;
  listing_id: string;
  mxid: string | null;
  /** Caller-chosen charge amount in minor units; null means the listing prices itself. */
  amount_cents: number | null;
  customer_id: string | null;
  cart_id: string | null;
  order_id: string | null;
  subscription_id: string | null;
  status: string;
  embed: boolean;
  embed_origin: string | null;
  return_url: string | null;
  requested_metadata: unknown;
};

type ListingRow = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  status: string;
  category: string | null;
  price_cents: number | null;
  currency: string | null;
  entitlement_kind: string | null;
  feature_keys: unknown;
  media_urls: unknown;
  interval: string | null;
  period_days: number | null;
  product_id: string | null;
  variant_id: string | null;
  metadata: Record<string, unknown> | null;
  slug: string;
};

function decodeToken(token: string): TokenPayload | null {
  if (!config.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      audience: "fbm-blackout-checkout",
    });
    if (typeof decoded !== "object" || !decoded) return null;
    const sid = (decoded as Record<string, unknown>)["sid"];
    if (typeof sid !== "string" || !sid) return null;
    return { sid };
  } catch {
    return null;
  }
}

function listingService(req: MedusaRequest): MarketplaceListingService {
  return req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE,
  );
}

async function loadSession(
  req: MedusaRequest,
  sid: string,
): Promise<SessionRow | null> {
  try {
    const record =
      await listingService(req).retrieveBlackoutCheckoutSession(sid);
    return record as unknown as SessionRow;
  } catch {
    return null;
  }
}

async function loadListing(
  req: MedusaRequest,
  listingId: string,
): Promise<ListingRow | null> {
  const [listing] = await listingService(req).listCreatorListings({
    id: listingId,
  });
  return (listing as unknown as ListingRow | undefined) ?? null;
}

function featureKeysOf(listing: ListingRow): string[] {
  if (!Array.isArray(listing.feature_keys)) return [];
  return listing.feature_keys.filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
}

function entitlementKindOf(listing: ListingRow): EntitlementKind | undefined {
  const raw = listing.entitlement_kind;
  if (!raw) return undefined;
  return (Object.values(EntitlementKind) as string[]).includes(raw)
    ? (raw as EntitlementKind)
    : undefined;
}

function blackoutTierOf(listing: ListingRow): string {
  const fromMetadata = listing.metadata?.["blackout_tier"];
  if (typeof fromMetadata === "string" && fromMetadata.length > 0)
    return fromMetadata;
  return listing.slug;
}

type CartView = {
  cart_id: string;
  completed: boolean;
  total: string | null;
  currency_code: string | null;
  client_secret: string | null;
  payment_session_data: unknown;
  payment_session_status?: string | null;
};

// ---------------------------------------------------------------------------
// Auto-renew approval (FF_CONSUMER_SUBSCRIPTIONS_V1, recurring listings)
// ---------------------------------------------------------------------------

/**
 * A completion the member's auto-renew answer does not allow. Thrown before
 * anything is completed or charged; the handlers turn it into its status
 * (400 missing/invalid answer, 409 an answer that cannot be honoured).
 */
class AutoRenewRefusal extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutoRenewRefusal";
  }
}

/** The member's answer, validated: approved names the disclosure it saw. */
type AutoRenewAnswer = {
  approved: boolean;
  disclosure_version: string | null;
};

/** What the hosted page carried to the completion (query or JSON body). */
type AutoRenewAnswerInput = {
  approved: unknown;
  disclosure_version: unknown;
};

/**
 * The recurrence of a listing whose checkout asks the auto-renew question,
 * or null when it does not — always null with the flag off and for one-off
 * listings, so those paths never reach anything below.
 */
function autoRenewMode(listing: ListingRow) {
  if (!consumerSubscriptionsEnabled()) return null;
  return mapListingRecurrence(listing);
}

/**
 * Whether the listing's product may be sold until cancelled (product
 * metadata `subscription_until_canceled` — the same marker the subscription
 * step reads). The checkbox is offered only then: an approval for any other
 * product would be bought for one period anyway, so the page must not ask.
 *
 * A recurring listing was sold as a renewing membership before the flag, so
 * its shadow product MAY be sold until cancelled: the first time the question
 * is asked, the marker is merged onto that product once
 * (`ensureRecurringListingMarkedUntilCanceled`; an explicit opt-out already on
 * the product is kept). The offer is then read back through the same lookup
 * the create step uses, so the page and the subscription agree. Only reached
 * in auto-renew mode (flag on, recurring listing).
 */
async function autoRenewOffered(
  req: MedusaRequest,
  listing: ListingRow,
): Promise<boolean> {
  const ensured = await ensureListingProduct(req.scope, listing);
  listing.product_id = ensured.product_id;
  listing.variant_id = ensured.variant_id;
  await ensureRecurringListingMarkedUntilCanceled(
    req.scope,
    listing,
    ensured.product_id,
  );
  return isUntilCanceledForProduct(req.scope, ensured.product_id);
}

/** Validate the answer carried to the completion; refuse rather than guess. */
function validateAutoRenewAnswer(
  input: AutoRenewAnswerInput | undefined,
): AutoRenewAnswer {
  const approved = parseAutoRenewAnswer(input?.approved);
  if (approved === null) {
    throw new AutoRenewRefusal(
      400,
      "auto_renew_answer_required",
      "auto_renew_approved is required and must be true or false",
    );
  }
  if (approved && input?.disclosure_version !== AUTO_RENEW_DISCLOSURE_VERSION) {
    throw new AutoRenewRefusal(
      409,
      "auto_renew_disclosure_outdated",
      `The auto-renewal terms have changed (current version ${AUTO_RENEW_DISCLOSURE_VERSION}). ` +
        `Review the current terms and approve again.`,
    );
  }
  return {
    approved,
    disclosure_version: approved ? AUTO_RENEW_DISCLOSURE_VERSION : null,
  };
}

/**
 * The payment-session setup an answer calls for, when a session is (re)started.
 * `keepCard` is true only for an approval the page verified as the member's
 * own tick: such a session keeps the card and carries the approval mark.
 */
type PaymentSetup = {
  keepCard: boolean;
  /** Replace an unpaid session that does not fit this setup. */
  replaceMismatched: boolean;
};

/** Whether a session already started fits the setup a render calls for. */
function sessionFitsSetup(data: unknown, setup: PaymentSetup): boolean {
  const recorded = paymentSessionAnswer(data);
  return setup.keepCard
    ? recorded.kind === "approved" &&
        recorded.disclosure_version === AUTO_RENEW_DISCLOSURE_VERSION
    : recorded.kind === "declined";
}

/** Whether what a payment session was started for honours the answer. */
function sessionHonoursAnswer(
  recorded: PaymentSessionAnswer | null,
  answer: AutoRenewAnswer,
): boolean {
  if (!recorded) return false;
  return answer.approved
    ? recorded.kind === "approved" &&
        recorded.disclosure_version === answer.disclosure_version
    : recorded.kind === "declined";
}

/**
 * What a cart's payment was started for, read back from its payment sessions
 * (a completed cart included): an approval mark on any session wins, then a
 * kept card without one, else declined. Null when the cart has no session.
 */
async function recordedAnswerOfCart(
  req: MedusaRequest,
  cartId: string | null,
): Promise<PaymentSessionAnswer | null> {
  const cart = cartId ? await queryCart(req, cartId) : null;
  const sessions = cart?.payment_collection?.payment_sessions ?? [];
  if (sessions.length === 0) return null;
  const answers = sessions.map((s) => paymentSessionAnswer(s?.data));
  return (
    answers.find((a) => a.kind === "approved") ??
    answers.find((a) => a.kind === "unasked") ??
    answers[0]
  );
}

/**
 * Refuse a completion whose answer the payment does not honour. A session
 * that keeps the card with no approval mark was started before the page
 * asked the question (a payment begun before the flag was turned on): no
 * answer is inferred from it either way — an approval would be one nobody
 * gave, a decline would leave a card kept — so it is refused for an operator
 * to resolve, and logged so one can.
 */
function assertSessionHonoursAnswer(
  recorded: PaymentSessionAnswer | null,
  answer: AutoRenewAnswer,
  record: SessionRow,
): void {
  if (recorded?.kind === "unasked") {
    log.error(
      `[auto-renew] Blackout checkout session ${record.id} (cart ${record.cart_id}): ` +
        `its payment keeps the card but was set up before the auto-renew question was ` +
        `asked; completion refused. Operator: void or refund the payment, or complete it by hand.`,
    );
    throw new AutoRenewRefusal(
      409,
      "auto_renew_not_asked",
      "This checkout's payment was set up before the renewal question was asked, so it cannot be completed here. Contact support.",
    );
  }
  if (!sessionHonoursAnswer(recorded, answer)) {
    throw new AutoRenewRefusal(
      409,
      "auto_renew_answer_mismatch",
      "The renewal choice does not match the payment on this checkout. Reload the checkout page and pay again.",
    );
  }
}

async function queryCart(req: MedusaRequest, cartId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "total",
      "currency_code",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.status",
    ],
    filters: { id: cartId },
  });
  return (data?.[0] ?? null) as {
    id: string;
    completed_at?: string | Date | null;
    total?: number | string | null;
    currency_code?: string | null;
    payment_collection?: {
      id: string;
      payment_sessions?: Array<{ id: string; data?: unknown; status?: string }>;
    } | null;
  } | null;
}

/**
 * Idempotently materialize customer, shadow product, cart, payment collection
 * and payment session for the session record. Every artifact is persisted
 * back onto the record so a re-render resumes instead of duplicating.
 */
async function materialize(
  req: MedusaRequest,
  record: SessionRow,
  listing: ListingRow,
  /**
   * Auto-renew mode only: whether the payment session keeps the card. Absent
   * (flag off, one-off listings) the session is started exactly as before.
   */
  setup?: PaymentSetup,
): Promise<CartView> {
  const service = listingService(req);

  // 1. Customer (create-on-miss keeps Blackout-native members purchasable).
  let customerId = record.customer_id;
  if (!customerId) {
    const resolved = await resolveOrCreateCustomerForBlackoutUser(req.scope, {
      blackoutUserId: record.blackout_user_id,
      mxid: record.mxid,
    });
    if (!resolved) {
      throw new Error(
        "Could not resolve or create a customer for this session",
      );
    }
    customerId = resolved.customerId;
    await service.updateBlackoutCheckoutSessions({
      id: record.id,
      customer_id: customerId,
    });
    record.customer_id = customerId;
  }

  // 2. Shadow product (persists product_id/variant_id on the listing).
  const { variant_id } = await ensureListingProduct(req.scope, listing);

  // 3. Cart.
  let cart = record.cart_id ? await queryCart(req, record.cart_id) : null;
  if (record.cart_id && !cart) {
    // Recorded cart vanished (env reset); mint a fresh one below.
    record.cart_id = null;
  }
  if (cart?.completed_at) {
    return {
      cart_id: cart.id,
      completed: true,
      total: cart.total != null ? String(cart.total) : null,
      currency_code: cart.currency_code ?? null,
      client_secret: null,
      payment_session_data: null,
    };
  }

  if (!cart) {
    const currency = (listing.currency ?? "usd").toLowerCase();
    const regionId = await resolveRegionIdForCurrency(req.scope, currency);
    if (!regionId) {
      throw new Error(`No region is configured for currency ${currency}`);
    }
    const { email, mxid: customerMxid } = await getCustomerEmailAndMxid(
      req.scope,
      customerId,
    );
    const mxid = record.mxid ?? customerMxid;

    const echo = sanitizeCheckoutMetadata(record.requested_metadata) ?? {};
    const cartMetadata: Record<string, unknown> = {
      ...echo,
      blackout_user_id: record.blackout_user_id,
      fbm_external_customer_id: record.blackout_user_id,
      creator_listing_id: listing.id,
      blackout_checkout_session_id: record.id,
      ...(mxid ? { mxid } : {}),
    };

    const { result } = await createCartWorkflow(req.scope).run({
      input: {
        region_id: regionId,
        customer_id: customerId,
        email: email ?? undefined,
        currency_code: currency,
        items: [
          {
            variant_id,
            quantity: 1,
            // A caller-chosen amount overrides the listing's price. Medusa
            // treats a supplied unit_price as a custom price and skips the
            // variant's calculated price entirely
            // (core-flows get-variants-and-items-with-prices: isCustomPrice).
            // Medusa v2 prices are major units; the session stores cents.
            ...(typeof record.amount_cents === "number"
              ? { unit_price: record.amount_cents / 100 }
              : {}),
            // listing_id/entitlement_kind drive the purchase.succeeded emit:
            // providerListingId must be the catalog id Blackout knows, and the
            // kind decides dead-drop behavior (a subscription_tier must never
            // read as a deliverable vault item).
            metadata: {
              creator_listing_id: listing.id,
              listing_id: listing.id,
              ...(listing.entitlement_kind
                ? { entitlement_kind: listing.entitlement_kind }
                : {}),
            },
          },
        ],
        metadata: cartMetadata,
      },
    });
    const createdCartId = (result as { id?: string })?.id;
    if (!createdCartId) {
      throw new Error("Cart creation returned no id");
    }
    await service.updateBlackoutCheckoutSessions({
      id: record.id,
      cart_id: createdCartId,
    });
    record.cart_id = createdCartId;
    cart = await queryCart(req, createdCartId);
    if (!cart) throw new Error("Cart not found after creation");
  }

  // 4. Payment collection + payment session (saved method for renewals).
  if (!cart.payment_collection?.id) {
    await createPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id: cart.id },
    });
    cart = await queryCart(req, cart.id);
    if (!cart?.payment_collection?.id) {
      throw new Error("Payment collection not found after creation");
    }
  }

  let session = cart.payment_collection.payment_sessions?.[0] ?? null;
  // Auto-renew mode: the member changed their answer before paying (or the
  // session predates the question). Start a fresh session with the matching
  // setup (createPaymentSessionsWorkflow deletes the collection's existing
  // session). A session that may already be paid is never replaced; the
  // completion then refuses the mismatch.
  if (
    setup?.replaceMismatched &&
    session &&
    !sessionFitsSetup(session.data, setup) &&
    !paymentSessionMayBePaid(session)
  ) {
    session = null;
  }
  if (!session) {
    await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: cart.payment_collection.id,
        provider_id: SUBSCRIPTION_PAYMENT_PROVIDER_ID,
        customer_id: customerId,
        // Ask the provider to save the method for off-session renewals; the
        // renewal workflow later charges `subscription.payment_method_id`.
        // Auto-renew mode asks only when the member approved renewal: a
        // declined purchase never renews, so its card is not kept. The
        // approval mark (the disclosure version) rides on the intent's
        // metadata, so the completion reads it back from the session.
        ...(!setup || setup.keepCard
          ? {
              data: {
                setup_future_usage: "off_session",
                ...(setup
                  ? {
                      metadata: {
                        [AUTO_RENEW_APPROVAL_METADATA_KEY]:
                          AUTO_RENEW_DISCLOSURE_VERSION,
                      },
                    }
                  : {}),
              },
              context: { setup_future_usage: "off_session" },
            }
          : {}),
      },
    });
    cart = await queryCart(req, cart.id);
    session = cart?.payment_collection?.payment_sessions?.[0] ?? null;
  }

  return {
    cart_id: cart!.id,
    completed: false,
    total: cart!.total != null ? String(cart!.total) : null,
    currency_code: cart!.currency_code ?? null,
    client_secret: extractStripeClientSecret(session?.data),
    payment_session_data: session?.data ?? null,
    payment_session_status: session?.status ?? null,
  };
}

type CompletionResult = {
  order_id: string | null;
  subscription_id: string | null;
};

/**
 * A completed session is never re-completed with a different answer: the
 * answer it was completed with is read back from what it actually did — the
 * card-saving setting and approval mark of the cart's payment session. A
 * different answer, or a cart that can no longer be read, is refused (409);
 * the same answer returns the recorded ids like any retry.
 */
async function assertCompletedWithSameAnswer(
  req: MedusaRequest,
  record: SessionRow,
  answer: AutoRenewAnswer,
): Promise<void> {
  const recorded = await recordedAnswerOfCart(req, record.cart_id);
  if (!sessionHonoursAnswer(recorded, answer)) {
    throw new AutoRenewRefusal(
      409,
      "auto_renew_answer_conflict",
      "This checkout was already completed with a different renewal choice.",
    );
  }
}

/**
 * Complete the session's cart into an order (and, for subscription-category
 * listings, a subscription + tier entitlement bundle). Idempotent: a session
 * already completed returns the recorded ids.
 */
async function completeCheckout(
  req: MedusaRequest,
  record: SessionRow,
  listing: ListingRow,
  answerInput?: AutoRenewAnswerInput,
): Promise<CompletionResult> {
  // Auto-renew mode: the answer is validated before anything else, so a
  // missing or stale one is refused even for a session already completed.
  const renewMode = autoRenewMode(listing);
  const answer = renewMode ? validateAutoRenewAnswer(answerInput) : null;

  if (record.status === BlackoutCheckoutSessionStatus.COMPLETED) {
    if (answer) await assertCompletedWithSameAnswer(req, record, answer);
    return {
      order_id: record.order_id,
      subscription_id: record.subscription_id,
    };
  }

  if (answer?.approved && !(await autoRenewOffered(req, listing))) {
    throw new AutoRenewRefusal(
      409,
      "auto_renew_not_offered",
      "Automatic renewal is not offered for this listing.",
    );
  }

  // Ensure the cart/payment stack exists (direct ?action=complete hits). In
  // auto-renew mode a session the completion itself has to start was never
  // paid and never carries an approval (only a verified render mints one),
  // so it starts without card-saving and nothing already there is replaced.
  const view = await materialize(
    req,
    record,
    listing,
    answer ? { keepCard: false, replaceMismatched: false } : undefined,
  );
  const cartId = view.cart_id;
  const service = listingService(req);

  // The member paid against this session as it is: a session that kept the
  // card cannot complete a declined purchase (the card would stay saved), and
  // one not started for an approval cannot complete one (renewals would have
  // no card, or an approval nobody gave would be recorded). A cart completed
  // by an earlier attempt whose record was never marked completed is read
  // back from its own payment sessions, so the retry finishes the record.
  if (answer) {
    const recorded = view.completed
      ? await recordedAnswerOfCart(req, cartId)
      : paymentSessionAnswer(view.payment_session_data);
    assertSessionHonoursAnswer(recorded, answer, record);
  }

  const recurrence = mapListingRecurrence(listing);
  let orderId: string | null = null;
  let subscriptionId: string | null = null;

  if (recurrence) {
    const { result } = await createSubscriptionWorkflow(req.scope).run({
      input: {
        cart_id: cartId,
        subscription_data: {
          interval: recurrence.interval,
          period: recurrence.period,
          type: SubscriptionType.MEMBERSHIP,
          // The answer the create step turns into terms (decideCreateTerms).
          ...(answer
            ? {
                auto_renew: {
                  approved: answer.approved,
                  disclosure_version: answer.disclosure_version,
                  approved_at: new Date().toISOString(),
                },
              }
            : {}),
        },
      },
    });
    orderId = (result.order as { id?: string })?.id ?? null;
    const subscription = result.subscription as
      | {
          id: string;
          next_order_date?: Date | string | null;
          expiration_date?: Date | string | null;
          auto_renew_approved?: boolean | null;
          metadata?: Record<string, unknown> | null;
        }
      | undefined;
    subscriptionId = subscription?.id ?? null;

    if (subscription) {
      // Gap C: persist the saved payment method + Blackout tier identity so
      // off-session renewals and tier mapping have what they need. In
      // auto-renew mode the card is written only by saveAutoRenewPaymentMethod
      // below — and only for an approved, until-cancelled subscription.
      try {
        const completedCart = answer ? null : await queryCart(req, cartId);
        const sessionData =
          completedCart?.payment_collection?.payment_sessions?.[0]?.data ??
          view.payment_session_data;
        const paymentMethodId = answer
          ? null
          : extractPaymentMethodId(sessionData);
        const subscriptionService =
          req.scope.resolve<SubscriptionModuleService>(SUBSCRIPTION_MODULE);
        await subscriptionService.updateSubscriptions({
          selector: { id: subscription.id },
          data: {
            ...(paymentMethodId ? { payment_method_id: paymentMethodId } : {}),
            seller_id: listing.seller_id,
            metadata: {
              ...(subscription.metadata ?? {}),
              blackout_tier: blackoutTierOf(listing),
              blackout_user_id: record.blackout_user_id,
              creator_listing_id: listing.id,
              blackout_checkout_session_id: record.id,
            },
          },
        });
      } catch (error) {
        log.error(
          "Failed to persist payment method / tier on subscription:",
          error,
        );
      }
      if (answer) {
        await saveAutoRenewPaymentMethod(req.scope, {
          subscription,
          cart_id: cartId,
        });
      }

      // Tier bundle grant — bypasses EntitlementGrantRule by design; the
      // listing's feature_keys ARE the tier definition.
      try {
        const featureKeys = featureKeysOf(listing);
        if (featureKeys.length > 0) {
          const { mxid: customerMxid } = record.customer_id
            ? await getCustomerEmailAndMxid(req.scope, record.customer_id)
            : { mxid: null };
          const entitlementService =
            req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE);
          // A one-period subscription (auto-renew declined) schedules no next
          // order; its access ends with the period it paid for, never "never".
          const accessEnds =
            subscription.next_order_date ??
            (answer ? subscription.expiration_date : null);
          const expiresAt = accessEnds ? new Date(accessEnds) : null;
          await entitlementService.grantBundleFromSubscription({
            subscription_id: subscription.id,
            customer_id: record.customer_id,
            customer_external_id: record.mxid ?? customerMxid,
            seller_id: listing.seller_id,
            feature_keys: featureKeys,
            kind: entitlementKindOf(listing) ?? EntitlementKind.ACCESS_PASS,
            expires_at: expiresAt,
          });
        }
      } catch (error) {
        log.error("Failed to grant subscription tier entitlements:", error);
      }
    }
  } else {
    const { result } = await createDigitalProductOrderWorkflow(req.scope).run({
      input: { cart_id: cartId },
    });
    orderId =
      (result as { order?: { id?: string } } | undefined)?.order?.id ?? null;

    // One-off listings grant their feature_keys directly (the shadow product
    // has no EntitlementGrantRule rows).
    try {
      const featureKeys = featureKeysOf(listing);
      if (featureKeys.length > 0 && orderId) {
        const { mxid: customerMxid } = record.customer_id
          ? await getCustomerEmailAndMxid(req.scope, record.customer_id)
          : { mxid: null };
        const entitlementService =
          req.scope.resolve<EntitlementModuleService>(ENTITLEMENT_MODULE);
        for (const featureKey of featureKeys) {
          await entitlementService.grant({
            customer_id: record.customer_id,
            customer_external_id: record.mxid ?? customerMxid,
            seller_id: listing.seller_id,
            product_id: listing.product_id,
            variant_id: listing.variant_id,
            feature_key: featureKey,
            kind: entitlementKindOf(listing),
            source_order_id: orderId,
          });
        }
      }
    } catch (error) {
      log.error("Failed to grant one-off listing entitlements:", error);
    }
  }

  await service.updateBlackoutCheckoutSessions({
    id: record.id,
    status: BlackoutCheckoutSessionStatus.COMPLETED,
    order_id: orderId,
    subscription_id: subscriptionId,
  });
  record.status = BlackoutCheckoutSessionStatus.COMPLETED;
  record.order_id = orderId;
  record.subscription_id = subscriptionId;

  return { order_id: orderId, subscription_id: subscriptionId };
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.token || "");
  const payload = decodeToken(token);
  if (!payload) {
    res
      .status(401)
      .type("text/html")
      .send(renderError("Invalid or expired checkout session"));
    return;
  }

  const record = await loadSession(req, payload.sid);
  if (!record) {
    res
      .status(404)
      .type("text/html")
      .send(renderError("Checkout session not found"));
    return;
  }
  const listing = await loadListing(req, record.listing_id);
  if (!listing || listing.status !== CreatorListingStatus.PUBLISHED) {
    res
      .status(409)
      .type("text/html")
      .send(renderError("Listing is no longer available"));
    return;
  }

  const embed = req.query.embed === "1" || record.embed;
  const embedOrigin = record.embed_origin ?? undefined;
  applySecurityHeaders(res, { embed, embedOrigin });

  const action = String(req.query.action || "");

  if (action === "complete") {
    try {
      const completion = await completeCheckout(req, record, listing, {
        approved: req.query.auto_renew_approved,
        disclosure_version: req.query.auto_renew_disclosure_version,
      });
      res
        .status(200)
        .type("text/html")
        .send(
          renderResult({
            embed,
            embedOrigin,
            event: "checkout.completed",
            payload: {
              order_id: completion.order_id,
              subscription_id: completion.subscription_id,
              cart_id: record.cart_id,
              session_id: record.id,
            },
            returnTarget: record.return_url ?? undefined,
          }),
        );
    } catch (err) {
      if (err instanceof AutoRenewRefusal) {
        res
          .status(err.status)
          .type("text/html")
          .send(
            renderResult({
              embed,
              embedOrigin,
              event: "checkout.error",
              payload: {
                message: err.message,
                code: err.code,
                session_id: record.id,
              },
            }),
          );
        return;
      }
      const message = err instanceof Error ? err.message : "Checkout failed";
      log.error("Blackout checkout completion failed:", err);
      res
        .status(500)
        .type("text/html")
        .send(
          renderResult({
            embed,
            embedOrigin,
            event: "checkout.error",
            payload: { message, session_id: record.id },
          }),
        );
    }
    return;
  }

  if (action === "cancel") {
    res
      .status(200)
      .type("text/html")
      .send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.cancelled",
          payload: { session_id: record.id, cart_id: record.cart_id },
          returnTarget: record.return_url ?? undefined,
        }),
      );
    return;
  }

  if (record.status === BlackoutCheckoutSessionStatus.COMPLETED) {
    res
      .status(200)
      .type("text/html")
      .send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.completed",
          payload: {
            order_id: record.order_id,
            subscription_id: record.subscription_id,
            cart_id: record.cart_id,
            session_id: record.id,
          },
          returnTarget: record.return_url ?? undefined,
        }),
      );
    return;
  }

  try {
    // Auto-renew mode: the box starts unticked (no answer → not approved),
    // and is offered only for a product that may be sold until cancelled.
    // It renders ticked only when the page's own toggle navigated here: a
    // URL built elsewhere (an iframe src, a link) with auto_renew_approved=true
    // still renders unticked, so a tick is always the member's act.
    // Each answer gets a payment session with the matching card-saving setup.
    const renewMode = autoRenewMode(listing);
    let renewView: AutoRenewView | undefined;
    let setup: PaymentSetup | undefined;
    if (renewMode) {
      const offered = await autoRenewOffered(req, listing);
      const approved =
        offered &&
        parseAutoRenewAnswer(req.query.auto_renew_approved) === true &&
        navigatedFromOwnPage(req.headers);
      setup = { keepCard: approved, replaceMismatched: true };
      renewView = { interval: renewMode.interval, offered, approved, locked: false };
    }
    const view = await materialize(req, record, listing, setup);
    if (renewView) {
      const sessionView = {
        status: view.payment_session_status,
        data: view.payment_session_data,
      };
      if (paymentSessionMayBePaid(sessionView)) {
        // Possibly paid already: the answer is the one the payment was made
        // with, shown and carried as it is. Only a session started for a
        // verified approval reads as approved; one that predates the question
        // is never taken as an approval (its completion is refused).
        renewView.locked = true;
        renewView.approved =
          paymentSessionAnswer(view.payment_session_data).kind === "approved";
      }
    }
    if (view.completed) {
      res
        .status(200)
        .type("text/html")
        .send(
          renderResult({
            embed,
            embedOrigin,
            event: "checkout.completed",
            payload: {
              order_id: record.order_id,
              cart_id: view.cart_id,
              session_id: record.id,
            },
            returnTarget: record.return_url ?? undefined,
          }),
        );
      return;
    }
    res
      .status(200)
      .type("text/html")
      .send(
        renderPayPage({
          embed,
          embedOrigin,
          listingTitle: listing.title,
          total: view.total,
          currency: view.currency_code,
          clientSecret: view.client_secret,
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
          sessionId: record.id,
          cartId: view.cart_id,
          ...(renewView ? { autoRenew: renewView } : {}),
        }),
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout unavailable";
    log.error("Blackout checkout materialization failed:", err);
    res
      .status(500)
      .type("text/html")
      .send(
        renderResult({
          embed,
          embedOrigin,
          event: "checkout.error",
          payload: { message, session_id: record.id },
        }),
      );
  }
}

/**
 * Programmatic completion for non-iframe consumers and tests: completes the
 * session's cart and returns JSON instead of HTML.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.params.token || "");
  const payload = decodeToken(token);
  if (!payload) {
    return res
      .status(401)
      .json({ code: "unauthorized", message: "Invalid or expired session" });
  }
  const record = await loadSession(req, payload.sid);
  if (!record) {
    return res
      .status(404)
      .json({ code: "not_found", message: "Checkout session not found" });
  }
  const listing = await loadListing(req, record.listing_id);
  if (!listing || listing.status !== CreatorListingStatus.PUBLISHED) {
    return res
      .status(409)
      .json({
        code: "listing_not_purchasable",
        message: "Listing is no longer available",
      });
  }

  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const completion = await completeCheckout(req, record, listing, {
      approved: body["auto_renew_approved"],
      disclosure_version: body["auto_renew_disclosure_version"],
    });
    return res.json({
      id: record.id,
      status: "completed",
      order_id: completion.order_id,
      subscription_id: completion.subscription_id,
      cart_id: record.cart_id,
    });
  } catch (err) {
    if (err instanceof AutoRenewRefusal) {
      return res.status(err.status).json({ code: err.code, message: err.message });
    }
    const message = err instanceof Error ? err.message : "Checkout failed";
    log.error("Blackout checkout completion failed:", err);
    return res.status(500).json({ code: "checkout_failed", message });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function applySecurityHeaders(
  res: MedusaResponse,
  args: { embed: boolean; embedOrigin?: string },
) {
  const frameAncestors =
    args.embed && args.embedOrigin ? args.embedOrigin : "'self'";
  if (args.embed && args.embedOrigin) {
    res.removeHeader("X-Frame-Options");
  }
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; ` +
      `style-src 'unsafe-inline'; frame-src https://js.stripe.com; ` +
      `connect-src 'self' https://api.stripe.com; frame-ancestors ${frameAncestors}`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderError(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Checkout error</title></head><body><h1>Checkout error</h1><p>${escapeHtml(
    message,
  )}</p></body></html>`;
}

const PAGE_STYLE = `
    body { font-family: system-ui, sans-serif; padding: 16px; max-width: 480px; margin: 0 auto; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    button { padding: 12px 20px; border-radius: 6px; border: 0; cursor: pointer; font-size: 16px; width: 100%; }
    .pay { background: #111; color: #fff; margin-top: 16px; }
    .cancel { background: #f4f4f4; color: #111; margin-top: 8px; }
    #payment-element { margin-top: 16px; }
    .error { color: #b00020; margin-top: 12px; min-height: 1em; }
`;

/** The auto-renew question as the pay page renders it (auto-renew mode only). */
type AutoRenewView = {
  interval: SubscriptionInterval;
  /** The product may be sold until cancelled: the checkbox is shown. */
  offered: boolean;
  /** The answer this render (and its payment session) carries. */
  approved: boolean;
  /** The payment session may already be paid: the answer can no longer change. */
  locked: boolean;
};

/**
 * The checkbox, the disclosure and the one-period terms — the storefront's
 * exact strings (auto-renew-copy.ts), unticked unless the member ticked it.
 * Ticking or unticking reloads the page with the new answer, which starts the
 * payment session with the matching card-saving setup before anything is paid.
 */
function renderAutoRenewBlock(args: {
  embed: boolean;
  autoRenew: AutoRenewView;
  price: string;
}): string {
  const { autoRenew } = args;
  const copy = { price: args.price, interval: autoRenew.interval };
  const oneTime = autoRenew.approved
    ? ""
    : `
    <p id="one-time-terms">${escapeHtml(oneTimeTerms(copy))}</p>`;
  if (!autoRenew.offered) {
    return `
  <div id="auto-renew-terms">${oneTime}
  </div>`;
  }
  const embedSuffix = args.embed ? "&embed=1" : "";
  const toggle = autoRenew.locked
    ? ""
    : `
  <script>
    (function () {
      var box = document.getElementById("auto-renew-approval");
      // Once payment starts the answer is fixed; a toggle mid-payment would
      // replace the session being paid.
      document.addEventListener("submit", function () {
        box.disabled = true;
      }, true);
      box.addEventListener("change", function () {
        box.disabled = true;
        var pay = document.getElementById("submit");
        if (pay) pay.disabled = true;
        window.location.href = box.checked
          ? ${JSON.stringify(`?auto_renew_approved=true${embedSuffix}`)}
          : ${JSON.stringify(`?auto_renew_approved=false${embedSuffix}`)};
      });
    })();
  </script>`;
  return `
  <div id="auto-renew-terms">
    <label for="auto-renew-approval" style="display: flex; gap: 8px; align-items: flex-start; margin-top: 16px;">
      <input id="auto-renew-approval" type="checkbox"${autoRenew.approved ? " checked" : ""}${autoRenew.locked ? " disabled" : ""}>
      <span><strong id="auto-renew-label">${escapeHtml(AUTO_RENEW_CHECKBOX_LABEL)}</strong><br><span id="auto-renew-disclosure">${escapeHtml(autoRenewDisclosure(copy))}</span></span>
    </label>${oneTime}
  </div>${toggle}`;
}

function renderPayPage(args: {
  embed: boolean;
  embedOrigin?: string;
  listingTitle: string;
  total: string | null;
  currency: string | null;
  clientSecret: string | null;
  publishableKey: string | null;
  sessionId: string;
  cartId: string;
  autoRenew?: AutoRenewView;
}): string {
  // Auto-renew mode carries the answer (and, for an approval, the disclosure
  // version shown) to ?action=complete, which refuses to run without it.
  const answerQuery = args.autoRenew
    ? `&auto_renew_approved=${args.autoRenew.approved ? "true" : "false"}` +
      (args.autoRenew.approved
        ? `&auto_renew_disclosure_version=${encodeURIComponent(AUTO_RENEW_DISCLOSURE_VERSION)}`
        : "")
    : "";
  const completeUrl = `?action=complete${args.embed ? "&embed=1" : ""}${answerQuery}`;
  const cancelUrl = `?action=cancel${args.embed ? "&embed=1" : ""}`;
  const total = args.total ?? "—";
  const currency = args.currency ? args.currency.toUpperCase() : "";
  const useStripe = !!(args.clientSecret && args.publishableKey);
  const safeOrigin = JSON.stringify(args.embedOrigin ?? "");
  const readyPayload = JSON.stringify({
    session_id: args.sessionId,
    cart_id: args.cartId,
  });

  const stripeBlock = useStripe
    ? `
  <form id="payment-form">
    <div id="payment-element"></div>
    <button class="pay" id="submit" type="submit">Pay ${escapeHtml(total)} ${escapeHtml(
      currency,
    )}</button>
    <div class="error" id="error-message"></div>
  </form>
  <script src="https://js.stripe.com/v3/"></script>
  <script>
    (function () {
      var stripe = Stripe(${JSON.stringify(args.publishableKey)});
      var elements = stripe.elements({ clientSecret: ${JSON.stringify(
        args.clientSecret,
      )} });
      var paymentElement = elements.create("payment");
      paymentElement.mount("#payment-element");
      var form = document.getElementById("payment-form");
      var button = document.getElementById("submit");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        button.disabled = true;
        stripe
          .confirmPayment({ elements: elements, redirect: "if_required" })
          .then(function (result) {
            if (result.error) {
              document.getElementById("error-message").textContent =
                result.error.message || "Payment failed";
              button.disabled = false;
              return;
            }
            window.location.href = ${JSON.stringify(completeUrl)};
          });
      });
    })();
  </script>`
    : args.autoRenew
      ? // A GET form replaces its action's query string with its fields, so
        // the answer travels as fields here.
        `
  <form method="GET" action="">
    <input type="hidden" name="action" value="complete">${
      args.embed
        ? `
    <input type="hidden" name="embed" value="1">`
        : ""
    }
    <input type="hidden" name="auto_renew_approved" value="${args.autoRenew.approved ? "true" : "false"}">${
      args.autoRenew.approved
        ? `
    <input type="hidden" name="auto_renew_disclosure_version" value="${escapeHtml(AUTO_RENEW_DISCLOSURE_VERSION)}">`
        : ""
    }
    <button class="pay" type="submit">Confirm and pay ${escapeHtml(total)} ${escapeHtml(
      currency,
    )}</button>
  </form>`
      : `
  <form method="GET" action="${escapeHtml(completeUrl)}">
    <button class="pay" type="submit">Confirm and pay ${escapeHtml(total)} ${escapeHtml(
      currency,
    )}</button>
  </form>`;
  const autoRenewBlock = args.autoRenew
    ? renderAutoRenewBlock({
        embed: args.embed,
        autoRenew: args.autoRenew,
        price: formatCheckoutPrice(args.total, args.currency),
      })
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Free Black Market — Checkout</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>Checkout</h1>
  <div class="row"><span>Item</span><span>${escapeHtml(args.listingTitle)}</span></div>
  <div class="row"><span>Total</span><span>${escapeHtml(total)} ${escapeHtml(
    currency,
  )}</span></div>
  ${autoRenewBlock}${stripeBlock}
  <form method="GET" action="${escapeHtml(cancelUrl)}">
    <button class="cancel" type="submit">Cancel</button>
  </form>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: "checkout.ready", payload: ${readyPayload} },
          origin
        );
      }
    })();
  </script>
</body>
</html>`;
}

function renderResult(args: {
  embed: boolean;
  embedOrigin?: string;
  event: "checkout.completed" | "checkout.cancelled" | "checkout.error";
  payload: Record<string, unknown>;
  returnTarget?: string;
}): string {
  const safeOrigin = JSON.stringify(args.embedOrigin ?? "");
  const safeEvent = JSON.stringify(args.event);
  const safePayload = JSON.stringify(args.payload);
  const safeReturnTarget = JSON.stringify(args.returnTarget ?? null);
  const heading =
    args.event === "checkout.completed"
      ? "Order placed"
      : args.event === "checkout.cancelled"
        ? "Checkout cancelled"
        : "Checkout error";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(heading)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; max-width: 480px; margin: 0 auto; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(heading)}</h1>
  <script>
    (function () {
      var embed = ${args.embed ? "true" : "false"};
      var origin = ${safeOrigin};
      var returnTarget = ${safeReturnTarget};
      if (embed && origin && window.parent && window.parent !== window) {
        window.parent.postMessage(
          { source: "fbm-checkout", type: ${safeEvent}, payload: ${safePayload} },
          origin
        );
      } else if (returnTarget) {
        try { window.location.href = returnTarget; } catch (e) {}
      }
    })();
  </script>
</body>
</html>`;
}
