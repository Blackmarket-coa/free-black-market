import { SubscriptionInterval } from "../modules/subscription/types"
import {
  AUTO_RENEW_CHECKBOX_LABEL,
  AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
  intervalNoun,
  reapprovalDisclosure,
} from "../modules/subscription/utils/auto-renew-copy"
import { neverRenews } from "../modules/subscription/utils/auto-renew"
import { buildRenewalCartInput, type RenewalCartData } from "../workflows/subscription/renew-helpers"
import { formatCheckoutPrice } from "./blackout-checkout"

/**
 * The Blackout subscription manage page: what each row says and offers, and
 * the HTML. Pure — no container — so every line of copy is unit-testable
 * against the row shapes that produce it.
 *
 * The copy is written to be true of what the backend does with THAT row, and
 * reuses the storefront account page's wording only where the semantics are
 * the same. The one place they are not: a legacy fixed-horizon row (bought
 * before FF_CONSUMER_SUBSCRIPTIONS_V1 — every Blackout checkout before the
 * flag — `expiration_date` set, never approved; see `isLegacyFixedHorizon`).
 * While renewals are still scheduled the storefront's chargeSummary calls it
 * "No further charges … Automatic renewal: off", but the renewal job still
 * charges it every interval until its expiration. Here it says so. Whether
 * still renewing or in its final period, it offers cancel only (contract):
 * `withdrawAutoRenew` refuses a row with an expiration date
 * (`auto_renew_not_on`), and re-approval is not offered — nor accepted by
 * the manage page's POST — for a row that was never approved.
 */

export type ManageRow = {
  id: string
  status: string
  interval: SubscriptionInterval | string
  customer_id?: string | null
  product_id?: string | null
  next_order_date?: Date | string | null
  expiration_date?: Date | string | null
  grace_ends_at?: Date | string | null
  auto_renew_approved?: boolean | null
  payment_method_id?: string | null
  metadata?: Record<string, unknown> | null
}

export type RowInfo = {
  title: string
  /**
   * Formatted price per interval that a renewal of THIS row would charge
   * (`renewalPrice`), when known; null hides re-approval.
   */
  price: string | null
}

export type ManageRowView = {
  id: string
  title: string
  status: string
  notes: string[]
  charge: string
  autoRenew: string
  offerDisable: boolean
  /** The re-approval block, when renewal may be turned back on. */
  approve: { label: string; disclosure: string } | null
  offerCancel: boolean
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })

/** Dates on this page: fixed en-US, UTC, so the page renders the same everywhere. */
export function formatManageDate(value?: Date | string | null): string | null {
  if (value === null || value === undefined || value === "") return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? DATE_FORMAT.format(d) : null
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  past_due: "Grace period",
  read_only: "Read-only",
  canceled: "Cancelled",
  expired: "Ended",
  failed: "Payment failed",
}

export const manageStatusLabel = (status: string): string => STATUS_LABEL[status] ?? status

/** Statuses a member may cancel from (the page offers cancel, the action re-checks). */
export function manageMayCancel(status: string): boolean {
  return status === "active" || status === "paused" || status === "past_due"
}

const DUNNING_PAUSE_PREFIX = "payment_failed_after_"

const isKnownInterval = (v: string): v is SubscriptionInterval =>
  (Object.values(SubscriptionInterval) as string[]).includes(v)

