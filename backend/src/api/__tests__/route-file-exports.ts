import ts from "typescript"
import { HTTP_METHODS } from "@medusajs/framework/http"
import type { RouteVerb } from "@medusajs/framework/http"

/**
 * The HTTP verbs a route file registers, read from its syntax tree, for the
 * specs that walk `src/api` and compare what they find with a reviewed list
 * (bare-prefix-route-guards, food-network-owner-read-auth,
 * nested-middleware-auth). Its self-tests, and a check of every form against
 * Medusa's own RoutesLoader, are in bare-prefix-route-guards.unit.spec.ts.
 *
 * How Medusa 2.14.2 decides. `@medusajs/framework/dist/http/routes-loader.js`
 * lines 179-230 require the compiled route file and register every key of
 * `Object.keys(module)` that is in HTTP_METHODS (`dist/http/types.js` lines
 * 7-15: GET POST PUT PATCH DELETE OPTIONS HEAD, upper case, exactly) and whose
 * value is a function. `medusa build` compiles with tsc and the project's
 * tsconfig (`dist/build-tools/compiler.js` lines 407-414; `module: Node16`,
 * no `"type": "module"`, so CommonJS), and there every value a file exports
 * is a key of `module.exports`, however the export is spelled:
 *
 *   export async function GET() {}          a declaration (a class too)
 *   export const HEAD = GET, DELETE = ...    every declarator, not the first
 *   export const { POST } = handlers         every name a pattern binds
 *   export { create as POST }                a local binding, renamed
 *   export { POST } from "./handlers"        a re-export (a getter)
 *
 * The regexes this replaced (one per walk) read a function declaration and
 * the first declarator of a statement, and no other form; food-network's
 * missed even a plain `export function GET`.
 *
 * Some forms decide keys the file does not show. They are reported in
 * `unreadable`, and a walk fails on them rather than guess:
 *
 *   export * from "./handlers"       the names are the other file's
 *   export default ...               `resolveExports` (`@medusajs/utils`
 *   (and `export { x as default }`)  `dist/common/resolve-exports.js` lines
 *                                    4-11, from `dynamic-import.js` line 19)
 *                                    reads a default export's keys IN PLACE
 *                                    of the file's when it has a `default`
 *                                    key itself: it can add verbs and hide
 *                                    the declared ones
 *   export = ...                     the value's keys are the file's
 *   exports.X, module.exports        keys no export statement names
 *
 * What it cannot tell is whether a verb-named export's value is a function
 * (the loader skips one that is not). Such an export is listed anyway: a
 * route someone has to review, which fails safe. Type-only and `declare`
 * exports compile to nothing and are not listed.
 */
export type RouteFileExports = {
  /** The verbs the loader registers for the file, in HTTP_METHODS order. */
  verbs: RouteVerb[]
  /** Each form whose keys the file alone does not settle, with its line; empty when there is none. */
  unreadable: string[]
  /**
   * The declaration that binds a verb's handler: the function, the one
   * declarator (`DELETE = async (req, res) => ...`), or for
   * `export { create as POST }` the declaration of `create`. Empty for a verb
   * the file does not export, for one whose handler is in another file (a
   * re-export, an imported binding), and for one a destructuring pattern
   * binds (`export const { GET, POST } = handlers`): the pattern's text holds
   * every name's handler, so a guard in it is no one verb's.
   */
  handlerSource(verb: string): string
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)

/** Every name a declarator binds: `a`, and each name in `{ a, b: c, ...d }` or `[e, , f]`, nested. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)))
}

export function readRouteFileExports(fileName: string, text: string): RouteFileExports {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  )
  const at = (node: ts.Node) => `line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`

  /** Top-level name -> the declaration that binds it; undefined for an import and for a name a pattern binds. */
  const locals = new Map<string, ts.Node | undefined>()
  /** Exported name -> the local name it exports; null when the value is another file's. */
  const exported = new Map<string, string | null>()
  const unreadable: string[] = []

  const bind = (name: string, node: ts.Node | undefined, isExported: boolean) => {
    // An overloaded function is several declarations; the one with a body is the handler.
    const previous = locals.get(name)
    if (!(previous && ts.isFunctionDeclaration(previous) && previous.body)) locals.set(name, node)
    if (isExported) exported.set(name, name)
  }
  const exportAs = (name: string, local: string | null, node: ts.Node) => {
    if (name === "default") unreadable.push(`export { ... as default } (${at(node)})`)
    else exported.set(name, local)
  }

  for (const statement of source.statements) {
    // `declare` compiles to nothing, so it exports no key.
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue
    const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)

    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      if (clause.name) bind(clause.name.text, undefined, false)
      const named = clause.namedBindings
      if (named && ts.isNamespaceImport(named)) bind(named.name.text, undefined, false)
      if (named && ts.isNamedImports(named)) for (const element of named.elements) bind(element.name.text, undefined, false)
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (isExported && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) unreadable.push(`export default (${at(statement)})`)
      else if (statement.name) bind(statement.name.text, statement, isExported)
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        // A pattern's one declaration holds every name's handler
        // (`{ GET, POST } = { GET: guarded, POST: open }`), so it is no one
        // verb's: a name a pattern binds gets no handler.
        const own = ts.isIdentifier(declaration.name) ? declaration : undefined
        for (const name of boundNames(declaration.name)) bind(name, own, isExported)
      }
    } else if (ts.isEnumDeclaration(statement) || (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name))) {
      bind(statement.name.text, statement, isExported)
    } else if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly) bind(statement.name.text, statement, isExported)
    } else if (ts.isExportAssignment(statement)) {
      unreadable.push(`${statement.isExportEquals ? "export =" : "export default"} (${at(statement)})`)
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause
      const from = statement.moduleSpecifier
      if (!clause) {
        unreadable.push(`export * from ${from ? from.getText(source) : "?"} (${at(statement)})`)
      } else if (ts.isNamespaceExport(clause)) {
        exportAs(clause.name.text, null, statement)
      } else {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue
          exportAs(element.name.text, from ? null : (element.propertyName ?? element.name).text, statement)
        }
      }
    }
  }

  // CommonJS writes put keys on `module.exports` that no export statement names.
  const visit = (node: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression)) {
      const member = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined
      if (node.expression.text === "exports" || (node.expression.text === "module" && member === "exports")) {
        unreadable.push(`${node.getText(source)} (${at(node)})`)
      }
    } else if (ts.isCallExpression(node) && node.arguments.some((arg) => ts.isIdentifier(arg) && arg.text === "exports")) {
      unreadable.push(`exports passed to ${node.expression.getText(source)} (${at(node)})`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return {
    verbs: HTTP_METHODS.filter((verb) => exported.has(verb)),
    unreadable,
    handlerSource(verb: string): string {
      const local = exported.get(verb)
      return (local ? locals.get(local)?.getText(source) : undefined) ?? ""
    },
  }
}
