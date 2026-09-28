function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return null;

  const octets = parts.map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isNonPublicIpv4([first, second, third]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function firstIpv6Hextets(hostname: string): [number, number] | null {
  if (!hostname.includes(":")) return null;

  const [first = "0", second = "0"] = hostname.split(":");
  const firstValue = Number.parseInt(first || "0", 16);
  const secondValue = Number.parseInt(second || "0", 16);
  return Number.isNaN(firstValue) || Number.isNaN(secondValue)
    ? null
    : [firstValue, secondValue];
}

function isNonPublicIpv6(hostname: string): boolean {
  const hextets = firstIpv6Hextets(hostname);
  if (!hextets) return false;

  const [first, second] = hextets;
  return (
    first === 0 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8)
  );
}

export function isPublicHttpsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hostname
    ) {
      return false;
    }
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }

    const ipv4 = parseIpv4(hostname);
    if (ipv4) return !isNonPublicIpv4(ipv4);
    return !isNonPublicIpv6(hostname);
  } catch {
    return false;
  }
}
