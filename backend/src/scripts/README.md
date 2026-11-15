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

So take bare words (`apply`, `dry-run`, `name=value`), never `--flags`, and read
them with `parseScriptArgs` from `src/shared/exec-args.ts`. It refuses an unknown
word (a misspelt `dryrun` must not become a live run), a `--flag`, and a `--`
separator (whose words are still visible in `process.argv`, which is how it
tells), so a dropped or mistyped argument stops the script instead of changing
what it does. A script that rewrites or deletes data should still be a dry run
unless it is given a word that says otherwise, as `reencrypt-channel-credentials.ts`
is (`apply`).