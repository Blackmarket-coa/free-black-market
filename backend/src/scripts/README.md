# Custom CLI Script

A custom CLI script is a function to execute through Medusa's CLI tool. This is useful when creating custom Medusa tooling to run as a CLI tool.

> Learn more about custom CLI scripts in [this documentation](https://docs.medusajs.com/learn/fundamentals/custom-cli-scripts).

## How to Create a Custom CLI Script?

To create a custom CLI script, create a TypeScript or JavaScript file under the `src/scripts` directory. The file must default export a function.

For example, create the file `src/scripts/my-script.ts` with the following content:

```ts title="src/scripts/my-script.ts"
import { 
  ExecArgs,
} from "@medusajs/framework/types"

export default async function myScript ({
  container
}: ExecArgs) {
  const productModuleService = container.resolve("product")

  const [, count] = await productModuleService.listAndCountProducts()

  console.log(`You have ${count} product(s)`)
}
```

The function receives as a parameter an object having a `container` property, which is an instance of the Medusa Container. Use it to resolve resources in your Medusa application.

---

## How to Run Custom CLI Script?

To run the custom CLI script, run the `exec` command:

```bash
npx medusa exec ./src/scripts/my-script.ts
```

---

## Custom CLI Script Arguments

Your script can accept arguments from the command line. Arguments are passed to the function's object parameter in the `args` property.

For example:

```ts
import { ExecArgs } from "@medusajs/framework/types"

export default async function myScript ({
  args
}: ExecArgs) {
  console.log(`The arguments you passed: ${args}`)
}
```

Then, pass the arguments in the `exec` command after the file path:

```bash
npx medusa exec ./src/scripts/my-script.ts arg1 arg2
```

### Only bare words reach the script

Checked against `@medusajs/cli` 2.14.2, which parses with yargs in strict mode:

| You type | `args` the script receives |
|---|---|
| `exec ./x.ts apply default-plan=free` | `["apply", "default-plan=free"]` |
| `exec ./x.ts 123` | `[123]`: a number, not a string |
| `exec ./x.ts --apply` | nothing: the CLI exits 1 with `Unknown argument: apply` before the script loads |
| `exec ./x.ts -- --apply apply` | `[]`: everything after `--` is dropped, and the script runs as if nothing had been typed |

`pnpm medusa exec` behaves the same: pnpm passes `--` through to the CLI, so the
words after it are dropped there too.

So take bare words (`apply`, `dry-run`, `name=value`), never `--flags`, and read
them with `parseScriptArgs` from `src/shared/exec-args.ts`. It refuses an unknown
word (a misspelt `dryrun` must not become a live run), a `--flag`, and a `--`
separator (whose words are still visible in `process.argv`, which is how it
tells), so a dropped or mistyped argument stops the script instead of changing
what it does.

A script that rewrites data, or whose writes change what a seller or buyer is
owed or limited to, should also be a dry run unless it is given `apply`: spread
`APPLY_OR_DRY_RUN` into its spec, which takes `apply` or `dry-run` and refuses
both together. Then even a word lost some other way leaves it previewing.

| Script | Writes only with | Arguments |
|---|---|---|
| `reencrypt-channel-credentials.ts` | `apply` | `apply` or `dry-run` |
| `backfill-vendor-plan-assignments.ts` | `apply` | `default-plan=<code>` (required), `apply` or `dry-run`; `PLAN_BACKFILL_DRY_RUN=1` forces a dry run |
| `fix-order-dispute-minor-units.ts` | `apply` | `before=<ISO time with a zone>` (required), `apply` or `dry-run` |
| `fix-creator-commission-minor-units.ts` | `apply` | `apply` or `dry-run` (SD-95; commission already credited is listed, never changed). Correcting a held row raises what approve-held will debit from the vendor's current earnings to the full commission once crediting works, so orders whose vendor is not the order's seller, whose proceeds are not in the vendor's earnings in the ledger, which were refunded (a refund does not reverse a held attribution; only a cancellation does), whose vendor was paid out after the order, whose proceeds Mercur paid out, or which were placed or settled in the last 2 days are listed, not corrected. With `FF_CARD_ORDER_LEDGER_V1` off (the default) no order settles to the ledger, so no held or pending row that names a vendor is corrected: every one is listed, and the log says so once. **Run it with `apply` immediately before the repair that makes commission crediting work deploys, not earlier and not after:** those checks are made once, when it runs, and nothing repeats them when approve-held later debits the vendor, so a vendor paid out in between, or whose order is refunded in between, is still debited the full commission |
| `backfill-promoted-listings.ts` | no word: writes unless `dry-run` | `dry-run`. Its grants are additive and idempotent (an open-ended entitlement for a seller already featured), and the `expire-promoted-listings` job tells operators to run it bare |
| `ingest-irs-exempt-orgs.ts` | no word (behind `FF_NONPROFIT_PARITY_V1`) | source names: `pub78`, `revocation`, `eo_bmf`; none means all three |