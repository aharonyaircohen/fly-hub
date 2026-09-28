import { execFileSync } from "node:child_process";

const baseUrl = process.env.LIVE_BROWSER_BASE_URL ?? "http://127.0.0.1:3333";
const [owner, repo] = (
  process.env.LIVE_BROWSER_REPOSITORY ?? "aharonyaircohen/kody-chat"
).split("/");
const githubUser = process.env.LIVE_BROWSER_GITHUB_USER ?? owner;
const githubToken =
  process.env.LIVE_BROWSER_GITHUB_TOKEN ??
  execFileSync("gh", ["auth", "token", "--user", githubUser], {
    encoding: "utf8",
  }).trim();

if (!owner || !repo || !githubToken) {
  throw new Error(
    "Live browser repository and GitHub authentication are required",
  );
}

const userResponse = await fetch("https://api.github.com/user", {
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": "kody-browser-live-verifier",
  },
});
if (!userResponse.ok)
  throw new Error(`GitHub identity failed: ${userResponse.status}`);
const { login: actorLogin } = await userResponse.json();
if (!actorLogin) throw new Error("GitHub identity did not include a login");

const headers = {
  "Content-Type": "application/json",
  "x-kody-token": githubToken,
  "x-kody-owner": owner,
  "x-kody-repo": repo,
  "x-kody-user-login": actorLogin,
};

async function browserRequest(body) {
  const deadline = Date.now() + 90_000;
  while (true) {
    const response = await fetch(`${baseUrl}/api/kody/browser/session`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.ok) return result;
    if (
      body.operation === "start" &&
      response.status === 409 &&
      result.error === "browser_start_in_progress" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, result.retryAfterMs ?? 1_000),
      );
      continue;
    }
    throw new Error(
      `${body.operation} failed (${response.status}): ${JSON.stringify(result)}`,
    );
  }
}

const startedAt = Date.now();
const session = await browserRequest({
  operation: "start",
  actorLogin,
  initialUrl: "https://httpbin.org/forms/post",
});
const sessionStartupMs = Date.now() - startedAt;
if (session.mode !== "remote" || session.state !== "running") {
  throw new Error(
    `Expected a running remote browser, received ${JSON.stringify(session)}`,
  );
}

const messages = [];
const socket = new WebSocket(session.streamUrl);
socket.addEventListener("message", async (event) => {
  const raw =
    typeof event.data === "string" ? event.data : await event.data.text();
  messages.push(JSON.parse(raw));
});

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = messages.find(predicate);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

await waitFor((message) => message.type === "ready", "page stream readiness");
const initialState = await waitFor(
  (message) =>
    message.type === "state" && message.page?.url?.includes("httpbin.org"),
  "initial authoritative page state",
);
await waitFor((message) => message.type === "frame", "first page frame");

const navigate = await browserRequest({
  operation: "act",
  actorLogin,
  sessionId: session.sessionId,
  action: {
    type: "navigate",
    url: "https://www.iana.org/help/example-domains",
  },
});
if (!navigate.page?.canGoBack || !navigate.url?.includes("iana.org")) {
  throw new Error("Navigation did not update authoritative Chromium history");
}

const back = await browserRequest({
  operation: "act",
  actorLogin,
  sessionId: session.sessionId,
  action: { type: "back" },
});
const forward = await browserRequest({
  operation: "act",
  actorLogin,
  sessionId: session.sessionId,
  action: { type: "forward" },
});
const snapshot = await browserRequest({
  operation: "act",
  actorLogin,
  sessionId: session.sessionId,
  action: { type: "snapshot" },
});

if (!back.url?.includes("httpbin.org") || !forward.url?.includes("iana.org")) {
  throw new Error("Back or Forward opened the wrong page");
}
if (snapshot.url !== forward.url || !snapshot.data?.snapshot?.text) {
  throw new Error("Fresh page context did not match the visible browser page");
}

socket.close();
process.stdout.write(
  JSON.stringify({
    ok: true,
    actorLogin,
    sessionId: session.sessionId,
    sessionStartupMs,
    totalJourneyMs: Date.now() - startedAt,
    initialUrl: initialState.page.url,
    finalUrl: snapshot.url,
    history: true,
    frame: true,
    currentPageContext: true,
  }),
);
