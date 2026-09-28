import { NextRequest } from "next/server";
import {
  DELETE,
  GET,
  handleKodyMcpPost,
} from "@kody-ade/kody-chat-dashboard/routes/kody/mcp";
import { createKodyMcpActionServices } from "@dashboard/lib/mcp/action-services";

export { DELETE, GET };

export async function POST(req: NextRequest) {
  return await handleKodyMcpPost(req, {
    services: createKodyMcpActionServices({ origin: req.nextUrl.origin }),
  });
}
