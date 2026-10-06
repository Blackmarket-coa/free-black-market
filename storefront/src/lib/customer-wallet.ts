import { phase1ModuleFlags } from "@/lib/feature-flags"

/**
 * The customer wallet surfaces behind NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 (the
 * twin of the API's FF_CUSTOMER_WALLET_V1): the five /store/hawala prefixes the
 * API gates — wallet, deposit, withdraw, transactions and bank-accounts (with
 * bank-accounts/link beneath it). Prefix-matched like the API's method-less
 * entries, so anything beneath one of them is gated too. Case-insensitive,
 * because the action's allowlist admits upper case and Express matches routes
 * case-insensitively: /store/hawala/WALLET reaches the same handler.
 *
 * NOT here, deliberately: /store/hawala/pools (listing and carried-pool
 * contributions) and /store/hawala/investments. They carry their own flags
 * (investmentPools / nonprofitParity) and are not the customer's wallet.
 *
 * Lives outside `lib/data/hawala.ts` because a "use server" module may export
 * only async functions.
 */
const CUSTOMER_WALLET_PATH = /^\/store\/hawala\/(?:wallet|deposit|withdraw|transactions|bank-accounts)(?:[/?#]|$)/i

export const isCustomerWalletPath = (path: string): boolean => CUSTOMER_WALLET_PATH.test(path)

/** Read at call time, so a test can flip it; Next inlines the env at build. */
export const customerWalletEnabled = (): boolean => phase1ModuleFlags.customerWallet === true
