import { EXIT_CODES, OpsiError } from "@opsi/domain";
import ipaddr from "ipaddr.js";

export interface AddressRecord {
  readonly address: string;
  readonly family: number;
}
const PUBLIC_RANGES = new Set(["unicast"]);
export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return PUBLIC_RANGES.has(parsed.range());
  } catch {
    return false;
  }
}
export function assertPublicAddressSet(
  addresses: readonly AddressRecord[],
): readonly AddressRecord[] {
  if (
    addresses.length === 0 ||
    addresses.length > 64 ||
    addresses.some(
      (item) => (item.family !== 4 && item.family !== 6) || !isPublicAddress(item.address),
    )
  ) {
    throw new OpsiError({
      code: "NETWORK_ADDRESS_FORBIDDEN",
      message: "The destination resolves to a private or special-purpose network address.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: { addresses: addresses.map(({ address, family }) => ({ address, family })) },
    });
  }
  return addresses;
}
