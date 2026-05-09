// lib/style.js
// Tiny ANSI helpers for CLI output. Honors NO_COLOR and non-TTY stdout
// (https://no-color.org). Zero deps — wrapping the codes ourselves keeps
// the package lean.

const enabled =
  process.stdout.isTTY &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const wrap = (open, close) => (s) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);

export const check = () => green("✓");
export const cross = () => red("✗");
export const info = () => cyan("→");

const RULE_WIDTH = 56;
export const rule = () => dim("─".repeat(RULE_WIDTH));

export function section(title) {
  const line = dim("─".repeat(RULE_WIDTH));
  return `\n${line}\n  ${bold(title)}\n${line}\n`;
}

export function box(content) {
  const lines = String(content).split("\n");
  const inner = lines.map((l) => `  ${dim("│")} ${l}`).join("\n");
  const top = `  ${dim("┌" + "─".repeat(RULE_WIDTH - 2))}`;
  const bottom = `  ${dim("└" + "─".repeat(RULE_WIDTH - 2))}`;
  return `${top}\n${inner}\n${bottom}`;
}
