import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, isOlderThan } from '../utils/semver';

describe('compareVersions', () => {
  /**
   * The headline regression. A plain string compare puts '1.0.10' below
   * '1.0.9' because '1' sorts before '9'. The app ships 1.0.9 today, so the
   * very next release is the one that would break.
   */
  it('orders 1.0.10 above 1.0.9', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1);
    expect(isOlderThan('1.0.9', '1.0.10')).toBe(true);
  });

  it('orders across every segment', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('pads a shorter version, so 1.1 equals 1.1.0', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.1.0.0', '1.1')).toBe(0);
    expect(compareVersions('1.2', '1.1.9')).toBe(1);
  });

  it('tolerates a leading v and ignores prerelease and build suffixes', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    // Stripped, not ordered — see the note in utils/semver.ts. Ranking a
    // prerelease below its release would only ever make us block more.
    expect(compareVersions('1.2.3-beta', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3+build.7', '1.2.3')).toBe(0);
  });

  it('treats leading zeroes numerically', () => {
    expect(compareVersions('01.02.03', '1.2.3')).toBe(0);
  });

  it.each([
    ['', '1.0.0'],
    ['abc', '1.0.0'],
    ['1.2.3.4.5', '1.0.0'],
    ['1.-2.3', '1.0.0'],
    ['1234567.0.0', '1.0.0'],
    ['1.0.0', 'not a version'],
  ])('returns null for unparseable input (%s vs %s)', (a, b) => {
    expect(compareVersions(a, b)).toBeNull();
  });

  it.each([null, undefined, 42, {}, [], true])('returns null for the non-string %s', v => {
    expect(compareVersions(v, '1.0.0')).toBeNull();
  });
});

describe('isOlderThan', () => {
  /**
   * The safety property the whole update gate rests on. If a garbled version
   * ever read as "old", every device that could not report its version would
   * be told to update — and updating would not fix a broken version read, so
   * there would be no way out.
   */
  it('an unparseable version is never treated as old', () => {
    expect(isOlderThan('garbage', '1.0.0')).toBe(false);
    expect(isOlderThan('', '1.0.0')).toBe(false);
    expect(isOlderThan(undefined, '1.0.0')).toBe(false);
    expect(isOlderThan('1.0.0', 'garbage')).toBe(false);
  });

  it('is false for equal and newer versions', () => {
    expect(isOlderThan('1.0.0', '1.0.0')).toBe(false);
    expect(isOlderThan('1.1.0', '1.0.0')).toBe(false);
  });
});

describe('parseVersion', () => {
  it('returns numeric segments', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion(' v1.2 ')).toEqual([1, 2]);
  });

  it('returns null rather than a partial parse', () => {
    expect(parseVersion('1.2.x')).toBeNull();
  });
});
