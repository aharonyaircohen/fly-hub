/**
 * Main-world collector for preview frames.
 *
 * Content scripts run in an isolated world by default, so content.js cannot
 * see the page's own console calls or wrap fetch/XMLHttpRequest. This file is
 * loaded by the manifest with world: "MAIN", which gives it page-world access
 * without injecting an inline <script> that page CSP can reject.
 */
(() => {
  "use strict";

  const COLLECTOR_SOURCE = "kody-picker:collector";

  if (window.top === window.self) return;
  if (window.__kodyPreviewCollectorLoaded) return;

  try {
    Object.defineProperty(window, "__kodyPreviewCollectorLoaded", {
      value: true,
      configurable: false,
      enumerable: false,
    });
  } catch {
    window.__kodyPreviewCollectorLoaded = true;
  }

  const post = (kind, entry) => {
    try {
      window.postMessage({ source: COLLECTOR_SOURCE, kind, entry }, "*");
    } catch {
      /* ignore */
    }
  };

  const isDirectPreviewFrame = () => {
    try {
      return window.parent === window.top;
    } catch {
      return true;
    }
  };

  let postUrlTimer = null;
  const postUrl = () => {
    if (!isDirectPreviewFrame()) return;
    if (postUrlTimer) clearTimeout(postUrlTimer);
    postUrlTimer = setTimeout(() => {
      postUrlTimer = null;
      post("page-url", {
        url: window.location.href,
        title: document.title || "",
        ts: Date.now(),
      });
    }, 80);
  };

  if (isDirectPreviewFrame()) {
    ["pushState", "replaceState"].forEach((name) => {
      try {
        const orig = history[name];
        if (typeof orig !== "function") return;
        history[name] = function () {
          const ret = orig.apply(this, arguments);
          postUrl();
          return ret;
        };
      } catch {
        /* ignore */
      }
    });
    window.addEventListener("popstate", postUrl);
    window.addEventListener("hashchange", postUrl);
    window.addEventListener("pageshow", postUrl);
    if (document.readyState === "complete") {
      postUrl();
    } else {
      window.addEventListener("load", postUrl, { once: true });
    }
  }

  ["error", "warn"].forEach((level) => {
    const orig = console[level];
    console[level] = function () {
      try {
        post("log", {
          level,
          message: Array.prototype.map
            .call(arguments, (arg) =>
              arg instanceof Error ? arg.message : String(arg),
            )
            .join(" ")
            .slice(0, 1000),
          ts: Date.now(),
        });
      } catch {
        /* ignore */
      }
      return orig.apply(this, arguments);
    };
  });

  window.addEventListener("error", (event) => {
    post("log", {
      level: "error",
      message:
        (event.message || "Error") +
        (event.filename
          ? ` (${event.filename}:${event.lineno}:${event.colno})`
          : ""),
      ts: Date.now(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    post("log", {
      level: "error",
      message:
        "Unhandled rejection: " +
        (reason && reason.message ? reason.message : String(reason)),
      ts: Date.now(),
    });
  });

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      const args = arguments;
      const first = args[0];
      const url = first && first.url ? first.url : String(first);
      const method =
        (args[1] && args[1].method) || (first && first.method) || "GET";
      return origFetch.apply(this, args).then(
        (res) => {
          if (!res.ok) {
            post("net", {
              url,
              method,
              status: res.status,
              ts: Date.now(),
            });
          }
          return res;
        },
        (err) => {
          post("net", {
            url,
            method,
            status: 0,
            error: String(err),
            ts: Date.now(),
          });
          throw err;
        },
      );
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const open = OriginalXHR.prototype.open;
    const send = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function (method, url) {
      this.__kody = { method, url };
      return open.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function () {
      const req = this;
      this.addEventListener("loadend", () => {
        if (req.__kody && (req.status === 0 || req.status >= 400)) {
          post("net", {
            url: req.__kody.url,
            method: req.__kody.method,
            status: req.status,
            ts: Date.now(),
          });
        }
      });
      return send.apply(this, arguments);
    };
  }
})();
