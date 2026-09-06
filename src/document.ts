import { parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import type * as vscode from "vscode";

export type FlowDocument = Record<string, unknown> | unknown[];

export type ParsedDocument =
  | { json: FlowDocument; error: null }
  | { json: null; error: string };

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Parses JSON/JSONC text into a Squeed document, or returns a human-readable error. */
export function parseDocument(document: vscode.TextDocument): ParsedDocument {
  const text = document.getText();
  if (!text.trim()) return { json: null, error: "Document is empty." };

  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const [first] = errors;
    const position = document.positionAt(first.offset);
    return {
      json: null,
      error: `${printParseErrorCode(first.error)} at line ${position.line + 1}, column ${position.character + 1}.`,
    };
  }
  if (!tree || (tree.type !== "object" && tree.type !== "array"))
    return { json: null, error: "Expected a JSON object or array at the document root." };
  try {
    return { json: toValue(tree, "root") as FlowDocument, error: null };
  } catch (error) {
    return { json: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// jsonc-parser's own value builders assign `obj[key] = value`, so a "__proto__"
// key would silently replace the prototype; build plain values explicitly instead.
function toValue(node: Node, address: string): unknown {
  switch (node.type) {
    case "array":
      return (node.children ?? []).map((child, index) => toValue(child, `${address}.${index}`));
    case "object": {
      const value: Record<string, unknown> = {};
      for (const property of node.children ?? []) {
        const [keyNode, valueNode] = property.children ?? [];
        if (!keyNode || !valueNode) continue;
        const key = String(keyNode.value);
        if (UNSAFE_KEYS.has(key)) throw new Error(`Unsafe key "${key}" at ${address}.`);
        Object.defineProperty(value, key, {
          value: toValue(valueNode, `${address}.${key}`),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return value;
    }
    case "number":
      if (typeof node.value !== "number" || !Number.isFinite(node.value))
        throw new Error(`Non-finite number at ${address}.`);
      return node.value;
    default:
      return node.value ?? null;
  }
}
