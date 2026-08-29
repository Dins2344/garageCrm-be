/**
 * Minimal version comparison for `MAJOR.MINOR.PATCH`, the only shape
 * `mobile/app.json` has ever used.
 *
 * Why this exists rather than a dependency: it is thirty lines, and the app
 * store version is compared on a public endpoint that runs on every cold start
 * of every device. A string compare puts `1.0.10` *below* `1.0.9` — the app is
 * on 1.0.9, so the very next release hits that.
 */

/**
 * Version segments, or `null` when the input is not a version.
 *
 * The bounds are deliberate: this parses input from a public, unauthenticated
 * endpoint, so `\d{1,6}` keeps `Number()` inside safe-integer range and stops
 * anyone handing us a 500-digit string to compare.
 *
 * A `-prerelease` or `+build` suffix is **stripped, not ordered**. Real semver
 * ranks `1.0.0-beta` below `1.0.0`; implementing that subtly wrong in the
 * *blocking* direction is how you brick a device. Stripping makes them compare
 * equal, which can only ever make us less likely to block.
 */
export const parseVersion = (v: unknown): number[] | null => {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})(?:[-+].*)?$/.exec(v.trim());
  return m ? m[1].split('.').map(Number) : null;
};

/**
 * `-1 | 0 | 1`, or **`null` when either side is unparseable**.
 *
 * `null` rather than `0` on purpose. `0` reads as "equal", which happens to be
 * safe at both of today's call sites — and that is exactly the problem: it
 * hides the bad input, and inverts the moment someone writes `cmp >= 0`.
 * `null` forces the caller to decide, and every caller here decides in the
 * user's favour.
 */
export const compareVersions = (a: unknown, b: unknown): -1 | 0 | 1 | null => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    // Pad the shorter side, so a policy written as `1.1` and a client
    // reporting `1.1.0` agree rather than silently differing.
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
};

/** True only when both parse and `a` is genuinely older. Never true for junk. */
export const isOlderThan = (a: unknown, b: unknown): boolean =>
  compareVersions(a, b) === -1;
