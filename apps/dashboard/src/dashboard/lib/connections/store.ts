import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@dashboard/lib/backend/convex-backend";
import { ConnectionSchema, type Connection } from "./model";

export async function listConnections(
  owner: string,
  repo: string,
): Promise<Connection[]> {
  const rows = (await getConvexClient().query(backendApi.connections.list, {
    tenantId: tenantIdFor(owner, repo),
  })) as unknown[];
  return rows.map((row) => ConnectionSchema.parse(row));
}

export async function readConnection(
  owner: string,
  repo: string,
  connectionId: string,
): Promise<Connection | null> {
  const row = await getConvexClient().query(backendApi.connections.get, {
    tenantId: tenantIdFor(owner, repo),
    connectionId,
  });
  return row ? ConnectionSchema.parse(row) : null;
}

export async function writeConnection(
  owner: string,
  repo: string,
  connection: Connection,
): Promise<void> {
  await getConvexClient().mutation(backendApi.connections.save, {
    tenantId: tenantIdFor(owner, repo),
    connection: ConnectionSchema.parse(connection),
  });
}
