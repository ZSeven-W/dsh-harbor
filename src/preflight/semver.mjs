// Minimal semver range matching for host peer ranges. Dependency-free on
// purpose: the CLI runs without DSH or node_modules. Covers the range shapes
// that appear in plugin peerDependencies (`^`, `~`, `>=`, `>`, `<=`, `<`,
// `=`, bare versions, `x`/`*`, `||` unions, space-separated intersections)
// and applies npm's prerelease rule: a prerelease version satisfies a range
// only through a comparator whose own version shares its major.minor.patch
// and carries a prerelease tag.

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** @returns {{major:number, minor:number, patch:number, pre: Array<string|number>}|null} */
export function parseVersion(value) {
  const m = SEMVER.exec(String(value ?? '').trim());
  if (!m) return null;
  const pre = m[4] === undefined ? [] : m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id));
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release is higher than any of its prereleases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    if (typeof x === 'number') return -1; // numeric identifiers sort before strings
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a, b) {
  const pa = typeof a === 'string' ? parseVersion(a) : a;
  const pb = typeof b === 'string' ? parseVersion(b) : b;
  if (!pa || !pb) return NaN;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePre(pa.pre, pb.pre);
}

const PARTIAL = /^([<>]=?|=|\^|~)?\s*v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
const isWild = (part) => part === undefined || part === 'x' || part === 'X' || part === '*';

/**
 * Expand one range token into comparators `{op, version}`. Returns null for
 * shapes this matcher does not understand (hyphen ranges, odd syntax), which
 * callers report as "unparseable" rather than guessing.
 */
function comparatorsFor(token) {
  const t = token.trim();
  if (t === '' || t === '*' || t === 'x' || t === 'X') return [];
  const m = PARTIAL.exec(t);
  if (!m) return null;
  const [, opRaw, majorRaw, minorRaw, patchRaw, preRaw] = m;
  if (isWild(majorRaw)) return [];
  const major = Number(majorRaw);
  const minorWild = isWild(minorRaw);
  const patchWild = isWild(patchRaw);
  const minor = minorWild ? 0 : Number(minorRaw);
  const patch = patchWild ? 0 : Number(patchRaw);
  const pre = preRaw === undefined ? [] : preRaw.split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id));
  const lower = { major, minor, patch, pre };
  const op = opRaw ?? (minorWild || patchWild ? 'x' : '=');

  const gte = (v) => ({ op: '>=', version: v });
  const lt = (v) => ({ op: '<', version: v });
  const bump = (kind) => (kind === 'major'
    ? { major: major + 1, minor: 0, patch: 0, pre: [0] }
    : kind === 'minor'
      ? { major, minor: minor + 1, patch: 0, pre: [0] }
      : { major, minor, patch: patch + 1, pre: [0] });

  switch (op) {
    case '=':
      return [{ op: '=', version: lower }];
    case 'x':
      return minorWild ? [gte(lower), lt(bump('major'))] : [gte(lower), lt(bump('minor'))];
    case '^':
      if (minorWild) return [gte(lower), lt(bump('major'))];
      if (patchWild) return major === 0 ? [gte(lower), lt(bump('minor'))] : [gte(lower), lt(bump('major'))];
      if (major !== 0) return [gte(lower), lt(bump('major'))];
      if (minor !== 0) return [gte(lower), lt(bump('minor'))];
      return [gte(lower), lt(bump('patch'))];
    case '~':
      return minorWild ? [gte(lower), lt(bump('major'))] : [gte(lower), lt(bump('minor'))];
    case '>=': return [gte(lower)];
    case '>': return [{ op: '>', version: lower }];
    case '<=': return [{ op: '<=', version: lower }];
    case '<': return [lt(lower)];
    default: return null;
  }
}

function test(comparator, version) {
  const c = compareVersions(version, comparator.version);
  switch (comparator.op) {
    case '=': return c === 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    default: return false;
  }
}

/**
 * @returns {'satisfied'|'unsatisfied'|'unparseable'}
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return 'unparseable';
  const unions = String(range ?? '').split('||');
  let parsedAny = false;
  for (const union of unions) {
    const tokens = union.trim().split(/\s+/).filter(Boolean);
    const comparators = [];
    let ok = true;
    for (const token of tokens) {
      const cs = comparatorsFor(token);
      if (cs === null) { ok = false; break; }
      comparators.push(...cs);
    }
    if (!ok) continue;
    parsedAny = true;
    if (!comparators.every((c) => test(c, v))) continue;
    if (v.pre.length > 0) {
      // npm: a prerelease only matches when some comparator in this set is
      // itself a prerelease on the same major.minor.patch tuple.
      const allowed = comparators.some((c) => c.version.pre.length > 0
        && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch);
      if (!allowed) continue;
    }
    return 'satisfied';
  }
  return parsedAny ? 'unsatisfied' : 'unparseable';
}
