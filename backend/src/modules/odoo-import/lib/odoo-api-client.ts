import { JSONRPCClient } from "json-rpc-2.0"
import type { OdooCredentials, OdooProduct } from "../types"

const PAGE_SIZE = 100
const MAX_PAGES = 500

/**
 * Per-connection Odoo JSON-RPC client. Unlike the module-config `OdooModuleService`
 * (a single statically-configured instance), this is constructed from a specific
 * vendor's credentials so imports are multi-tenant.
 */
export class OdooApiClient {
  private client: JSONRPCClient
  private uid?: number
  private creds: OdooCredentials

  constructor(creds: OdooCredentials) {
    this.creds = { ...creds, url: creds.url.replace(/\/+$/, "") }
    this.client = new JSONRPCClient((jsonRPCRequest) =>
      fetch(`${this.creds.url}/jsonrpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(jsonRPCRequest),
        signal: AbortSignal.timeout(20_000),
      }).then((response) => {
        if (response.status === 200) {
          return response
            .json()
            .then((jsonRPCResponse) => this.client.receive(jsonRPCResponse))
        } else if (jsonRPCRequest.id !== undefined) {
          return Promise.reject(new Error(response.statusText))
        }
      })
    )
  }

  /** Authenticate and cache the uid. Throws a friendly error on bad creds. */
  async login(): Promise<number> {
    const uid = (await this.client.request("call", {
      service: "common",
      method: "authenticate",
      args: [this.creds.db_name, this.creds.username, this.creds.api_key, {}],
    })) as number | false

    if (!uid) {
      throw new Error(
        "Invalid Odoo credentials. Check the database name, username, and API key."
      )
    }
    this.uid = uid
    return uid
  }

  private async ensureLogin(): Promise<void> {
    if (!this.uid) await this.login()
  }

  /** Validate the connection and return basic store info. */
  async validateConnection(): Promise<{ store_name: string; currency: string }> {
    await this.login()
    // Best-effort company/currency lookup; never fail validation on it.
    let store_name = this.creds.db_name
    let currency = "USD"
    try {
      const companies = (await this.execute(
        "res.company",
        "search_read",
        [[]],
        { fields: ["name", "currency_id"], limit: 1 }
      )) as Array<{ name?: string; currency_id?: [number, string] }>
      if (companies?.[0]?.name) store_name = companies[0].name
      if (companies?.[0]?.currency_id?.[1]) currency = companies[0].currency_id[1]
    } catch {
      // ignore — validation already succeeded via login()
    }
    return { store_name, currency }
  }

  private async execute(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {}
  ): Promise<unknown> {
    await this.ensureLogin()
    return this.client.request("call", {
      service: "object",
      method: "execute_kw",
      args: [this.creds.db_name, this.uid, this.creds.api_key, model, method, args, kwargs],
    })
  }

  /** Count published product templates (for the import preview). */
  async countProducts(): Promise<number> {
    const count = (await this.execute(
      "product.template",
      "search_count",
      [[["is_product_variant", "=", false]]]
    )) as number
    return typeof count === "number" ? count : 0
  }

  /** Fetch all product templates with their variants, paginated. */
  async fetchAllProducts(): Promise<OdooProduct[]> {
    const all: OdooProduct[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = (await this.execute(
        "product.template",
        "search_read",
        [[["is_product_variant", "=", false]]],
        {
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          fields: [
            "id",
            "name",
            "display_name",
            "list_price",
            "description_sale",
            "description",
            "default_code",
            "barcode",
            "qty_available",
            "currency_id",
            "image_1920",
            "is_published",
          ],
        }
      )) as OdooProduct[]

      if (!rows || rows.length === 0) break
      all.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return all
  }
}
