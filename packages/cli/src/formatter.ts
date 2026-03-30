/**
 * @module formatter
 *
 * Pretty-print helpers for terminal output.
 * Provides ANSI color support, table formatting, and JSON highlighting.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// ANSI Color Codes
// ---------------------------------------------------------------------------

const supportsColor =
  typeof process !== "undefined" &&
  process.stdout?.isTTY === true &&
  process.env.NO_COLOR === undefined;

function ansi(code: string): string {
  return supportsColor ? `\x1b[${code}m` : "";
}

/** Reset all styling. */
export const reset = ansi("0");

/** Bold text. */
export const bold = ansi("1");

/** Dim (faint) text. */
export const dim = ansi("2");

/** Red foreground. */
export const red = ansi("31");

/** Green foreground. */
export const green = ansi("32");

/** Yellow foreground. */
export const yellow = ansi("33");

/** Blue foreground. */
export const blue = ansi("34");

/** Magenta foreground. */
export const magenta = ansi("35");

/** Cyan foreground. */
export const cyan = ansi("36");

/** White foreground. */
export const white = ansi("37");

/** Gray foreground. */
export const gray = ansi("90");

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Apply bold styling to a string. */
export function b(text: string): string {
  return `${bold}${text}${reset}`;
}

/** Apply color styling to a string. */
export function color(text: string, c: string): string {
  return `${c}${text}${reset}`;
}

/** Display a label-value pair with consistent formatting. */
export function field(label: string, value: string | number | undefined | null): string {
  const displayValue = value === undefined || value === null ? color("(none)", gray) : String(value);
  return `  ${color(label + ":", cyan)} ${displayValue}`;
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

/** Print a section header with a horizontal rule. */
export function section(title: string): string {
  const line = "─".repeat(Math.max(0, 50 - title.length));
  return `\n${bold}${yellow}${title}${reset} ${dim}${line}${reset}`;
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

/**
 * Format rows as a simple aligned table.
 *
 * @param rows - Array of [label, value] pairs.
 * @returns Formatted table string.
 */
export function table(rows: Array<[string, string | number | undefined | null]>): string {
  const maxLabel = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => {
      const displayValue = value === undefined || value === null ? color("(none)", gray) : String(value);
      return `  ${color(label.padEnd(maxLabel) + ":", cyan)} ${displayValue}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// JSON highlighting
// ---------------------------------------------------------------------------

/**
 * Pretty-print a JSON value with ANSI highlighting.
 *
 * @param data - Any JSON-serializable value.
 * @param indent - Indentation level (default: 2).
 * @returns Highlighted JSON string.
 */
export function highlightJson(data: unknown, indent = 2): string {
  const raw = JSON.stringify(data, null, indent);
  if (!supportsColor) return raw;

  return raw
    .replace(/"([^"]+)":/g, `${cyan}"$1"${reset}:`) // keys
    .replace(/: "([^"]*)"/g, `: ${green}"$1"${reset}`) // string values
    .replace(/: (\d+(?:\.\d+)?)/g, `: ${yellow}$1${reset}`) // numbers
    .replace(/: (true|false)/g, `: ${magenta}$1${reset}`) // booleans
    .replace(/: (null)/g, `: ${dim}$1${reset}`); // null
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

/** Format an HTTP status code with color. */
export function statusBadge(code: number): string {
  if (code >= 200 && code < 300) return color(String(code), green);
  if (code === 402) return color(String(code), yellow);
  if (code >= 400 && code < 500) return color(String(code), red);
  if (code >= 500) return color(String(code), red);
  return color(String(code), white);
}

/** Format a success/failure badge. */
export function successBadge(success: boolean): string {
  return success ? color("OK", green) : color("FAIL", red);
}

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

/**
 * Draw a simple box around text.
 */
export function box(text: string): string {
  const lines = text.split("\n");
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length));
  const top = `${dim}┌${"─".repeat(maxLen + 2)}┐${reset}`;
  const bottom = `${dim}└${"─".repeat(maxLen + 2)}┘${reset}`;
  const middle = lines
    .map((l) => {
      const stripped = stripAnsi(l);
      const pad = " ".repeat(Math.max(0, maxLen - stripped.length));
      return `${dim}│${reset} ${l}${pad} ${dim}│${reset}`;
    })
    .join("\n");
  return `${top}\n${middle}\n${bottom}`;
}

/**
 * Strip ANSI escape sequences from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
