import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type BrowserDnsResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedIpv4(mapped[1]!) : false;
}

export function isBlockedBrowserAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

const defaultResolver: BrowserDnsResolver = async (hostname) =>
  await lookup(hostname, { all: true, verbatim: true });

export async function validatePublicBrowserUrl(
  rawUrl: string,
  resolveDns: BrowserDnsResolver = defaultResolver,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("browser_url_blocked");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("browser_url_blocked");
  }
  if (url.username || url.password) throw new Error("browser_url_blocked");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("browser_url_blocked");
  }

  if (isIP(hostname)) {
    if (isBlockedBrowserAddress(hostname)) throw new Error("browser_url_blocked");
    return url.toString();
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolveDns(hostname);
  } catch {
    throw new Error("browser_url_blocked");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedBrowserAddress(address))
  ) {
    throw new Error("browser_url_blocked");
  }
  return url.toString();
}
