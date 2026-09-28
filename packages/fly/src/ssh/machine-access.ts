import { generateKeyPair, type KeyObject } from "node:crypto";
import { promisify } from "node:util";
import { encrypt, decrypt } from "@kody-ade/base/vault/crypto";
import { z } from "zod";

const generate = promisify(generateKeyPair);
const appSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const machineSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export const MACHINE_SSH_INTERNAL_PORT = 22022;

export const machineSshAccessSchema = z.object({
  version: z.literal(1),
  app: appSchema,
  port: z.number().int().min(1024).max(65535),
  username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
  authorizedKey: z.string().regex(/^ssh-rsa [A-Za-z0-9+/=]+$/),
  hostPublicKey: z.string().regex(/^ssh-rsa [A-Za-z0-9+/=]+$/),
  hostPrivateKey: z.string().startsWith("-----BEGIN RSA PRIVATE KEY-----"),
  encryptedIdentity: z.string().startsWith("v1:"),
});
export type MachineSshAccess = z.infer<typeof machineSshAccessSchema>;

function field(bytes: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return Buffer.concat([size, bytes]);
}

function publicKeyLine(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  function integer(value: string | undefined) {
    if (!value) throw new Error("Missing RSA key integer");
    const bytes = Buffer.from(value, "base64url");
    return field(
      bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes,
    );
  }
  return `ssh-rsa ${Buffer.concat([field(Buffer.from("ssh-rsa")), integer(jwk.e), integer(jwk.n)]).toString("base64")}`;
}

/** Independent login and host keys for a machine; never reuse a platform credential. */
export async function createMachineSshAccess(input: {
  app: string;
  port: number;
  username?: string;
}): Promise<MachineSshAccess> {
  const app = appSchema.parse(input.app);
  const port = z.number().int().min(1024).max(65535).parse(input.port);
  const username = machineSshAccessSchema.shape.username.parse(
    input.username ?? "root",
  );
  const [identity, host] = await Promise.all([
    generate("rsa", { modulusLength: 3072 }),
    generate("rsa", { modulusLength: 3072 }),
  ]);
  const privateKey = identity.privateKey
    .export({ type: "pkcs1", format: "pem" })
    .toString();
  return {
    version: 1,
    app,
    port,
    username,
    authorizedKey: publicKeyLine(identity.publicKey),
    hostPublicKey: publicKeyLine(host.publicKey),
    hostPrivateKey: host.privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString(),
    encryptedIdentity: encrypt(JSON.stringify({ app, privateKey })),
  };
}

/** Caller must authorize the machine before decrypting its downloadable login key. */
export function machineSshDownload(input: {
  app: string;
  machineId: string;
  access: MachineSshAccess;
}) {
  const app = appSchema.parse(input.app);
  const machineId = machineSchema.parse(input.machineId);
  const access = machineSshAccessSchema.parse(input.access);
  const credential = z
    .object({ app: appSchema, privateKey: z.string() })
    .parse(JSON.parse(decrypt(access.encryptedIdentity)));
  if (app !== access.app || app !== credential.app)
    throw new Error("SSH access does not belong to this app");
  const alias = `kody-${app}-${machineId}`;
  const directory = `~/.ssh/kody/${alias}`;
  return {
    alias,
    identity: credential.privateKey,
    knownHosts: `${alias} ${access.hostPublicKey}\n`,
    config: [
      `Host ${alias}`,
      `  HostName ${app}.fly.dev`,
      `  Port ${access.port}`,
      `  User ${access.username}`,
      // TLS supplies SNI so Fly can use its shared IPv4 address. SSH itself
      // still authenticates the pinned machine host key end to end.
      "  ProxyCommand openssl s_client -quiet -connect %h:%p -servername %h -verify_return_error",
      `  IdentityFile ${directory}/identity`,
      "  IdentitiesOnly yes",
      `  HostKeyAlias ${alias}`,
      `  UserKnownHostsFile ${directory}/known_hosts`,
      "  StrictHostKeyChecking yes",
      "  ServerAliveInterval 30",
      "  ServerAliveCountMax 3",
      "",
    ].join("\n"),
  };
}
