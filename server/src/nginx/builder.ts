import { ConfigValidationError } from "./errors.js";

/*
 * Typed builder for Nginx configuration files.
 *
 * Templates never concatenate strings into config text: they build a tree of
 * nodes and every argument goes through one of three token kinds:
 *
 *  - plain string: emitted as-is; must be a single bare word without
 *    whitespace, quotes, ";", "{", "}" or "#". Used for keywords, numbers,
 *    sanitized domains/IPs and Nginx variables written by the compiler.
 *  - quoted(value): user text, emitted in double quotes; refuses quotes,
 *    backslashes, "$" and control characters, so it can never interpolate a
 *    variable or terminate the directive.
 *  - trusted(value): text assembled by the compiler that needs "$" (variables,
 *    regex anchors, capture references); emitted in double quotes and only
 *    refuses quotes and control characters.
 *  - constant(value): a literal written in the compiler source (e.g. a
 *    single-quoted Alt-Svc value); emitted verbatim. Never pass user input.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const BARE_WORD = /^[^\s;{}"'`\\#]+$/;
const INDENT = "    ";

class QuotedToken {
  constructor(readonly value: string) {}
}

class TrustedToken {
  constructor(readonly value: string) {}
}

class ConstantToken {
  constructor(readonly value: string) {}
}

export type Token = string | number | QuotedToken | TrustedToken | ConstantToken;

export const quoted = (value: string): QuotedToken => new QuotedToken(value);
export const trusted = (value: string): TrustedToken => new TrustedToken(value);
export const constant = (value: string): ConstantToken => new ConstantToken(value);

export type ConfigNode =
  | { kind: "directive"; name: string; args: Token[] }
  | { kind: "block"; name: string; args: Token[]; children: ConfigNode[] }
  | { kind: "comment"; text: string }
  | { kind: "blank" }
  | { kind: "verbatim"; text: string };

export const directive = (name: string, ...args: Token[]): ConfigNode => ({ kind: "directive", name, args });

export const block = (name: string, args: Token[], children: ConfigNode[]): ConfigNode => ({
  kind: "block",
  name,
  args,
  children,
});

export const comment = (text: string): ConfigNode => ({ kind: "comment", text });
export const blank = (): ConfigNode => ({ kind: "blank" });

/** Admin custom directives, already checked by sanitizeCustomDirectives. */
export const verbatim = (text: string): ConfigNode => ({ kind: "verbatim", text });

function renderToken(token: Token): string {
  if (typeof token === "number") {
    if (!Number.isFinite(token)) {
      throw new ConfigValidationError(`Valor numérico inválido na configuração: ${token}`);
    }
    return String(token);
  }
  if (typeof token === "string") {
    if (!BARE_WORD.test(token) || CONTROL_CHARS.test(token)) {
      throw new ConfigValidationError(`Token inseguro na configuração: ${JSON.stringify(token)}`);
    }
    return token;
  }
  if (token instanceof QuotedToken) {
    if (CONTROL_CHARS.test(token.value) || /["\\$]/.test(token.value)) {
      throw new ConfigValidationError(`Texto inseguro na configuração: ${JSON.stringify(token.value)}`);
    }
    return `"${token.value}"`;
  }
  if (token instanceof ConstantToken) {
    if (CONTROL_CHARS.test(token.value)) {
      throw new ConfigValidationError(`Constante inválida na configuração: ${JSON.stringify(token.value)}`);
    }
    return token.value;
  }
  if (CONTROL_CHARS.test(token.value) || token.value.includes('"')) {
    throw new ConfigValidationError(`Expressão insegura na configuração: ${JSON.stringify(token.value)}`);
  }
  return `"${token.value}"`;
}

function renderName(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new ConfigValidationError(`Diretiva inválida: ${JSON.stringify(name)}`);
  }
  return name;
}

function renderNodes(nodes: ConfigNode[], depth: number, lines: string[]): void {
  const pad = INDENT.repeat(depth);
  for (const node of nodes) {
    switch (node.kind) {
      case "blank":
        lines.push("");
        break;
      case "comment":
        for (const line of node.text.split(/\r?\n/)) {
          lines.push(`${pad}# ${line.replace(CONTROL_CHARS, " ")}`.trimEnd());
        }
        break;
      case "directive": {
        const args = node.args.map(renderToken);
        lines.push(`${pad}${[renderName(node.name), ...args].join(" ")};`);
        break;
      }
      case "block": {
        const args = node.args.map(renderToken);
        lines.push(`${pad}${[renderName(node.name), ...args].join(" ")} {`);
        renderNodes(node.children, depth + 1, lines);
        lines.push(`${pad}}`);
        break;
      }
      case "verbatim":
        for (const line of node.text.split(/\r?\n/)) {
          lines.push(line.trim().length > 0 ? `${pad}${line.trim()}` : "");
        }
        break;
    }
  }
}

/** Renders nodes to text: 4-space indentation, trailing newline, no double blanks. */
export function render(nodes: ConfigNode[]): string {
  const lines: string[] = [];
  renderNodes(nodes, 0, lines);
  const compacted = lines.filter((line, index) => !(line === "" && (index === 0 || lines[index - 1] === "")));
  while (compacted.length > 0 && compacted[compacted.length - 1] === "") {
    compacted.pop();
  }
  return `${compacted.join("\n")}\n`;
}
