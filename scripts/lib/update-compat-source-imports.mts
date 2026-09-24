import type ts from "typescript";
import { getTypeScript } from "./ts-guard-utils.mts";

/**
 * Shipped source-only contracts that update completion loads from the installed
 * package root, keyed by the importing owner and its package-root binding. They
 * have no hashed compatibility output, so the inventory does not record them.
 */
const SOURCE_SCRIPT_CONTRACTS: Record<string, { root: string; scripts: string[] }> = {
  // Source-update completion loads the installed checkout's scripts, not retained dist chunks.
  "src/cli/update-cli/update-command-runtime.ts": {
    root: "root",
    scripts: [
      "scripts/stage-bundled-plugin-runtime.mts",
      "scripts/lib/dist-artifact-ownership.mts",
    ],
  },
  // Node runtime recovery stays a package-root module so its installer assets resolve outside dist.
  "src/cli/update-cli/update-command-node-runtime-resolution.ts": {
    root: "driverRoot",
    scripts: ["node-runtime-recovery.mjs"],
  },
};

export function isUpdateSourceScriptImport(owner: string, node: ts.CallExpression): boolean {
  const contract = SOURCE_SCRIPT_CONTRACTS[owner];
  if (!contract) {
    return false;
  }
  const ts = getTypeScript();
  const specifier = node.arguments[0];
  if (!specifier || !ts.isPropertyAccessExpression(specifier) || specifier.name.text !== "href") {
    return false;
  }
  const url = specifier.expression;
  if (
    !ts.isCallExpression(url) ||
    url.expression.getText() !== "pathToFileURL" ||
    url.arguments.length !== 1
  ) {
    return false;
  }
  let target = url.arguments[0];
  if (target && ts.isIdentifier(target)) {
    const name = target.text;
    let statement: ts.Node = node;
    while (statement.parent && !ts.isBlock(statement.parent)) {
      statement = statement.parent;
    }
    if (!statement.parent || !ts.isBlock(statement.parent)) {
      return false;
    }
    target = undefined;
    for (const preceding of statement.parent.statements) {
      if (preceding === statement) {
        break;
      }
      if (
        !ts.isVariableStatement(preceding) ||
        !(preceding.declarationList.flags & ts.NodeFlags.Const)
      ) {
        continue;
      }
      for (const declaration of preceding.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
          target = declaration.initializer;
        }
      }
    }
  }
  if (!target || !ts.isCallExpression(target) || target.expression.getText() !== "path.join") {
    return false;
  }
  const [root, ...segments] = target.arguments;
  if (
    !root ||
    !ts.isIdentifier(root) ||
    root.text !== contract.root ||
    !segments.every(ts.isStringLiteral)
  ) {
    return false;
  }
  // Keep every other nonliteral import fail-closed, including paths under dist.
  return contract.scripts.includes(segments.map((segment) => segment.text).join("/"));
}
