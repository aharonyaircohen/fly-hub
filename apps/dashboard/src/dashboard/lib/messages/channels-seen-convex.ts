import "server-only";
import type { Octokit } from "@octokit/rest";
import { backendApi, getConvexClient, tenantIdFor } from "../backend/convex-backend";
import { emptyChannelsSeenManifest, type ChannelsSeenManifest } from "./channels-seen";

async function loginFor(octokit: Octokit): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  if (!data.login) throw new Error("GitHub login unavailable");
  return data.login.toLowerCase();
}

export async function readChannelsSeen(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<ChannelsSeenManifest> {
  const login = await loginFor(octokit);
  const row = await getConvexClient().query(backendApi.channelsSeen.get, {
    tenantId: tenantIdFor(owner, repo),
    login,
  });
  if (row?.manifest) return row.manifest as ChannelsSeenManifest;
  const manifest = emptyChannelsSeenManifest();
  await getConvexClient().mutation(backendApi.channelsSeen.save, {
    tenantId: tenantIdFor(owner, repo), login, manifest, updatedAt: new Date().toISOString(),
  });
  return manifest;
}

export async function markChannelSeen(
  octokit: Octokit,
  owner: string,
  repo: string,
  channelNumber: number,
  at: string,
): Promise<ChannelsSeenManifest> {
  const login = await loginFor(octokit);
  const current = await getConvexClient().query(backendApi.channelsSeen.get, {
    tenantId: tenantIdFor(owner, repo), login,
  });
  const manifest = (current?.manifest as ChannelsSeenManifest | undefined) ?? emptyChannelsSeenManifest();
  const next = { ...manifest, seen: { ...manifest.seen, [String(channelNumber)]: at } };
  await getConvexClient().mutation(backendApi.channelsSeen.save, {
    tenantId: tenantIdFor(owner, repo), login, manifest: next, updatedAt: new Date().toISOString(),
  });
  return next;
}
