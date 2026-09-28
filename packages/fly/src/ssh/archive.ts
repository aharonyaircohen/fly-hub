import { strToU8, zipSync, type Zippable } from "fflate";
import { machineSshDownload } from "./machine-access";

/** A portable OpenSSH profile, with no Fly token or server private key. */
export function machineSshArchive(
  input: Parameters<typeof machineSshDownload>[0],
) {
  const download = machineSshDownload(input);
  const macInstaller = [
    "#!/bin/zsh",
    "set -e",
    'source_dir="${0:A:h}"',
    `alias_name="${download.alias}"`,
    'target="$HOME/.ssh/kody/$alias_name"',
    '/usr/bin/install -d -m 700 "$HOME/.ssh" "$HOME/.ssh/kody" "$target"',
    '/usr/bin/install -m 600 "$source_dir/config" "$target/config"',
    '/usr/bin/install -m 600 "$source_dir/identity" "$target/identity"',
    '/usr/bin/install -m 600 "$source_dir/known_hosts" "$target/known_hosts"',
    '/usr/bin/touch "$HOME/.ssh/config"',
    '/bin/chmod 600 "$HOME/.ssh/config"',
    "/usr/bin/grep -qxF 'Include ~/.ssh/kody/*/config' \"$HOME/.ssh/config\" || /usr/bin/printf '\\nInclude ~/.ssh/kody/*/config\\n' >> \"$HOME/.ssh/config\"",
    'echo "SSH connection installed: $alias_name"',
    'echo "Now open ChatGPT Desktop > Settings > Connections > SSH > Add."',
    'echo "Select: $alias_name"',
    'read "?Press Return to close."',
    "",
  ].join("\n");
  const readme = [
    `SSH settings for ${input.app} / ${input.machineId}`,
    "",
    "Mac setup:",
    "1. Unzip this download.",
    `2. Open the ${download.alias} folder.`,
    "3. Double-click Install on Mac.command.",
    "4. In ChatGPT Desktop, open Settings > Connections > SSH > Add.",
    `5. Select ${download.alias}.`,
    "",
    `Or run: ssh ${download.alias}`,
    "Requires OpenSSH and openssl on your computer.",
    "Keep the identity file private: it grants access to this machine.",
    "",
  ].join("\n");
  const files: Zippable = {};
  for (const [name, content] of Object.entries({
    config: download.config,
    identity: download.identity,
    known_hosts: download.knownHosts,
    "README.txt": readme,
  })) {
    files[`${download.alias}/${name}`] = [
      strToU8(content),
      { os: 3, attrs: (0o100600 << 16) >>> 0 },
    ];
  }
  files[`${download.alias}/Install on Mac.command`] = [
    strToU8(macInstaller),
    { os: 3, attrs: (0o100755 << 16) >>> 0 },
  ];
  return { filename: `${download.alias}.zip`, bytes: zipSync(files) };
}
