const DEFAULT_MODE = "vulnerable"; // "vulnerable" | "fixed"

let currentMode = DEFAULT_MODE;
const bannerParam = (() => {
  try {
    return new URL(window.location.href).searchParams.get("dvceBanner");
  } catch {
    return null;
  }
})();

let bannerElement = null;

function postDvceResponse(id, response) {
  try {
    window.postMessage(
      {
        dvce: true,
        type: "DVCE_RESPONSE",
        id: id ?? null,
        response: response ?? null
      },
      "*"
    );
  } catch {
    // ignore
  }
}

function isAllowedLocalOrigin(origin) {
  if (typeof origin !== "string" || origin.length === 0) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function updateModeFromStorage() {
  const storageGet = globalThis.chrome?.storage?.sync?.get;
  if (typeof storageGet !== "function") {
    // If someone accidentally loads this script outside an extension content-script context,
    // avoid hard-crashing so the lab page can still explain what's happening.
    currentMode = DEFAULT_MODE;
    return;
  }

  storageGet.call(chrome.storage.sync, { dvceMode: DEFAULT_MODE }, (result) => {
    const mode = result?.dvceMode;
    currentMode = mode === "fixed" ? "fixed" : "vulnerable";
    renderBanner();
  });
}

updateModeFromStorage();

function ensureBannerElement() {
  if (bannerElement) return bannerElement;
  if (!bannerParam) return null;

  const el = document.createElement("div");
  el.id = "dvce-banner";
  el.style.position = "fixed";
  el.style.left = "12px";
  el.style.bottom = "12px";
  el.style.zIndex = "2147483647";
  el.style.maxWidth = "min(560px, calc(100vw - 24px))";
  el.style.padding = "10px 12px";
  el.style.border = "1px solid #e5e7eb";
  el.style.borderRadius = "10px";
  el.style.background = "#fff";
  el.style.boxShadow = "0 10px 20px rgba(0,0,0,0.12)";
  el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  el.style.fontSize = "13px";

  const title = document.createElement("div");
  title.textContent = "DVCE Lab: DOM injection";
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  el.appendChild(title);

  const body = document.createElement("div");
  body.id = "dvce-banner-body";
  el.appendChild(body);

  document.documentElement.appendChild(el);
  bannerElement = el;
  return el;
}

function renderBanner() {
  if (!bannerParam) return;
  const el = ensureBannerElement();
  if (!el) return;

  const body = el.querySelector("#dvce-banner-body");
  if (!body) return;

  if (currentMode === "fixed") {
    body.textContent = bannerParam;
    return;
  }

  // VULNERABLE (intentional): HTML injection into the page DOM.
  // If an attacker can control bannerParam (e.g., via a link), this can lead to XSS in the page context.
  body.innerHTML = bannerParam;
}

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== "sync") return;
  if (!changes.dvceMode) return;
  currentMode = changes.dvceMode.newValue === "fixed" ? "fixed" : "vulnerable";
  renderBanner();
});

window.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data || data.dvce !== true) return;
  // Prevent an infinite loop: the content script also receives the responses
  // it posts back to the page. Those should never be treated as commands.
  if (data.type === "DVCE_RESPONSE") return;

  // VULNERABLE MODE (intentional):
  // - no strict event.origin allowlist
  // - no strict event.source checks
  // - forwards page-controlled commands to privileged extension code
  if (currentMode === "fixed") {
    if (event.source !== window) return;
    if (!isAllowedLocalOrigin(event.origin)) return;
    if (typeof data.args !== "object" && typeof data.args !== "undefined") return;
  }

  const sendMessage = globalThis.chrome?.runtime?.sendMessage;
  if (typeof sendMessage !== "function") {
    postDvceResponse(data.id, {
      ok: false,
      error: "no_chrome_runtime_sendMessage",
      hint:
        "DVCE content script appears to be running without extension runtime APIs. Reload the DVCE extension and ensure this page matches manifest content_scripts."
    });
    return;
  }

  try {
    sendMessage.call(
      chrome.runtime,
      {
        type: "DVCE_CMD",
        cmd: data.cmd,
        args: data.args
      },
      (response) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          postDvceResponse(data.id, {
            ok: false,
            error: "runtime_lastError",
            message: String(lastError?.message ?? lastError)
          });
          return;
        }
        postDvceResponse(data.id, response ?? null);
      }
    );
  } catch (e) {
    postDvceResponse(data.id, {
      ok: false,
      error: "sendMessage_throw",
      message: String(e?.message ?? e)
    });
  }
});
