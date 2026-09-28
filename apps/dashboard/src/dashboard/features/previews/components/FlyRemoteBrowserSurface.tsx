/**
 * @fileType component
 * @domain preview
 * @pattern fly-remote-browser-surface
 * @ai-summary Page-only Chromium screencast with direct pointer, wheel, keyboard,
 *   viewport, and authoritative page-state events over one authenticated socket.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";

import type { BrowserPageState } from "@dashboard/lib/previews/browser-controller-state";
import {
  browserPointerCoordinates,
  keyboardStreamMessages,
  parseBrowserBinaryFrame,
  parseBrowserStreamServerMessage,
  type BrowserViewport,
} from "@dashboard/lib/previews/browser-stream-client";

interface FlyRemoteBrowserSurfaceProps {
  streamUrl: string;
  title: string;
  maxWidthPx?: number;
  onViewportResize?: (width: number, height: number) => void;
  onPageState?: (page: BrowserPageState) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionLost?: () => void;
  onReconnect?: () => void;
}

export function FlyRemoteBrowserSurface({
  streamUrl,
  title,
  maxWidthPx,
  onViewportResize,
  onPageState,
  onConnected,
  onDisconnected,
  onConnectionLost,
  onReconnect,
}: FlyRemoteBrowserSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<BrowserViewport>({ width: 1280, height: 720 });
  const callbacksRef = useRef({
    onPageState,
    onConnected,
    onDisconnected,
    onConnectionLost,
    onReconnect,
  });
  const [connected, setConnected] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  callbacksRef.current = {
    onPageState,
    onConnected,
    onDisconnected,
    onConnectionLost,
    onReconnect,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let websocket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempts = 0;
    let latestFrame: { frameId: number; data: Uint8Array } | null = null;
    let drawing = false;
    let pointerFrame: number | undefined;
    let pendingPointer: { x: number; y: number } | null = null;

    const send = (message: Record<string, unknown>): void => {
      if (websocket?.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(message));
      }
    };

    const drawLatestFrame = async (): Promise<void> => {
      if (drawing || disposed) return;
      drawing = true;
      try {
        while (latestFrame && !disposed) {
          const frame = latestFrame;
          latestFrame = null;
          let image: ImageBitmap;
          try {
            image = await createImageBitmap(
              new Blob([frame.data as BlobPart], { type: "image/jpeg" }),
            );
          } catch {
            continue;
          }
          const newerFrame = latestFrame as {
            frameId: number;
            data: Uint8Array;
          } | null;
          if (disposed || (newerFrame && newerFrame.frameId > frame.frameId)) {
            image.close();
            continue;
          }
          if (canvas.width !== image.width || canvas.height !== image.height) {
            canvas.width = image.width;
            canvas.height = image.height;
          }
          canvas.getContext("2d")?.drawImage(image, 0, 0);
          image.close();
          send({ type: "frameAck", frameId: frame.frameId });
        }
      } finally {
        drawing = false;
        if (latestFrame) void drawLatestFrame();
      }
    };

    const connect = (): void => {
      if (disposed) return;
      setConnected(false);
      websocket = new WebSocket(streamUrl);
      websocket.binaryType = "arraybuffer";
      websocket.addEventListener("message", (event) => {
        try {
          if (event.data instanceof ArrayBuffer) {
            const frame = parseBrowserBinaryFrame(event.data);
            latestFrame = { frameId: frame.frameId, data: frame.data };
            void drawLatestFrame();
            return;
          }
          if (typeof event.data !== "string") return;
          const message = parseBrowserStreamServerMessage(event.data);
          if (message.type === "ready") {
            reconnectAttempts = 0;
            setConnected(true);
            setDisconnected(false);
            callbacksRef.current.onConnected?.();
            send({ type: "requestState" });
          } else if (message.type === "state") {
            viewportRef.current = message.page.viewport;
            callbacksRef.current.onPageState?.(message.page);
          } else if (message.type === "frame") {
            // Compatibility with browser images deployed before binary frames.
            const binary = Uint8Array.from(atob(message.data), (character) =>
              character.charCodeAt(0),
            );
            latestFrame = { frameId: message.frameId, data: binary };
            void drawLatestFrame();
          }
        } catch {
          websocket?.close(1003, "invalid_stream_message");
        }
      });
      websocket.addEventListener("close", () => {
        if (disposed) return;
        setConnected(false);
        if (reconnectAttempts < 3) {
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(
            connect,
            Math.min(2_000, 300 * 2 ** reconnectAttempts),
          );
          return;
        }
        setDisconnected(true);
        callbacksRef.current.onDisconnected?.();
        callbacksRef.current.onConnectionLost?.();
      });
      websocket.addEventListener("error", () => websocket?.close());
    };

    const pointer = (
      event: PointerEvent,
      action: "move" | "down" | "up",
    ): void => {
      const point = browserPointerCoordinates(
        canvas.getBoundingClientRect(),
        viewportRef.current,
        event.clientX,
        event.clientY,
      );
      if (action === "move") {
        pendingPointer = point;
        if (pointerFrame === undefined) {
          pointerFrame = window.requestAnimationFrame(() => {
            pointerFrame = undefined;
            if (pendingPointer) {
              send({ type: "pointer", action: "move", ...pendingPointer });
              pendingPointer = null;
            }
          });
        }
        return;
      }
      if (action === "down") canvas.focus();
      send({
        type: "pointer",
        action,
        ...point,
        button:
          event.button === 1 ? "middle" : event.button === 2 ? "right" : "left",
      });
    };
    const onPointerMove = (event: PointerEvent) => pointer(event, "move");
    const onPointerDown = (event: PointerEvent) => pointer(event, "down");
    const onPointerUp = (event: PointerEvent) => pointer(event, "up");
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const point = browserPointerCoordinates(
        canvas.getBoundingClientRect(),
        viewportRef.current,
        event.clientX,
        event.clientY,
      );
      send({
        type: "pointer",
        action: "wheel",
        ...point,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };
    const onKey = (event: KeyboardEvent, phase: "down" | "up"): void => {
      event.preventDefault();
      for (const message of keyboardStreamMessages(event, phase)) send(message);
    };
    const onKeyDown = (event: KeyboardEvent) => onKey(event, "down");
    const onKeyUp = (event: KeyboardEvent) => onKey(event, "up");

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      if (pointerFrame !== undefined) window.cancelAnimationFrame(pointerFrame);
      websocket?.close();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
    };
  }, [streamUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onViewportResize) return;
    let timeout: number | undefined;
    let previous = "";
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.max(
        320,
        Math.min(1920, Math.round(entry.contentRect.width)),
      );
      const height = Math.max(
        480,
        Math.min(1800, Math.round(entry.contentRect.height)),
      );
      const key = `${width}x${height}`;
      if (key === previous) return;
      previous = key;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => onViewportResize(width, height), 200);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [onViewportResize]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-zinc-900"
    >
      {/* eslint-disable jsx-a11y/no-interactive-element-to-noninteractive-role -- the focusable canvas is the complete remote browser application surface */}
      <canvas
        data-remote-browser-surface
        ref={canvasRef}
        role="application"
        aria-label={title}
        tabIndex={0}
        style={maxWidthPx ? { maxWidth: `${maxWidthPx}px` } : undefined}
        className="max-h-full max-w-full touch-none bg-white outline-none"
      />
      {/* eslint-enable jsx-a11y/no-interactive-element-to-noninteractive-role */}
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center gap-3 text-center">
            {!disconnected && (
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            )}
            <p className="text-sm text-zinc-300">
              {disconnected ? "Browser disconnected" : "Starting browser…"}
            </p>
            {disconnected && (
              <Button
                type="button"
                variant="outline"
                onClick={callbacksRef.current.onReconnect}
              >
                Reconnect
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