const time = (v?: Date | string | null): number | null => {
  if (v === null || v === undefined || v === "") return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * A legacy fixed-horizon row: an expiration date set, never approved for
 * automatic renewal, and not one the auto-renew rules stamped as bought for a
 * single period or withdrawn (`neverRenews`). Only rows created or changed
 * under FF_CONSUMER_SUBSCRIPTIONS_V1 carry that stamp, so a row bought before
 * the flag is legacy for its whole life — including its final period, when
 * `next_order_date` is already null. The contract offers such a row cancel
 * only.
 */
export function isLegacyFixedHorizon(sub: Pick<ManageRow, "expiration_date" | "auto_renew_approved" | "metadata">): boolean {
  return time(sub.expiration_date) !== null && sub.auto_renew_approved !== true && !neverRenews(sub)
}

/**
 * The price per interval a renewal of this subscription would charge, or null
 * when it cannot be determined.
 *
 * A renewal re-buys the subscription's template cart: `buildRenewalCartInput`
 * clones each line with its `unit_price` (a custom price Medusa does not
 * recalculate) and the subscription's quantity. So the amount is read through
 * that same function — never from the listing's current `price_cents`, which a
 * hosted checkout may have overridden (`amount_cents`) or which may have
 * changed since purchase. Any line without a usable unit price, no lines, or
 * no currency → null, and the page then offers no re-approval rather than
 * naming an amount it cannot vouch for. Line-item prices only: taxes the
 * renewal cart's region adds are not included, as on the storefront.
 */
export function renewalPrice(sub: {
  id: string
  quantity?: number | null
  cart?: RenewalCartData | null
}): string | null {
  const currency = sub.cart?.currency_code
  if (!sub.cart || !currency) return null
  const items = buildRenewalCartInput(sub).items
  if (!items.length) return null
  let total = 0
  for (const item of items) {
    const unit = Number(item.unit_price)
    if (item.unit_price === undefined || !Number.isFinite(unit) || unit < 0) return null
    total += unit * item.quantity
  }
  return total > 0 ? formatCheckoutPrice(total, currency) : null
}

export function manageRowView(sub: ManageRow, info: RowInfo, now: Date = new Date()): ManageRowView {
  const fmt = formatManageDate
  const running = sub.status === "active" || sub.status === "paused"
  const expiresAt = time(sub.expiration_date)
  const nextAt = time(sub.next_order_date)
  const renewingUntilCanceled = running && expiresAt === null
  const noun = isKnownInterval(String(sub.interval)) ? intervalNoun(sub.interval as SubscriptionInterval) : null

  const notes: string[] = []
  if (sub.status === "past_due" && sub.grace_ends_at) {
    notes.push(`Grace period until ${fmt(sub.grace_ends_at)}.`)
  }
  if (sub.status === "read_only") notes.push("Read-only: full access has ended.")

  let charge: string
  let autoRenew: string
  const reason = sub.metadata?.paused_reason
  if (sub.status === "past_due") {
    if (nextAt !== null) {
      charge = `Final payment attempt: ${fmt(sub.next_order_date)}. Cancel to stop it.`
      autoRenew = "Automatic renewal: on hold — payment overdue"
    } else {
      const ends = fmt(sub.grace_ends_at)
      charge = ends ? `No further charges. Full access ends ${ends}.` : "No further charges."
      autoRenew = "Automatic renewal: off"
    }
  } else if (
    sub.status === "paused" &&
    typeof reason === "string" &&
    reason.startsWith(DUNNING_PAUSE_PREFIX)
  ) {
    charge =
      "A renewal payment failed. One final attempt to charge your card may still be made; cancel to stop it."
    autoRenew = "Automatic renewal: on hold — payment failed"
  } else if (sub.status === "paused") {
    charge = "No charges while paused."
    autoRenew = renewingUntilCanceled
      ? "Automatic renewal: on"
      : neverRenews(sub)
        ? "Automatic renewal: off"
        : "No renewals while paused."
  } else if (renewingUntilCanceled) {
    const next = fmt(sub.next_order_date)
    charge = next ? `Next charge: ${next}` : "No charge is scheduled."
    autoRenew = "Automatic renewal: on"
  } else if (
    sub.status === "active" &&
    expiresAt !== null &&
    nextAt !== null &&
    nextAt <= expiresAt &&
    isLegacyFixedHorizon(sub)
  ) {
    // Legacy fixed horizon: still renewing, up to its expiration.
    charge = `Next charge: ${fmt(sub.next_order_date)}`
    autoRenew =
      `Renews every ${noun ?? "period"} until ${fmt(sub.expiration_date)}. ` +
      "Automatic renewal cannot be turned off for this subscription; cancelling stops all future charges."
  } else if (sub.status === "active" && expiresAt !== null && expiresAt > now.getTime()) {
    charge = `No further charges. This subscription ends ${fmt(sub.expiration_date)}.`
    autoRenew = "Automatic renewal: off"
  } else {
    charge = "No further charges."
    autoRenew = "Automatic renewal: off"
  }

  const paidThrough = fmt(sub.expiration_date)
  // Never for a legacy fixed-horizon row (cancel only), even in its final
  // period when nothing is scheduled.
  const mayApprove =
    sub.status === "active" &&
    !isLegacyFixedHorizon(sub) &&
    nextAt === null &&
    expiresAt !== null &&
    expiresAt > now.getTime() &&
    !!sub.payment_method_id &&
    !!info.price &&
    !!paidThrough &&
    isKnownInterval(String(sub.interval))

  return {
    id: sub.id,
    title: info.title,
    status: manageStatusLabel(sub.status),
    notes,
    charge,
    autoRenew,
    offerDisable: renewingUntilCanceled,
    approve: mayApprove
      ? {
          label: AUTO_RENEW_CHECKBOX_LABEL,
          disclosure: reapprovalDisclosure({
            price: info.price as string,
            interval: sub.interval as SubscriptionInterval,
            paidThrough: paidThrough as string,
          }),
        }
      : null,
    offerCancel: manageMayCancel(sub.status),
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** JSON safe to place inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    // U+2028/U+2029 end a line inside a <script>; built from char codes so
    // the source holds no raw separator characters.
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029")
}

export const MANAGE_EXPIRED_MESSAGE = "This link has expired. Open Subscriptions in Blackout again."
export const MANAGE_UNAVAILABLE_MESSAGE = "Managing subscriptions here is unavailable right now."

const PAGE_STYLE = `
    body { font-family: system-ui, sans-serif; padding: 16px; max-width: 560px; margin: 0 auto; color: #111; background: #fff; }
    ul { list-style: none; padding: 0; }
    li.sub { border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin-bottom: 16px; }
    .head { display: flex; justify-content: space-between; gap: 8px; }
    button { padding: 10px 16px; border-radius: 6px; border: 1px solid #111; cursor: pointer; font-size: 15px; margin-top: 8px; background: #fff; color: #111; }
    button:disabled { opacity: 0.5; cursor: default; }
    label.approve { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; }
    .error { color: #b00020; min-height: 1em; }
`

function shell(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
${body}${script}
</body>
</html>`
}

/** The 401 page for an invalid, expired, revoked or replaced link. */
export function renderManageExpired(): string {
  return shell("Link expired", `  <h1>Link expired</h1>\n  <p>${escapeHtml(MANAGE_EXPIRED_MESSAGE)}</p>`)
}

/** The page with either flag off. */
export function renderManageUnavailable(): string {
  return shell(
    "Unavailable",
    `  <h1>Unavailable</h1>\n  <p>${escapeHtml(MANAGE_UNAVAILABLE_MESSAGE)}</p>`
  )
}

function renderRow(row: ManageRowView): string {
  const notes = row.notes.map((n) => `\n    <p>${escapeHtml(n)}</p>`).join("")
  const disable = row.offerDisable
    ? `\n    <button type="button" data-action="disable_auto_renew" data-sub="${escapeHtml(row.id)}">Turn off automatic renewal</button>`
    : ""
  const approve = row.approve
    ? `
    <label class="approve">
      <input type="checkbox" data-approve-box="${escapeHtml(row.id)}">
      <span><strong>${escapeHtml(row.approve.label)}</strong><br><span data-reapprove-disclosure>${escapeHtml(row.approve.disclosure)}</span></span>
    </label>
    <button type="button" data-action="approve_auto_renew" data-sub="${escapeHtml(row.id)}" disabled>Turn on automatic renewal</button>`
    : ""
  const cancel = row.offerCancel
    ? `\n    <button type="button" data-action="cancel" data-sub="${escapeHtml(row.id)}">Cancel subscription</button>`
    : ""
  return `
  <li class="sub" data-subscription="${escapeHtml(row.id)}">
    <div class="head"><strong>${escapeHtml(row.title)}</strong><span data-status>${escapeHtml(row.status)}</span></div>${notes}
    <p data-charge>${escapeHtml(row.charge)}</p>
    <p data-auto-renew>${escapeHtml(row.autoRenew)}</p>${disable}${approve}${cancel}
  </li>`
}

/**
 * The manage page. Every action is a JSON POST to this same URL from the
 * script below (CSP `script-src 'nonce-…'`, `connect-src 'self'`); nothing
 * here changes state on a GET, and there is no form a cross-site page could
 * submit.
 */
export function renderManagePage(args: {
  rows: ManageRowView[]
  csrf: string
  scriptNonce: string
  returnUrl: string | null
}): string {
  const list = args.rows.length
    ? `  <ul>${args.rows.map(renderRow).join("")}\n  </ul>`
    : `  <h2>No subscriptions</h2>\n  <p>Subscriptions you start will appear here.</p>`
  const back = args.returnUrl
    ? `\n  <p><a href="${escapeHtml(args.returnUrl)}" rel="noopener noreferrer">Back to Blackout</a></p>`
    : ""
  const body = `  <h1>Your subscriptions</h1>
${list}
  <p class="error" id="manage-error" role="alert"></p>${back}`
  const data = scriptJson({
    csrf: args.csrf,
    reapprovalVersion: AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION,
    expired: MANAGE_EXPIRED_MESSAGE,
  })
  const script = `
<script nonce="${escapeHtml(args.scriptNonce)}">
  (function () {
    var data = ${data};
    var errorBox = document.getElementById("manage-error");
    var buttons = document.querySelectorAll("button[data-action]");
    function setBusy(busy) {
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        if (busy) { b.disabled = true; continue; }
        if (b.getAttribute("data-action") === "approve_auto_renew") {
          var box = document.querySelector('input[data-approve-box="' + b.getAttribute("data-sub") + '"]');
          b.disabled = !(box && box.checked);
        } else {
          b.disabled = false;
        }
      }
    }
    var boxes = document.querySelectorAll("input[data-approve-box]");
    for (var j = 0; j < boxes.length; j++) {
      boxes[j].addEventListener("change", function () { setBusy(false); });
    }
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", function (event) {
        var button = event.currentTarget;
        var action = button.getAttribute("data-action");
        var body = { action: action, subscription_id: button.getAttribute("data-sub"), csrf: data.csrf };
        if (action === "approve_auto_renew") {
          body.auto_renew_approved = true;
          body.auto_renew_disclosure_version = data.reapprovalVersion;
        }
        errorBox.textContent = "";
        setBusy(true);
        fetch(window.location.pathname, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }).then(function (res) {
          if (res.ok) { window.location.reload(); return; }
          return res.json().catch(function () { return {}; }).then(function (json) {
            errorBox.textContent = res.status === 401
              ? data.expired
              : (json && json.message) || "That change could not be made.";
            setBusy(false);
          });
        }).catch(function () {
          errorBox.textContent = "That change could not be made.";
          setBusy(false);
        });
      });
    }
  })();
</script>`
  return shell("Your subscriptions", body, script)
}
