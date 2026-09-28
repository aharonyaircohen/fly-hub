import http from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pipeline } from "node:stream/promises";

import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import { WebSocketServer, WebSocket } from "ws";

import {
  browserActionForStreamMessage,
  encodeBrowserFrame,
  parseBrowserStreamMessage,
} from "./src/browsers/stream-protocol.ts";
import { createLatestFrameBuffer } from "./src/browsers/frame-flow.ts";
import { validatePublicBrowserUrl } from "./src/browsers/security.ts";
import { readBrowserTicket } from "./src/browsers/ticket.ts";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_BYTES = 50 * 1024;
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const UPLOAD_ROOT = "/tmp/kody-browser-uploads";
const NOVNC_ROOT = "/app/node_modules/@novnc/novnc";
const DIRECT_COOKIE = "kody_browser_direct";
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const ACTIONS_PER_MINUTE = 120;
const STREAM_INPUTS_PER_MINUTE = 6_000;
const STREAM_HEARTBEAT_MS = 25_000;
const SESSION_ID = process.env.KODY_BROWSER_SESSION_ID ?? "";
const REPOSITORY = process.env.KODY_BROWSER_REPOSITORY ?? "";
const ACTOR_ID = process.env.KODY_BROWSER_ACTOR_ID ?? "";
const MACHINE_ID = process.env.FLY_MACHINE_ID ?? "";
const VERIFY_KEY = decodeVerifyKey(process.env.KODY_BROWSER_VERIFY_KEY ?? "");
const INITIAL_URL =
  process.env.KODY_BROWSER_INITIAL_URL ?? "https://example.com";

const consoleEntries: Array<{ type: string; text: string }> = [];
const failedRequests: Array<{ url: string; error: string }> = [];
let activePage: Page | null = null;
let activeContext: BrowserContext | null = null;
let activeCdp: CDPSession | null = null;
let pageScaleFactor = 1;
let browserReady = false;
let pageLoading = true;
let pageRevision = 0;
let screencastRunning = false;
let frameSequence = 0;
let latestFrame: Uint8Array | null = null;
const streamClients = new Set<WebSocket>();
const streamFrameBuffers = new Map<
  WebSocket,
  ReturnType<typeof createLatestFrameBuffer<Uint8Array>>
>();
let actionWindowStartedAt = Date.now();
let actionCount = 0;
let streamInputWindowStartedAt = Date.now();
let streamInputCount = 0;
const DIRECT_PAGE_VIEWPORT = { width: 1392, height: 760 } as const;
let embeddedViewport = { width: 1280, height: 720 };
let directClientCount = 0;

function normalizedViewport(rawWidth: number, rawHeight: number) {
  return {
    width: Math.max(320, Math.min(1920, Math.round(rawWidth / 2) * 2)),
    height: Math.max(480, Math.min(1800, Math.round(rawHeight / 2) * 2)),
  };
}

async function resizePage(rawWidth: number, rawHeight: number) {
  const { width, height } = normalizedViewport(rawWidth, rawHeight);
  await requirePage().setViewportSize({ width, height });
  return { width, height };
}

function acceptAction(): boolean {
  const now = Date.now();
  if (now - actionWindowStartedAt >= 60_000) {
    actionWindowStartedAt = now;
    actionCount = 0;
  }
  actionCount += 1;
  return actionCount <= ACTIONS_PER_MINUTE;
}

function acceptStreamInput(): boolean {
  const now = Date.now();
  if (now - streamInputWindowStartedAt >= 60_000) {
    streamInputWindowStartedAt = now;
    streamInputCount = 0;
  }
  streamInputCount += 1;
  return streamInputCount <= STREAM_INPUTS_PER_MINUTE;
}

function decodeVerifyKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function redact(value: string): string {
  return value
    .replace(
      /(authorization|cookie|token|password|secret)=?[^\s&]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 2_000);
}

