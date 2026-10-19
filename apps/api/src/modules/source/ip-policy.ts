import { BlockList, isIP } from 'node:net';

/**
 * Address ranges a public-facing fetcher must never connect to: loopback, private networks,
 * link-local (incl. the cloud metadata address 169.254.169.254), CGNAT, multicast, reserved
 * and documentation ranges, plus IPv6 forms that can smuggle an IPv4 address past a naive check.
 */
const BLOCKED_RANGES: ReadonlyArray<readonly [address: string, prefix: number, family: 4 | 6]> = [
  // IPv4
  ['0.0.0.0', 8, 4], // "this" network
  ['10.0.0.0', 8, 4], // private
  ['100.64.0.0', 10, 4], // carrier-grade NAT
  ['127.0.0.0', 8, 4], // loopback
  ['169.254.0.0', 16, 4], // link-local / cloud metadata
  ['172.16.0.0', 12, 4], // private
  ['192.0.0.0', 24, 4], // IETF protocol assignments
  ['192.0.2.0', 24, 4], // documentation
  ['192.88.99.0', 24, 4], // 6to4 relay (deprecated)
  ['192.168.0.0', 16, 4], // private
  ['198.18.0.0', 15, 4], // benchmarking
  ['198.51.100.0', 24, 4], // documentation
  ['203.0.113.0', 24, 4], // documentation
  ['224.0.0.0', 4, 4], // multicast
  ['240.0.0.0', 4, 4], // reserved + broadcast
  // IPv6
  ['::', 128, 6], // unspecified
  ['::1', 128, 6], // loopback
  ['64:ff9b::', 96, 6], // NAT64 (embeds an IPv4 address)
  ['64:ff9b:1::', 48, 6], // local-use NAT64
  ['100::', 64, 6], // discard-only
  ['2001::', 32, 6], // Teredo (embeds an IPv4 address)
  ['2001:db8::', 32, 6], // documentation
  ['2002::', 16, 6], // 6to4 (embeds an IPv4 address)
  ['fc00::', 7, 6], // unique local
  ['fe80::', 10, 6], // link-local
  ['ff00::', 8, 6], // multicast
];

// Note: IPv4-mapped IPv6 (::ffff:a.b.c.d) is handled in isBlockedAddress. BlockList treats plain
// IPv4 addresses as members of that range, so listing it here would block the whole IPv4 internet.
const blockList = new BlockList();
for (const [address, prefix, family] of BLOCKED_RANGES) {
  blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
}

/** True when `address` is an IP literal inside a range we refuse to connect to. */
export function isBlockedAddress(address: string): boolean {
  const unscoped = address.split('%')[0] ?? address; // strip IPv6 zone id
  const family = isIP(unscoped);
  if (family === 0) return true; // not an IP at all: fail closed
  // IPv4-mapped addresses (::ffff:127.0.0.1) are never a legitimate public target.
  if (family === 6 && isIpv4Mapped(unscoped)) return true;
  return blockList.check(unscoped, family === 4 ? 'ipv4' : 'ipv6');
}

function isIpv4Mapped(ipv6: string): boolean {
  // The URL parser canonicalises every spelling (dotted, hex, zero-padded) to "::ffff:x:y".
  return new URL(`http://[${ipv6}]/`).hostname.startsWith('[::ffff:');
}
