import ts from "typescript"
import { HTTP_METHODS } from "@medusajs/framework/http"
import type { RouteVerb } from "@medusajs/framework/http"

/**
 * The HTTP verbs a route file registers, read from its syntax tree, for the
 * specs that walk `src/api` and compare what they find with a reviewed list
 * (bare-prefix-route-guards, food-network-owner-read-auth,
 * nested-middleware-auth); nested-middlewares reads nested middleware files
 * with it, for a default export in any spelling. Its self-tests, and a check
 * of every form against Medusa's own RoutesLoader, are in
 * bare-prefix-route-guards.unit.spec.ts.
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
 *   export const { POST } = handlers         every name a pattern binds (with
 *                                            no handler text of its own)
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
 *   exports.X, module.exports        CommonJS's own `exports` or `module`
 *   (exports as any).X, f(module)    used as a value at all: written to,
 *   const e = exports                cast, aliased or passed on, any of them
 *   top-level this                   can add keys; and `this` outside every
 *                                    function and class member, which is
 *                                    module.exports in CommonJS
 *
 * A local named `module` or `exports` (a parameter, a destructured name) is
 * not CommonJS's, and neither is `this` inside a function or a class member;
 * neither is reported. A local's scope is never taken wider than the
 * language makes it, so a wrong guess reports a use rather than hiding one.
 *
 * What it cannot tell is whether a verb-named export's value is a function
 * (the loader skips one that is not). Such an export is listed anyway: a
 * route someone has to review, which fails safe. Type-only and `declare`
 * exports compile to nothing and are not listed. Code it cannot see at all
 * (`eval`, a module that rewrites another's exports) is out of its reach.
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

/** CommonJS's own bindings in the compiled file: through either, code can add keys to module.exports. */
const COMMONJS_BINDINGS = new Set(["module", "exports"])

/**
 * What an identifier named `module` or `exports` does where it stands: binds
 * a local of that name, reads a binding (a local, or CommonJS's own), or
 * neither (a property name, a label, a name in an import or export clause).
 */
function roleOf(id: ts.Identifier): "binds" | "reads" | undefined {
  const parent = id.parent
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isImportEqualsDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      (ts.isImportSpecifier(parent) && !parent.isTypeOnly)) &&
    parent.name === id
  ) {
    return "binds"
  }
  if (
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isImportSpecifier(parent)) &&
      parent.name === id) ||
    ((ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) && parent.propertyName === id) ||
    (ts.isQualifiedName(parent) && parent.right === id) ||
    ts.isExportSpecifier(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent)
  ) {
    return undefined
  }
  return "reads"
}

/** The block, or the file, a declaration statement is scoped to. */
function blockOf(node: ts.Node): ts.Node {
  let at = node.parent
  while (!ts.isBlock(at) && !ts.isModuleBlock(at) && !ts.isCaseBlock(at) && !ts.isSourceFile(at)) at = at.parent
  return at
}

/**
 * Where a local named `module` or `exports` is in scope. Never wider than the
 * language makes it (a `var` is taken to end at its block, not its function),
 * so a wrong guess counts a use as CommonJS's: reported, never hidden.
 */
function scopeOf(name: ts.Identifier): ts.Node {
  let declaration: ts.Node = name.parent
  while (ts.isBindingElement(declaration) || ts.isObjectBindingPattern(declaration) || ts.isArrayBindingPattern(declaration)) {
    declaration = declaration.parent
  }
  if (ts.isParameter(declaration)) return declaration.parent
  if (ts.isFunctionExpression(declaration) || ts.isClassExpression(declaration)) return declaration
  if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportSpecifier(declaration)) return name.getSourceFile()
  if (ts.isVariableDeclaration(declaration)) {
    const holder = declaration.parent
    if (ts.isCatchClause(holder)) return holder
    const statement = holder.parent
    if (ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement)) return statement
  }
  return blockOf(declaration)
}

/**
 * `this` outside every function body and class member, which CommonJS makes
 * module.exports. Every function but an arrow binds its own in its body and
 * parameters, and so does a member's initializer or a static block; a
 * computed member name or a decorator runs outside them.
 */
function isTopLevelThis(node: ts.Node): boolean {
  let child: ts.Node = node
  for (let at = node.parent; !ts.isSourceFile(at); child = at, at = at.parent) {
    if (
      (ts.isFunctionDeclaration(at) ||
        ts.isFunctionExpression(at) ||
        ts.isMethodDeclaration(at) ||
        ts.isConstructorDeclaration(at) ||
        ts.isGetAccessorDeclaration(at) ||
        ts.isSetAccessorDeclaration(at)) &&
      (child === at.body || ts.isParameter(child))
    ) {
      return false
    }
    if ((ts.isPropertyDeclaration(at) && child === at.initializer) || ts.isClassStaticBlockDeclaration(at)) return false
  }
  return true
}

/** How a CommonJS binding is used, for the report: `exports.POST`, `(exports as any).POST`, `module passed to mutate`. */
function useOf(node: ts.Node, source: ts.SourceFile): string {
  let use = node
  while (
    (ts.isParenthesizedExpression(use.parent) ||
      ts.isAsExpression(use.parent) ||
      ts.isNonNullExpression(use.parent) ||
      ts.isSatisfiesExpression(use.parent) ||
      ts.isTypeAssertionExpression(use.parent)) &&
    use.parent.expression === use
  ) {
    use = use.parent
  }
  const parent = use.parent
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === use) {
    return parent.getText(source)
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== use) {
    return `${use.getText(source)} passed to ${parent.expression.getText(source)}`
  }
  return `${use.getText(source)} used as a value`
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

  // CommonJS's own `module` and `exports`, used as a value at all (written
  // to, cast, aliased, passed on), and `this` at the top level, which is
  // module.exports there, can put keys on the module that no export
  // statement names. A local of the same name, and `this` in a function or a
  // class member, are not CommonJS's.
  const scopes = new Map<string, ts.Node[]>()
  /** Identifiers that read `module` or `exports`, and top-level `this`, in document order. */
  const uses: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    // Types, type-only declarations and `declare` compile to nothing. A class's
    // `extends` clause is a value, though tsc calls it a type node.
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return
    if (ts.isTypeNode(node) && !(ts.isExpressionWithTypeArguments(node) && !ts.isPartOfTypeNode(node))) return
    if ((ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) || (ts.isImportEqualsDeclaration(node) && node.isTypeOnly)) return
    if (ts.isIdentifier(node) && COMMONJS_BINDINGS.has(node.text)) {
      const role = roleOf(node)
      if (role === "binds") scopes.set(node.text, [...(scopes.get(node.text) ?? []), scopeOf(node)])
      else if (role === "reads") uses.push(node)
    } else if (node.kind === ts.SyntaxKind.ThisKeyword && isTopLevelThis(node)) {
      uses.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const within = (node: ts.Node, scope: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) if (n === scope) return true
    return false
  }
  for (const use of uses) {
    if (!ts.isIdentifier(use)) unreadable.push(`top-level ${useOf(use, source)} (${at(use)})`)
    else if (!(scopes.get(use.text) ?? []).some((scope) => within(use, scope))) unreadable.push(`${useOf(use, source)} (${at(use)})`)
  }

  return {
    verbs: HTTP_METHODS.filter((verb) => exported.has(verb)),
    unreadable,
    handlerSource(verb: string): string {
      const local = exported.get(verb)
      return (local ? locals.get(local)?.getText(source) : undefined) ?? ""
    },
  }
}
