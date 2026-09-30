import { NextRequest, NextResponse } from "next/server";
import { encrypt, decrypt } from "@kody-ade/base/vault/crypto";
import type { RegistryConnection } from "@kody-ade/fly/hub/saved-apps";
const cookie = "fly_hub_registry";
const maxAge = 30 * 24 * 60 * 60;
export function readRegistrySession(
  req: NextRequest,
): RegistryConnection | null {
  try {
    const value = req.cookies.get(cookie)?.value;
    if (!value) return null;
    const session = JSON.parse(decrypt(value));
    if (
      typeof session.user !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,38}$/i.test(session.user) ||
      typeof session.token !== "string" ||
      !session.token ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Date.now()
    )
      return null;
    return { user: session.user, token: session.token };
  } catch {
    return null;
  }
}
export function setRegistrySession(
  response: NextResponse,
  connection: RegistryConnection | null,
) {
  response.cookies.set(
    cookie,
    connection
      ? encrypt(
          JSON.stringify({
            ...connection,
            expiresAt: Date.now() + maxAge * 1000,
          }),
        )
      : "",
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: connection ? maxAge : 0,
    },
  );
}