function ticketFromRequest(req: http.IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  try {
    const queryTicket = new URL(
      req.url ?? "/",
      "http://browser.local",
    ).searchParams.get("ticket");
    if (queryTicket) return queryTicket;
    const cookie = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${DIRECT_COOKIE}=`));
    return cookie
      ? decodeURIComponent(cookie.slice(DIRECT_COOKIE.length + 1))
      : null;
  } catch {
    return null;
  }
}

function directLoginHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kody direct browser login</title><style>html,body{width:100%;height:100%;margin:0;background:#111}#screen{width:100%;height:100%}#status{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#111;color:#ddd;font:14px system-ui;z-index:1}#status[hidden]{display:none}</style></head>
<body><div id="screen"></div><div id="status">Connecting browser…</div><script type="module" src="/direct/client.js"></script></body></html>`;
}

function directClientJavaScript(): string {
  return `
import RFB from "/direct/core/rfb.js";
history.replaceState(null, "", "/direct");
const screen = document.getElementById("screen");
const status = document.getElementById("status");
let reconnectTimer;
let activeRfb;
function connect() {
  window.clearTimeout(reconnectTimer);
  if (activeRfb) return;
  screen.replaceChildren();
  status.hidden = false;
  status.textContent = "Reconnecting browser…";
  const rfb = new RFB(screen, "wss://" + location.host + "/direct-stream");
  activeRfb = rfb;
  rfb.scaleViewport = true; rfb.resizeSession = false; rfb.showDotCursor = true;
  rfb.addEventListener("connect", () => {
    if (activeRfb === rfb) status.hidden = true;
  });
  rfb.addEventListener("disconnect", () => {
    if (activeRfb !== rfb) return;
    activeRfb = undefined;
    status.hidden = false;
    status.textContent = "Reconnecting browser…";
    reconnectTimer = window.setTimeout(connect, 1_000);
  });
}
connect();
`;
}

function directContentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function serveDirectAsset(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  if (!authorizeHttpRequest(req, res)) return;
  if (pathname === "/direct" || pathname === "/direct/") {
    const html = directLoginHtml();
    const queryTicket = new URL(
      req.url ?? "/",
      "http://browser.local",
    ).searchParams.get("ticket");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'unsafe-inline'",
      ...(queryTicket
        ? {
            "Set-Cookie": `${DIRECT_COOKIE}=${encodeURIComponent(queryTicket)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
          }
        : {}),
    });
    res.end(html);
    return;
  }
  if (pathname === "/direct/client.js") {
    const client = directClientJavaScript();
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": Buffer.byteLength(client),
      "Cache-Control": "no-store",
    });
    res.end(client);
    return;
  }
  const relative = pathname.slice("/direct/".length);
  if (
    !relative ||
    !/^[a-zA-Z0-9_./-]+$/.test(relative) ||
    relative.includes("..")
  ) {
    json(res, 404, { error: "not_found" });
    return;
  }
  const filePath = path.join(NOVNC_ROOT, relative);
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile()) {
    json(res, 404, { error: "not_found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": directContentType(filePath),
    "Content-Length": details.size,
    "Cache-Control": "private, max-age=300",
  });
  createReadStream(filePath).pipe(res);
}

function requestAuthorization(
  req: http.IncomingMessage,
):
  | { kind: "authorized" }
  | { kind: "replay"; machineId: string }
  | { kind: "denied" } {
  if (
    VERIFY_KEY.length !== 32 ||
    !REPOSITORY ||
    !ACTOR_ID ||
    !SESSION_ID ||
    !MACHINE_ID
  ) {
    return { kind: "denied" };
  }
  const ticket = ticketFromRequest(req);
  if (!ticket) return { kind: "denied" };
  const identity = readBrowserTicket(ticket, VERIFY_KEY);
  if (
    !identity ||
    identity.repository !== REPOSITORY ||
    identity.actorId !== ACTOR_ID ||
    identity.sessionId !== SESSION_ID
  ) {
    return { kind: "denied" };
  }
  return identity.machineId === MACHINE_ID
    ? { kind: "authorized" }
    : { kind: "replay", machineId: identity.machineId };
}

function authorizeHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const authorization = requestAuthorization(req);
  if (authorization.kind === "authorized") return true;
  if (authorization.kind === "replay") {
    res.writeHead(307, {
      "fly-replay": `instance=${authorization.machineId}`,
      "Cache-Control": "no-store",
    });
    res.end();
    return false;
  }
  json(res, 401, { error: "unauthorized" });
  return false;
}

function json(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizedAllowedOrigins(action: Record<string, unknown>): string[] {
  if (!action.capabilitySlug) return [];
  if (!Array.isArray(action.allowedOrigins) || !action.allowedOrigins.length) {
    throw new Error("browser_capability_origins_missing");
  }
  return action.allowedOrigins.map((value) => {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:") {
      throw new Error("browser_capability_origin_invalid");
    }
    return parsed.origin;
  });
}

function assertCapabilityOrigin(
  action: Record<string, unknown>,
  currentUrl: string,
): void {
  const allowedOrigins = normalizedAllowedOrigins(action);
  if (!allowedOrigins.length) return;
  const inspectedUrl =
    action.type === "navigate" ? String(action.url ?? "") : currentUrl;
  let origin: string;
  try {
    origin = new URL(inspectedUrl).origin;
  } catch {
    throw new Error("browser_capability_origin_invalid");
  }
  if (!allowedOrigins.includes(origin)) {
    throw new Error("browser_capability_origin_blocked");
  }
}

function uploadDirectory(uploadId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uploadId,
    )
  ) {
    throw new Error("browser_upload_id_invalid");
  }
  return path.join(UPLOAD_ROOT, uploadId);
}

async function receiveUpload(
  req: http.IncomingMessage,
  requestUrl: URL,
): Promise<void> {
  const uploadId = requestUrl.searchParams.get("uploadId") ?? "";
  const index = Number.parseInt(requestUrl.searchParams.get("index") ?? "", 10);
  const name = requestUrl.searchParams.get("name") ?? "";
  const mimeType = requestUrl.searchParams.get("mimeType") ?? "";
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= MAX_UPLOAD_FILES ||
    !name ||
    name !== path.basename(name) ||
    !ALLOWED_UPLOAD_TYPES.has(mimeType)
  ) {
    throw new Error("browser_upload_invalid");
  }
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (declaredLength <= 0 || declaredLength > MAX_UPLOAD_FILE_BYTES) {
    throw new Error("browser_upload_size_invalid");
  }
  const directory = uploadDirectory(uploadId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(
    directory,
    `${String(index).padStart(2, "0")}-${name}`,
  );
  let received = 0;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_UPLOAD_FILE_BYTES) req.destroy();
  });
  await pipeline(
    req,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  if (!received || received > MAX_UPLOAD_FILE_BYTES) {
    await rm(destination, { force: true });
    throw new Error("browser_upload_size_invalid");
  }
}

async function stagedUploadPaths(uploadId: string): Promise<string[]> {
  const directory = uploadDirectory(uploadId);
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) throw new Error("browser_upload_not_found");
  const entries = (await readdir(directory)).sort();
  if (!entries.length || entries.length > MAX_UPLOAD_FILES) {
    throw new Error("browser_upload_file_count_invalid");
  }
  return entries.map((entry) => path.join(directory, entry));
}

const CHROMIUM_READY_ATTEMPTS = 240;

async function waitForChromium(): Promise<void> {
  for (let attempt = 0; attempt < CHROMIUM_READY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/version");
      if (response.ok) return;
    } catch {
      // Chromium is still starting.
    }
    await delay(250);
  }
  throw new Error("chromium_start_timeout");
}

async function waitForVnc(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port: 5900 });
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("vnc_connect_timeout"));
        }, 1_000);
        socket.once("data", (data) => {
          clearTimeout(timeout);
          socket.destroy();
          if (data.toString("ascii", 0, 4) === "RFB ") resolve();
          else reject(new Error("vnc_handshake_invalid"));
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      return;
    } catch {}
    await delay(250);
  }
  throw new Error("vnc_start_timeout");
}

function attachPageEvents(page: Page): void {
  page.on("console", (message) => {
    consoleEntries.push({ type: message.type(), text: redact(message.text()) });
    if (consoleEntries.length > 100) consoleEntries.shift();
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url().slice(0, 2_000),
      error: redact(request.failure()?.errorText ?? "request_failed"),
    });
    if (failedRequests.length > 100) failedRequests.shift();
  });
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      pageLoading = true;
      void broadcastPageState();
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      pageRevision += 1;
      void broadcastPageState();
    }
  });
  page.on("load", () => {
    pageLoading = false;
    void broadcastPageState();
  });
  page.on("popup", async (popup) => {
    try {
      await popup.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    } catch {
      // The popup URL can still be available when its load does not settle.
    }
    const popupUrl = popup.url();
    await popup.close().catch(() => undefined);
    if (!popupUrl || popupUrl === "about:blank") return;
    try {
      await page.goto(await validatePublicBrowserUrl(popupUrl), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch {
      // A blocked or failed popup navigation leaves the current page intact.
    }
  });
}

async function currentPageState() {
  const page = requirePage();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const history = activeCdp
    ? await activeCdp
        .send("Page.getNavigationHistory")
        .catch(() => ({ currentIndex: 0, entries: [] }))
    : { currentIndex: 0, entries: [] };
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    loading: pageLoading,
    canGoBack: history.currentIndex > 0,
    canGoForward: history.currentIndex < history.entries.length - 1,
    revision: pageRevision,
    viewport,
  };
}

function sendStreamMessage(
  websocket: WebSocket,
  message: Record<string, unknown>,
): void {
  if (websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify(message));
  }
}

async function broadcastPageState(): Promise<void> {
  if (!activePage || !streamClients.size) return;
  const page = await currentPageState();
  for (const websocket of streamClients) {
    sendStreamMessage(websocket, { type: "state", page });
  }
}

async function startPageScreencast(): Promise<void> {
  if (!activeCdp || screencastRunning || !streamClients.size) return;
  screencastRunning = true;
  try {
    await activeCdp.send("Page.startScreencast", {
      format: "jpeg",
      // Browser content favors responsiveness over screenshot-level fidelity.
      // The viewport still controls the exact rendered resolution.
      quality: 72,
      maxWidth: 1920,
      maxHeight: 1800,
      everyNthFrame: 1,
    });
  } catch (error) {
    screencastRunning = false;
    throw error;
  }
}

async function stopPageScreencast(): Promise<void> {
  if (!activeCdp || !screencastRunning || streamClients.size) return;
  screencastRunning = false;
  await activeCdp.send("Page.stopScreencast").catch(() => undefined);
}

async function attachCdp(page: Page): Promise<void> {
  activeCdp = await page.context().newCDPSession(page);
  await activeCdp.send("Page.enable");
  activeCdp.on(
    "Page.screencastFrame",
    (event: {
      data: string;
      metadata: Record<string, unknown>;
      sessionId: number;
    }) => {
      const frameId = ++frameSequence;
      const frame = encodeBrowserFrame(
        frameId,
        Buffer.from(event.data, "base64"),
      );
      latestFrame = frame;
      for (const websocket of streamClients) {
        const next = streamFrameBuffers.get(websocket)?.push(frame);
        if (next && websocket.readyState === WebSocket.OPEN)
          websocket.send(next);
      }
      void activeCdp
        ?.send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch(() => undefined);
    },
  );
  if (streamClients.size) await startPageScreencast();
}

async function installNetworkGuard(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    const protocol = new URL(requestUrl).protocol;
    if (["about:", "blob:", "data:"].includes(protocol)) {
      await route.continue();
      return;
    }
    try {
      await validatePublicBrowserUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function connectBrowser(): Promise<void> {
  await waitForChromium();
  await waitForVnc();
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  activeContext = browser.contexts()[0] ?? (await browser.newContext());
  await activeContext.addInitScript({
    content: "globalThis.__name = (target) => target;",
  });
  await installNetworkGuard(activeContext);
  activePage = activeContext.pages()[0] ?? (await activeContext.newPage());
  await resizePage(1280, 720);
  attachPageEvents(activePage);
  await attachCdp(activePage);
  try {
    await activePage.goto(await validatePublicBrowserUrl(INITIAL_URL), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } catch {
    // The session stays usable at about:blank when the initial URL fails.
  } finally {
    pageLoading = false;
    browserReady = true;
    await broadcastPageState();
  }
}

function requirePage(): Page {
  if (!activePage) throw new Error("browser_not_ready");
  return activePage;
}

async function settleNavigation(
  navigate: () => Promise<unknown>,
): Promise<void> {
  await navigate();
}

async function executeAction(action: Record<string, unknown>) {
  const page = requirePage();
  assertCapabilityOrigin(action, page.url());
  switch (action.type) {
    case "navigate": {
      const url = await validatePublicBrowserUrl(String(action.url ?? ""));
      await settleNavigation(() =>
        page.goto(url, { waitUntil: "commit", timeout: 30_000 }),
      );
      break;
    }
    case "back":
      await settleNavigation(() =>
        page.goBack({ waitUntil: "commit", timeout: 30_000 }),
      );
      break;
    case "forward":
      await settleNavigation(() =>
        page.goForward({ waitUntil: "commit", timeout: 30_000 }),
      );
      break;
    case "reload":
      await settleNavigation(() =>
        page.reload({ waitUntil: "commit", timeout: 30_000 }),
      );
      break;
    case "viewport": {
      embeddedViewport = normalizedViewport(
        Number(action.width),
        Number(action.height),
      );
      if (directClientCount === 0) {
        await resizePage(embeddedViewport.width, embeddedViewport.height);
      }
      break;
    }
    case "pointer": {
      const x = Number(action.x);
      const y = Number(action.y);
      if (action.action === "move") await page.mouse.move(x, y);
      if (action.action === "down")
        await page.mouse.down({
          button: String(action.button ?? "left") as "left",
        });
      if (action.action === "up")
        await page.mouse.up({
          button: String(action.button ?? "left") as "left",
        });
      if (action.action === "wheel")
        await page.mouse.wheel(
          Number(action.deltaX ?? 0),
          Number(action.deltaY ?? 0),
        );
      break;
    }
    case "keyboard":
      if (action.action === "insertText")
        await page.keyboard.insertText(String(action.key ?? ""));
      else if (action.action === "down")
        await page.keyboard.down(String(action.key ?? ""));
      else await page.keyboard.up(String(action.key ?? ""));
      break;
    case "zoom": {
      const delta = Number(action.delta);
      pageScaleFactor =
        delta === 0
          ? 1
          : Math.max(0.5, Math.min(2, pageScaleFactor + delta * 0.1));
      await activeCdp?.send("Emulation.setPageScaleFactor", {
        pageScaleFactor,
      });
      break;
    }
    case "click":
      await page
        .locator(String(action.selector ?? ""))
        .click({ timeout: 10_000 });
      break;
    case "fill":
      await page
        .locator(String(action.selector ?? ""))
        .fill(String(action.value ?? ""), { timeout: 10_000 });
      break;
    case "upload": {
      const directory = uploadDirectory(String(action.uploadId ?? ""));
      try {
        await page
          .locator(String(action.selector ?? ""))
          .setInputFiles(
            await stagedUploadPaths(String(action.uploadId ?? "")),
            {
              timeout: 10_000,
            },
          );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      break;
    }
    case "scroll":
      if (action.selector)
        await page
          .locator(String(action.selector))
          .scrollIntoViewIfNeeded({ timeout: 10_000 });
      else await page.mouse.wheel(0, Number(action.deltaY ?? 600));
      break;
    case "wait":
      await page.waitForTimeout(
        Math.min(10_000, Math.max(0, Number(action.ms ?? 500))),
      );
      break;
    case "screenshot": {
      const screenshot = await page.screenshot({ type: "jpeg", quality: 80 });
      return {
        ok: true,
        url: page.url(),
        data: screenshot.toString("base64"),
        page: await currentPageState(),
      };
    }
    case "pick": {
      await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyCancelPick?: () => void;
          __kodyPickedElement?: Record<string, unknown>;
        };
        root.__kodyCancelPick?.();
        root.__kodyPickedElement = undefined;
        let highlighted: HTMLElement | null = null;
        let previousOutline = "";
        const previousCursor = document.documentElement.style.cursor;
        const selectorFor = (element: Element): string => {
          if (element.id) return `#${CSS.escape(element.id)}`;
          const parts: string[] = [];
          let current: Element | null = element;
          while (current && current !== document.documentElement) {
            const siblings = current.parentElement
              ? Array.from(current.parentElement.children).filter(
                  (node) => node.tagName === current!.tagName,
                )
              : [];
            parts.unshift(
              `${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`,
            );
            const candidate = parts.join(" > ");
            if (document.querySelectorAll(candidate).length === 1) {
              return candidate;
            }
            current = current.parentElement;
          }
          return parts.join(" > ");
        };
        const clearHighlight = () => {
          if (highlighted) highlighted.style.outline = previousOutline;
          highlighted = null;
          previousOutline = "";
        };
        const cleanup = () => {
          clearHighlight();
          document.documentElement.style.cursor = previousCursor;
          document.removeEventListener("pointerover", highlight, true);
          document.removeEventListener("click", handler, true);
          root.__kodyCancelPick = undefined;
        };
        const highlight = (event: PointerEvent) => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || target === highlighted)
            return;
          clearHighlight();
          highlighted = target;
          previousOutline = target.style.outline;
          target.style.outline = "2px solid #38bdf8";
        };
        const handler = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          cleanup();
          const target = event.target as HTMLElement;
          const rect = target.getBoundingClientRect();
          const attributes = Object.fromEntries(
            Array.from(target.attributes)
              .slice(0, 20)
              .map((a) => [a.name, a.value.slice(0, 500)]),
          );
          const styles = getComputedStyle(target);
          root.__kodyPickedElement = {
            selector: selectorFor(target),
            tagName: target.tagName.toLowerCase(),
            id: target.id || null,
            classes: Array.from(target.classList).slice(0, 20),
            text: (target.innerText || "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 500),
            attributes,
            computedStyles: {
              color: styles.color,
              backgroundColor: styles.backgroundColor,
              fontSize: styles.fontSize,
              fontWeight: styles.fontWeight,
              padding: styles.padding,
              margin: styles.margin,
              gap: styles.gap,
              border: styles.border,
              borderRadius: styles.borderRadius,
              boxShadow: styles.boxShadow,
              width: styles.width,
              maxWidth: styles.maxWidth,
              display: styles.display,
            },
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            url: location.href,
          };
        };
        root.__kodyCancelPick = cleanup;
        document.documentElement.style.cursor = "crosshair";
        document.addEventListener("pointerover", highlight, true);
        document.addEventListener("click", handler, true);
      });
      return {
        ok: true,
        url: page.url(),
        data: { armed: true },
        page: await currentPageState(),
      };
    }
    case "pickResult": {
      const element = await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyPickedElement?: Record<string, unknown>;
        };
        const picked = root.__kodyPickedElement;
        root.__kodyPickedElement = undefined;
        return picked;
      });
      return {
        ok: true,
        url: page.url(),
        data: { element },
        page: await currentPageState(),
      };
    }
    case "cancelPick":
      await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyCancelPick?: () => void;
          __kodyPickedElement?: Record<string, unknown>;
        };
        root.__kodyCancelPick?.();
        root.__kodyPickedElement = undefined;
      });
      break;
    case "perf": {
      const data = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined;
        const resources = performance.getEntriesByType(
          "resource",
        ) as PerformanceResourceTiming[];
        return {
          url: location.href,
          ttfbMs: nav ? nav.responseStart : 0,
          domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : 0,
          loadMs: nav ? nav.loadEventEnd : 0,
          fcpMs:
            performance.getEntriesByName("first-contentful-paint")[0]
              ?.startTime ?? 0,
          lcpMs: 0,
          resourceCount: resources.length,
          totalBytes: resources.reduce(
            (sum, item) => sum + (item.transferSize || 0),
            0,
          ),
          slowest: resources
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)
            .map((item) => ({
              url: item.name,
              type: item.initiatorType,
              durationMs: item.duration,
              bytes: item.transferSize || 0,
            })),
        };
      });
      return {
        ok: true,
        url: page.url(),
        data,
        page: await currentPageState(),
      };
    }
    case "edit": {
      const command = action.command as {
        selector: string;
        mutation: Record<string, unknown>;
      };
      await page.evaluate(({ selector, mutation }) => {
        const root = window as typeof window & {
          __kodyEdits?: Array<{ selector: string; html: string }>;
        };
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) throw new Error("selector_not_found");
        root.__kodyEdits ??= [];
        root.__kodyEdits.push({ selector, html: target.outerHTML });
        if (mutation.op === "style")
          Object.assign(
            target.style,
            mutation.styles as Record<string, string>,
          );
        if (mutation.op === "text")
          target.textContent = String(mutation.value ?? "");
        if (mutation.op === "attribute")
          target.setAttribute(
            String(mutation.name),
            String(mutation.value ?? ""),
          );
        if (mutation.op === "hide") target.style.display = "none";
        if (mutation.op === "remove") target.remove();
        if (mutation.op === "duplicate") target.after(target.cloneNode(true));
      }, command);
      break;
    }
    case "undoEdit":
      await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyEdits?: Array<{ selector: string; html: string }>;
        };
        const edit = root.__kodyEdits?.pop();
        if (!edit) return;
        const target = document.querySelector(edit.selector);
        if (!target) return;
        const template = document.createElement("template");
        template.innerHTML = edit.html;
        target.replaceWith(template.content.firstElementChild!);
      });
      break;
    case "resetEdits":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      break;
    case "recordStart":
      await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyRecording?: Array<Record<string, string>>;
          __kodyRecordCleanup?: () => void;
        };
        root.__kodyRecordCleanup?.();
        root.__kodyRecording = [];
        const selectorFor = (element: Element) =>
          element.id
            ? `#${CSS.escape(element.id)}`
            : element.tagName.toLowerCase();
        const click = (event: Event) => {
          const target = event.target as HTMLElement;
          root.__kodyRecording?.push({
            type: "click",
            selector: selectorFor(target),
            text: (target.innerText || "").trim().slice(0, 100),
          });
        };
        const change = (event: Event) => {
          const target = event.target as HTMLInputElement;
          if (target.matches("input,textarea"))
            root.__kodyRecording?.push({
              type: "fill",
              selector: selectorFor(target),
              value:
                target.type === "password" ? "" : target.value.slice(0, 2_000),
            });
        };
        document.addEventListener("click", click, true);
        document.addEventListener("change", change, true);
        root.__kodyRecordCleanup = () => {
          document.removeEventListener("click", click, true);
          document.removeEventListener("change", change, true);
        };
      });
      break;
    case "recordStop": {
      const data = await page.evaluate(() => {
        const root = window as typeof window & {
          __kodyRecording?: Array<Record<string, string>>;
          __kodyRecordCleanup?: () => void;
        };
        root.__kodyRecordCleanup?.();
        return { steps: root.__kodyRecording ?? [], url: location.href };
      });
      return {
        ok: true,
        url: page.url(),
        data,
        page: await currentPageState(),
      };
    }
    case "snapshot": {
      await page
        .waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .catch(() => undefined);
      const snapshot = await page.evaluate((maxBytes) => {
        const selectorFor = (element: Element): string => {
          if (element.id) return `#${CSS.escape(element.id)}`;
          const testId = element.getAttribute("data-testid");
          if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
          const parts: string[] = [];
          let current: Element | null = element;
          while (current && current !== document.documentElement) {
            const siblings = current.parentElement
              ? Array.from(current.parentElement.children).filter(
                  (node) => node.tagName === current!.tagName,
                )
              : [];
            parts.unshift(
              `${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`,
            );
            const candidate = parts.join(" > ");
            if (document.querySelectorAll(candidate).length === 1) {
              return candidate;
            }
            current = current.parentElement;
          }
          return parts.join(" > ");
        };
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            "a,button,input,textarea,select,[role],[contenteditable=true]",
          ),
        )
          .slice(0, 500)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            return {
              ref: `e${index + 1}`,
              selector: selectorFor(element),
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role"),
              name:
                element.getAttribute("aria-label") ??
                element.getAttribute("title") ??
                element.innerText?.trim().slice(0, 200) ??
                "",
              disabled: element.matches(":disabled"),
              box: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            };
          });
        return {
          text: (document.body?.innerText ?? "").slice(0, maxBytes),
          elements,
        };
      }, MAX_TEXT_BYTES);
      return {
        ok: true,
        url: page.url(),
        title: await page.title(),
        data: { snapshot, console: consoleEntries, failedRequests },
        page: await currentPageState(),
      };
    }
    default:
      throw new Error("unsupported_browser_action");
  }
  if (action.capabilitySlug) {
    return await executeAction({ type: "snapshot" });
  }
  return {
    ok: true,
    url: page.url(),
    title: await page.title(),
    page: await currentPageState(),
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://browser.local");
  if (req.method === "GET" && requestUrl.pathname === "/health") {
    json(res, browserReady ? 200 : 503, { ok: browserReady });
    return;
  }
  if (
    req.method === "GET" &&
    (requestUrl.pathname === "/direct" ||
      requestUrl.pathname.startsWith("/direct/"))
  ) {
    await serveDirectAsset(req, res, requestUrl.pathname).catch(() =>
      json(res, 500, { error: "direct_browser_unavailable" }),
    );
    return;
  }
  if (req.method === "OPTIONS" && requestUrl.pathname === "/upload") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "300",
    });
    res.end();
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/upload") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!authorizeHttpRequest(req, res)) return;
    try {
      await receiveUpload(req, requestUrl);
      json(res, 201, { ok: true, upload: randomUUID() });
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "browser_upload_failed";
      json(res, code.endsWith("_invalid") ? 400 : 500, { error: code });
    }
    return;
  }
  if (req.method !== "POST" || requestUrl.pathname !== "/api/browser/action") {
    json(res, 404, { error: "not_found" });
    return;
  }
  if (!authorizeHttpRequest(req, res)) return;
  if (!acceptAction()) {
    json(res, 429, { error: "rate_limited" });
    return;
  }
  try {
    const action = (await readJson(req)) as Record<string, unknown>;
    json(res, 200, await executeAction(action));
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "browser_action_failed";
    json(res, code === "browser_url_blocked" ? 400 : 500, { error: code });
  }
});

