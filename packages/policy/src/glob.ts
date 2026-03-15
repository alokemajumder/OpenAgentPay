/**
 * @module glob
 *
 * Simple glob pattern matching for domain names.
 *
 * Supports three match modes:
 * - **Exact match** — `"api.example.com"` matches only `"api.example.com"`
 * - **Single wildcard (`*`)** — matches exactly one domain segment
 *   (e.g., `"*.example.com"` matches `"api.example.com"` but NOT `"deep.api.example.com"`)
 * - **Double wildcard (`**`)** — matches one or more domain segments
 *   (e.g., `"**.example.com"` matches both `"api.example.com"` AND `"deep.api.example.com"`)
 */

/**
 * Test whether a domain matches a glob pattern.
 *
 * @param pattern - The glob pattern (e.g., `"*.example.com"`, `"**.trusted.dev"`)
 * @param domain - The domain to test (e.g., `"api.example.com"`)
 * @returns `true` if the domain matches the pattern
 *
 * @example
 * ```typescript
 * globMatch('*.example.com', 'api.example.com')        // true
 * globMatch('*.example.com', 'deep.api.example.com')   // false
 * globMatch('**.example.com', 'deep.api.example.com')  // true
 * globMatch('api.example.com', 'api.example.com')      // true
 * ```
 */
export function globMatch(pattern: string, domain: string): boolean {
  // Normalize to lowercase for case-insensitive matching
  const p = pattern.toLowerCase();
  const d = domain.toLowerCase();

  // Exact match
  if (p === d) {
    return true;
  }

  // Double wildcard: ** matches one or more segments
  if (p.startsWith("**.")) {
    const suffix = p.slice(3); // remove "**."
    // Domain must end with the suffix and have at least one segment before it
    return d.endsWith(`.${suffix}`) || d === suffix;
  }

  // Single wildcard: * matches exactly one segment
  if (p.startsWith("*.")) {
    const suffix = p.slice(2); // remove "*"
    // Domain must end with the suffix and the prefix must be a single segment (no dots)
    if (!d.endsWith(suffix)) {
      return false;
    }
    const prefix = d.slice(0, d.length - suffix.length);
    // prefix should be non-empty and contain no dots (single segment + the dot is in suffix)
    return prefix.length > 0 && !prefix.includes(".");
  }

  return false;
}

/**
 * Test whether a domain matches any pattern in a list.
 *
 * @param patterns - Array of glob patterns
 * @param domain - The domain to test
 * @returns `true` if the domain matches at least one pattern
 */
export function globMatchAny(patterns: string[], domain: string): boolean {
  return patterns.some((pattern) => globMatch(pattern, domain));
}
