/**
 * Input-validation helpers shared across the app.
 */

const IPV4_LITERAL_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV4_PRIVATE_PREFIX_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
const IPV4_MAPPED_DOTTED_RE = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/;
const IPV4_MAPPED_HEX_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/**
 * Fold IPv4-mapped IPv6 literals (::ffff:a.b.c.d and its hex form
 * ::ffff:XXXX:YYYY) down to their bare IPv4 representation so the
 * same RFC1918 / loopback gate applies regardless of URL encoding.
 * Returns null for anything that isn't an IPv4-mapped IPv6 literal.
 */
function normalizeIpv4MappedIpv6(hostname: string): string | null {
  const dotted = IPV4_MAPPED_DOTTED_RE.exec(hostname);
  if (dotted?.[1]) return dotted[1];
  const hex = IPV4_MAPPED_HEX_RE.exec(hostname);
  if (hex?.[1] && hex[2]) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const a = (hi >>> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >>> 8) & 0xff;
      const d = lo & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }
  return null;
}

/**
 * Validate that a URL is http(s) pointing to localhost, or — if `allowLan` —
 * to a private-network literal (RFC1918 IPv4, ULA fc00::/7, or link-local
 * fe80::/10 IPv6). Returns the trimmed URL without trailing slash.
 *
 * Rejects hostnames that coincidentally start with "fc"/"fd"/etc. but are
 * not IP literals: a hostname containing a colon must be an IPv6 literal
 * (bracketed in the source URL), and a hostname of all-digits-and-dots
 * must match the IPv4 literal shape.
 */
export function assertLocalUrl(url: string, allowLan = false): string {
  if (typeof url !== 'string') throw new Error('Invalid URL');
  const trimmed = url.replace(/\/$/, '').trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// or https:// URLs are allowed');
  }
  // URL.hostname preserves brackets for IPv6 literals: '[::1]' etc. Strip
  // them so character-level checks work uniformly.
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // Fold IPv4-mapped IPv6 to IPv4 so "::ffff:10.0.0.1" or "::ffff:a00:1"
  // cannot sneak past the RFC1918 / loopback gates by virtue of encoding.
  const mappedV4 = normalizeIpv4MappedIpv6(hostname);
  const effective = mappedV4 ?? hostname;

  if (effective === 'localhost' || effective === '127.0.0.1' || effective === '::1') {
    return trimmed;
  }

  if (allowLan) {
    // IPv4 literal (bare or unwrapped from ::ffff:) in RFC1918 ranges.
    if (IPV4_LITERAL_RE.test(effective) && IPV4_PRIVATE_PREFIX_RE.test(effective)) {
      return trimmed;
    }
    // IPv6 literal: must contain ':' to distinguish from DNS names that
    // happen to start with "fc"/"fd"/"fe".
    if (effective.includes(':')) {
      if (
        effective.startsWith('fc') ||
        effective.startsWith('fd') ||
        effective.startsWith('fe80:')
      ) {
        return trimmed;
      }
    }
  }

  throw new Error(
    allowLan
      ? 'URL must point to localhost or a private network address'
      : 'URL must point to localhost. Enable "Allow LAN access" in settings for private network addresses.',
  );
}
