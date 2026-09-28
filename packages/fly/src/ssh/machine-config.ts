import { randomInt } from "node:crypto";
import {
  decrypt,
  encrypt,
  isVaultConfigured,
} from "@kody-ade/base/vault/crypto";
import {
  allocateSharedIps,
  listMachines,
  type FlyPreviewConfig,
  type MachineConfig,
} from "../plugin/previews/machines-client";
import {
  createMachineSshAccess,
  machineSshAccessSchema,
  MACHINE_SSH_INTERNAL_PORT,
  type MachineSshAccess,
} from "./machine-access";
import { MACHINE_SSH_START_SCRIPT } from "./start-script";

const ACCESS_PATH = "/etc/kody-ssh/access.enc";
interface MachineFile {
  guest_path: string;
  raw_value: string;
}

function machineFiles(config: MachineConfig): MachineFile[] {
  if (!Array.isArray(config.files)) return [];
  return config.files.filter(
    (file): file is MachineFile =>
      !!file &&
      typeof file.guest_path === "string" &&
      typeof file.raw_value === "string",
  );
}

export function sshPorts(config: MachineConfig | undefined): number[] {
  return (config?.services ?? []).flatMap((service) =>
    Array.isArray(service.ports)
      ? service.ports.flatMap((entry) =>
          typeof entry?.port === "number" ? [entry.port] : [],
        )
      : [],
  );
}

export function applyMachineSshAccess(
  config: MachineConfig,
  access: MachineSshAccess,
): MachineConfig {
  machineSshAccessSchema.parse(access);
  const contents: Record<string, string> = {
    "/etc/kody-ssh/start.sh": MACHINE_SSH_START_SCRIPT,
    "/etc/kody-ssh/host_key": access.hostPrivateKey,
    "/etc/kody-ssh/authorized_keys": `${access.authorizedKey}\n`,
    [ACCESS_PATH]: encrypt(JSON.stringify(access)),
  };
  return {
    ...config,
    files: [
      ...(Array.isArray(config.files) ? config.files : []).filter(
        (file) => !Object.hasOwn(contents, file.guest_path),
      ),
      ...Object.entries(contents).map(([guest_path, content]) => ({
        guest_path,
        raw_value: Buffer.from(content).toString("base64"),
      })),
    ],
    services: [
      ...(config.services ?? []).filter(
        (service) => service.internal_port !== MACHINE_SSH_INTERNAL_PORT,
      ),
      {
        protocol: "tcp",
        internal_port: MACHINE_SSH_INTERNAL_PORT,
        ports: [{ port: access.port, handlers: ["tls"] }],
        autostart: true,
        autostop:
          config.auto_destroy === true
            ? false
            : (config.services?.[0]?.autostop ?? "suspend"),
        min_machines_running: 0,
        concurrency: { type: "connections", soft_limit: 10, hard_limit: 20 },
      },
    ],
  };
}

export function readMachineSshAccess(
  config: MachineConfig | undefined,
): MachineSshAccess | null {
  if (!config) return null;
  const file = machineFiles(config).find(
    (entry) => entry.guest_path === ACCESS_PATH,
  );
  if (!file) return null;
  return machineSshAccessSchema.parse(
    JSON.parse(decrypt(Buffer.from(file.raw_value, "base64").toString("utf8"))),
  );
}

/** Shared creation boundary. Does not replace the image's entrypoint or user. */
export async function prepareMachineSsh(input: {
  app: string;
  config: MachineConfig;
  cfg: FlyPreviewConfig;
  username?: string;
}): Promise<MachineConfig> {
  // Standalone callers without a Dashboard vault cannot retain downloadable
  // credentials. They keep their existing machine behavior, without SSH export.
  if (!isVaultConfigured()) return input.config;
  if (
    input.config.services?.some(
      (service) => service.internal_port === MACHINE_SSH_INTERNAL_PORT,
    )
  ) {
    throw new Error("Machine already uses the reserved SSH service port");
  }
  const machines = await listMachines(input.app, input.cfg);
  const occupied = new Set([
    ...sshPorts(input.config),
    ...machines.flatMap((machine) => sshPorts(machine.config)),
  ]);
  let port = randomInt(20000, 60000);
  for (let i = 0; i < 40000 && occupied.has(port); i++)
    port = port === 59999 ? 20000 : port + 1;
  if (occupied.has(port)) throw new Error("No SSH service port available");
  const access = await createMachineSshAccess({
    app: input.app,
    port,
    username: input.username,
  });
  await allocateSharedIps(input.app, input.cfg);
  return applyMachineSshAccess(input.config, access);
}
