/** Dependency-free client installed on personal Brains. Never writes secret values. */
export const BRAIN_AGENT_CLIENT = String.raw`#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
const connection = JSON.parse(readFileSync(new URL('./connection.json', import.meta.url), 'utf8'));
let sessionId;
let protocolVersion;
async function request(path, body, repository) {
  const version = body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? protocolVersion;
  const response = await fetch(connection.url + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json',
      ...(repository ? { 'x-kody-agent-repository': repository } : {}),
      ...(path === '/mcp' ? {
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        ...(version ? { 'mcp-protocol-version': version } : {}),
        'mcp-method': body.method,
        ...(body.params?.name ? { 'mcp-name': body.params.name } : {}),
      } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Kody access failed (' + response.status + '). Check the VPS connection and your Kody permissions.');
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (path === '/mcp') {
    sessionId = response.headers.get('mcp-session-id') ?? sessionId;
    protocolVersion = result?.result?.protocolVersion ?? protocolVersion;
  }
  return result;
}
function currentRepository() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  } catch { return undefined; }
}
const args = process.argv.slice(2);
if (args[0] === 'mcp') {
  const repository = currentRepository();
  for await (const line of createInterface({ input: process.stdin })) {
    let message;
    try {
      message = JSON.parse(line);
      if (!repository) throw new Error('Open a GitHub repository folder to use Kody tools.');
      const result = await request('/mcp', message, repository);
      if (result) process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
      if (message && 'id' in message) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } }) + '\n');
    }
  }
} else if (args[0] === 'exec') {
  try {
    const separator = args.indexOf('--');
    const options = args.slice(1, separator);
    const names = [];
    let repository;
    for (let i = 0; i < options.length; i += 2) {
      if (options[i] === '--secret' && options[i+1]) names.push(options[i+1]);
      else if (options[i] === '--repo' && options[i+1]) repository = options[i+1];
      else throw new Error('Unknown option');
    }
    const command = args.slice(separator + 1);
    if (separator < 0 || !names.length || !command.length) throw new Error('Usage: kody exec --secret NAME [--secret NAME] [--repo owner/repo] -- command args');
    const result = await request('/credentials', { names, ...(repository ? { repository } : {}) });
    const child = spawn(command[0], command.slice(1), { env: { ...process.env, ...result.values }, stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { process.stderr.write('Could not start command\n'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
} else {
  process.stdout.write('Run with Kody credentials: kody exec --secret NAME [--repo owner/repo] -- command args\n');
}
`;

export const BRAIN_AGENT_SETUP = String.raw`#!/bin/sh
set -eu
umask 077
chmod 700 /etc/kody-agent
chmod 600 /etc/kody-agent/connection.json
chmod 700 /etc/kody-agent/client.mjs
ln -sf /etc/kody-agent/client.mjs /usr/local/bin/kody
# The CLI edits only this managed server entry; login and other servers stay intact.
codex mcp add kody-vps -- node /etc/kody-agent/client.mjs mcp >/dev/null
mkdir -p "$HOME/.agents/skills/kody-vps"
cp /etc/kody-agent/SKILL.md "$HOME/.agents/skills/kody-vps/SKILL.md"
`;

export const BRAIN_AGENT_SKILL = `---
name: kody-vps
description: Use Kody tools and saved credentials when working on this Kody-managed VPS.
---
Kody tools are available through the kody-vps MCP connection when this session starts in a GitHub repository folder. Check kody_status, then discover actions and their permissions before using them. Access remains limited to the owner's authorized repositories.

For commands that need credentials, run:
\`kody exec --secret NAME [--secret ANOTHER_NAME] -- command args\`
This reads the named personal credentials at execution time and supplies them only to that child command. To use repository secrets instead, add \`--repo owner/repo\`. Repository access is checked on each request. There is no automatic fallback between personal and repository secrets.

Request only credentials needed for the user's task. Do not print them, save them in repository files, or include them in messages. Commands can access the supplied values, so do not use untrusted commands. Kody's internal service credentials are unavailable. Authorization to connect does not authorize unrelated external actions.
`;
