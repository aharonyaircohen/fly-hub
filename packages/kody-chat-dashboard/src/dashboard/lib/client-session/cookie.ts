import type { NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE, CLIENT_SESSION_TTL_SEC } from "./session";

export function setClientSessionCookie(
  response: NextResponse,
  token: string,
  options: { maxAge?: number } = {},
): void {
  const maxAge = options.maxAge ?? CLIENT_SESSION_TTL_SEC;
  response.cookies.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