const websocketServer = new WebSocketServer({
  noServer: true,
});
const directWebsocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://browser.local");
  const authorization = requestAuthorization(req);
  if (
    (url.pathname !== "/stream" && url.pathname !== "/direct-stream") ||
    authorization.kind === "denied"
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (authorization.kind === "replay") {
    socket.write(
      `HTTP/1.1 307 Temporary Redirect\r\nfly-replay: instance=${authorization.machineId}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
    return;
  }
  const target =
    url.pathname === "/direct-stream" ? directWebsocketServer : websocketServer;
  target.handleUpgrade(req, socket, head, (websocket) => {
    target.emit("connection", websocket, req);
  });
});

directWebsocketServer.on("connection", (websocket) => {
  directClientCount += 1;
  if (directClientCount === 1) {
    void resizePage(DIRECT_PAGE_VIEWPORT.width, DIRECT_PAGE_VIEWPORT.height);
  }
  const vnc = net.connect({ host: "127.0.0.1", port: 5900 });
  vnc.on("data", (data) => {
    if (websocket.readyState === WebSocket.OPEN)
      websocket.send(data, { binary: true });
  });
  vnc.on("error", () => websocket.close(1011, "direct_browser_unavailable"));
  vnc.on("close", () => websocket.close());
  websocket.on("message", (data) => vnc.write(data));
  let released = false;
  const releaseDirectClient = () => {
    vnc.destroy();
    if (released) return;
    released = true;
    directClientCount = Math.max(0, directClientCount - 1);
    if (directClientCount === 0) {
      void resizePage(embeddedViewport.width, embeddedViewport.height);
    }
  };
  websocket.on("close", releaseDirectClient);
  websocket.on("error", releaseDirectClient);
});

websocketServer.on("connection", (websocket) => {
  streamClients.add(websocket);
  const frameBuffer = createLatestFrameBuffer<Uint8Array>();
  streamFrameBuffers.set(websocket, frameBuffer);
  // A still page may produce no screencast frames. Keep the authenticated
  // socket alive through proxy idle windows without adding application data.
  const heartbeat = setInterval(() => {
    if (websocket.readyState === WebSocket.OPEN) websocket.ping();
  }, STREAM_HEARTBEAT_MS);
  heartbeat.unref?.();
  sendStreamMessage(websocket, { type: "ready" });
  if (latestFrame) {
    const first = frameBuffer.push(latestFrame);
    if (first) websocket.send(first);
  }
  void broadcastPageState();
  void startPageScreencast().catch(() =>
    websocket.close(1011, "screencast_unavailable"),
  );

  websocket.on("message", async (data) => {
    try {
      const message = parseBrowserStreamMessage(data.toString());
      if (message.type === "requestState") {
        sendStreamMessage(websocket, {
          type: "state",
          page: await currentPageState(),
        });
        return;
      }
      if (message.type === "frameAck") {
        const next = frameBuffer.acknowledge();
        if (next && websocket.readyState === WebSocket.OPEN)
          websocket.send(next);
        return;
      }
      if (!acceptStreamInput()) {
        sendStreamMessage(websocket, {
          type: "error",
          error: "rate_limited",
        });
        return;
      }
      const action = browserActionForStreamMessage(message);
      if (action) {
        await executeAction(action);
        if (action.type === "viewport") await broadcastPageState();
      }
    } catch (error) {
      sendStreamMessage(websocket, {
        type: "error",
        error: error instanceof Error ? error.message : "browser_stream_failed",
      });
    }
  });
  websocket.on("close", () => {
    clearInterval(heartbeat);
    streamClients.delete(websocket);
    streamFrameBuffers.delete(websocket);
    void stopPageScreencast();
  });
  websocket.on("error", () => {
    streamClients.delete(websocket);
    streamFrameBuffers.delete(websocket);
    void stopPageScreencast();
  });
});

async function bootstrapBrowser(): Promise<void> {
  while (!browserReady) {
    try {
      await connectBrowser();
    } catch (error) {
      browserReady = false;
      activePage = null;
      activeCdp = null;
      console.error("browser bootstrap failed; retrying", error);
      await delay(1_000);
    }
  }
}

server.listen(PORT, "0.0.0.0", () => {
  void bootstrapBrowser();
});
