/** Injected by the provisioner. Images only need OpenSSH and the boot hook. */
export const MACHINE_SSH_START_SCRIPT = String.raw`#!/bin/sh
set -eu
source_dir=/etc/kody-ssh
state_dir="$HOME/.kody-ssh"
umask 077
mkdir -p "$state_dir"
chmod 700 "$state_dir"
cp "$source_dir/host_key" "$state_dir/host_key"
cp "$source_dir/authorized_keys" "$state_dir/authorized_keys"
chmod 600 "$state_dir/host_key" "$state_dir/authorized_keys"
# Fly injects files before starting the image. Restrict the originals too
# when the image runs as root; rootless images copy them into their own home.
if [ "$(id -u)" = 0 ]; then
  chmod 700 "$source_dir"
  chmod 600 "$source_dir/host_key" "$source_dir/access.enc"
  mkdir -p /run/sshd
fi
cat > "$state_dir/sshd_config" <<EOF
Port 22022
ListenAddress 0.0.0.0
HostKey $state_dir/host_key
PidFile $state_dir/sshd.pid
AuthorizedKeysFile $state_dir/authorized_keys
AllowUsers $(id -un)
AuthenticationMethods publickey
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin prohibit-password
UsePAM no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
GatewayPorts no
MaxAuthTries 3
LoginGraceTime 30
MaxStartups 10:30:30
StrictModes yes
Subsystem sftp internal-sftp
EOF
if [ -f /etc/kody-agent/setup.sh ]; then
  sh /etc/kody-agent/setup.sh
fi
exec /usr/sbin/sshd -f "$state_dir/sshd_config"
`;
