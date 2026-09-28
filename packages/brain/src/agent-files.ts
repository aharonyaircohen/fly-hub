import { prepareAgentAccess } from "./agent-access";
import { getPersonalBrainServices } from "./personal-services";
import {
  BRAIN_AGENT_CLIENT,
  BRAIN_AGENT_SETUP,
  BRAIN_AGENT_SKILL,
} from "./agent-client";

export async function prepareBrainAgentFiles(
  app: string,
  dashboardUrl: string,
) {
  const user = await getPersonalBrainServices().resolveUser();
  if (!user) throw new Error("Personal Brain owner is required");
  const connection = await prepareAgentAccess(user.id, app, dashboardUrl);
  return Object.entries({
    "connection.json": JSON.stringify(connection),
    "client.mjs": BRAIN_AGENT_CLIENT,
    "setup.sh": BRAIN_AGENT_SETUP,
    "SKILL.md": BRAIN_AGENT_SKILL,
  }).map(([name, content]) => ({
    guest_path: "/etc/kody-agent/" + name,
    raw_value: Buffer.from(content).toString("base64"),
  }));
}
