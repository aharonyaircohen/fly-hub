import type { Connection } from "./model";
import { verifyFacebookPageConnection } from "./facebook-verification";
import { verifyInstagramConnection } from "./instagram-verification";

export type ConnectionVerificationResult =
  | { ok: true; externalName: string }
  | { ok: false; reason: string };

export async function verifyConnection(
  connection: Connection,
  accessToken: string,
): Promise<ConnectionVerificationResult> {
  if (connection.provider === "facebook" && connection.accountType === "page") {
    return verifyFacebookPageConnection({
      externalId: connection.externalId,
      accessToken,
    });
  }
  if (
    connection.provider === "instagram" &&
    connection.accountType === "professional"
  ) {
    return verifyInstagramConnection({
      externalId: connection.externalId,
      accessToken,
    });
  }
  return { ok: false, reason: "unsupported_connection" };
}
