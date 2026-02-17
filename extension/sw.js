const DEFAULT_MODE = "vulnerable"; // "vulnerable" | "fixed"
const LOG_LIMIT = 50;

let logs = [];

function isAllowedLocalUrl(urlString) {
  if (typeof urlString !== "string" || urlString.length === 0) return false;
  try {
    const url = new URL(urlString);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isHttpOrHttpsUrl(urlString) {
  if (typeof urlString !== "string" || urlString.length === 0) return false;
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function pushLog(entry) {
  logs.unshift({ ts: new Date().toISOString(), ...entry });
  if (logs.length > LOG_LIMIT) logs = logs.slice(0, LOG_LIMIT);
}

function storageSyncSet(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, () => resolve({ ok: true }));
  });
}

function storageSyncGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, (result) => resolve(result ?? {}));
  });
}

function storageSyncRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.remove(keys, () => resolve({ ok: true }));
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      resolve(
        t
          ? { id: t.id, url: t.url, title: t.title }
          : { error: "no_active_tab" }
      );
    });
  });
}

function getManifestInfo() {
  const m = chrome.runtime.getManifest();
  return {
    id: chrome.runtime.id,
    name: m?.name,
    version: m?.version,
    permissions: m?.permissions ?? [],
    host_permissions: m?.host_permissions ?? [],
    content_script_matches: (m?.content_scripts ?? [])
      .flatMap((cs) => cs?.matches ?? [])
      .filter(Boolean)
  };
}

function getMode() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ dvceMode: DEFAULT_MODE }, (result) => {
      const mode = result?.dvceMode;
      resolve(mode === "fixed" ? "fixed" : "vulnerable");
    });
  });
}

function setMode(mode) {
  const normalized = mode === "fixed" ? "fixed" : "vulnerable";
  return new Promise((resolve) => {
    chrome.storage.sync.set({ dvceMode: normalized }, () =>
      resolve({ ok: true, mode: normalized })
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ dvceMode: null }, (result) => {
    if (result.dvceMode == null) chrome.storage.sync.set({ dvceMode: DEFAULT_MODE });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "bad_message" });
      return;
    }

    if (message.type === "DVCE_CONTROL") {
      if (message.action === "getState") {
        const mode = await getMode();
        sendResponse({ ok: true, mode, logs });
        return;
      }

      if (message.action === "setMode") {
        const result = await setMode(message.mode);
        pushLog({ kind: "control", action: "setMode", mode: result.mode });
        sendResponse(result);
        return;
      }

      if (message.action === "clearLogs") {
        logs = [];
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "unknown_control_action" });
      return;
    }

    if (message.type !== "DVCE_CMD") {
      sendResponse({ ok: false, error: "unknown_type" });
      return;
    }

    const mode = await getMode();
    const cmd = message.cmd;
    const args = message.args ?? {};

    const senderUrl =
      sender?.url || sender?.tab?.url || sender?.documentId || "unknown_sender";
    pushLog({
      kind: "cmd",
      mode,
      cmd: typeof cmd === "string" ? cmd : "non_string_cmd",
      from: typeof senderUrl === "string" ? senderUrl : "unknown_sender"
    });

    if (mode === "fixed") {
      const tabUrl = sender?.tab?.url;
      if (!isAllowedLocalUrl(tabUrl)) {
        sendResponse({ ok: false, error: "blocked_sender" });
        return;
      }

      const allowedCmds = new Set([
        "setBadge",
        "openTabLocal",
        "injectTitle",
        "getManifestInfo",
        "getActiveTab"
      ]);
      if (typeof cmd !== "string" || !allowedCmds.has(cmd)) {
        sendResponse({ ok: false, error: "blocked_cmd" });
        return;
      }
    }

    if (cmd === "getManifestInfo") {
      sendResponse({ ok: true, manifest: getManifestInfo() });
      return;
    }

    if (cmd === "getActiveTab") {
      const tab = await getActiveTab();
      sendResponse({ ok: true, tab });
      return;
    }

    if (cmd === "storeSecret") {
      const value = String(args?.value ?? "");
      if (value.length === 0) {
        sendResponse({ ok: false, error: "missing_value" });
        return;
      }
      if (value.length > 4096) {
        sendResponse({ ok: false, error: "value_too_large" });
        return;
      }
      await storageSyncSet({ dvceSecret: value });
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "readSecret") {
      const r = await storageSyncGet({ dvceSecret: null });
      sendResponse({ ok: true, value: r.dvceSecret ?? null });
      return;
    }

    if (cmd === "clearSecret") {
      await storageSyncRemove(["dvceSecret"]);
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "openOptionsWithMsg") {
      // DVCE Lab: simulate a chain where a webpage can cause the extension to open a privileged
      // extension page with attacker-controlled input (via insecure messaging).
      const msg = String(args?.msg ?? "");
      if (msg.length > 2000) {
        sendResponse({ ok: false, error: "msg_too_large" });
        return;
      }

      const url = new URL(chrome.runtime.getURL("options.html"));
      if (msg.length > 0) url.searchParams.set("dvceMsg", msg);
      await chrome.tabs.create({ url: url.toString() });
      sendResponse({ ok: true, opened: url.toString() });
      return;
    }

    if (cmd === "setBadge") {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, error: "no_tab" });
        return;
      }

      const text = String(args?.text ?? "DVCE").slice(0, 4);
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#b00020" });
      chrome.action.setBadgeText({ tabId, text });
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "openTab") {
      // Vulnerable lab: "open a URL" based on untrusted input.
      // In fixed mode, use "openTabLocal" (local-only) instead.
      const url = String(args?.url ?? "http://localhost:8000/");
      if (!isHttpOrHttpsUrl(url)) {
        sendResponse({ ok: false, error: "bad_url" });
        return;
      }

      await chrome.tabs.create({ url });
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "openTabLocal") {
      const url = String(args?.url ?? "http://localhost:8000/");
      if (!isAllowedLocalUrl(url)) {
        sendResponse({ ok: false, error: "bad_local_url" });
        return;
      }
      await chrome.tabs.create({ url });
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "injectTitle") {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, error: "no_tab" });
        return;
      }

      const newTitle = String(args?.title ?? "DVCE Injected").slice(0, 80);
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (title) => {
          document.title = title;
        },
        args: [newTitle]
      });
      sendResponse({ ok: true });
      return;
    }

    if (cmd === "applyRemoteConfig") {
      const url = String(args?.url ?? "");
      if (!isHttpOrHttpsUrl(url)) {
        sendResponse({ ok: false, error: "bad_url" });
        return;
      }

      let response;
      try {
        response = await fetch(url, { cache: "no-store" });
      } catch {
        sendResponse({ ok: false, error: "fetch_failed" });
        return;
      }

      if (!response.ok) {
        sendResponse({ ok: false, error: "http_error", status: response.status });
        return;
      }

      let config;
      try {
        config = await response.json();
      } catch {
        sendResponse({ ok: false, error: "bad_json" });
        return;
      }

      const actions = Array.isArray(config?.actions) ? config.actions.slice(0, 10) : [];
      const report = {
        ok: true,
        fetchedFrom: url,
        name: typeof config?.name === "string" ? config.name : null,
        executed: [],
        ignored: []
      };

      const tabId = sender?.tab?.id;

      for (const a of actions) {
        const actionCmd = a?.cmd;
        const actionArgs = a?.args ?? {};
        if (typeof actionCmd !== "string") {
          report.ignored.push({ reason: "bad_cmd" });
          continue;
        }

        if (actionCmd === "setBadge") {
          if (typeof tabId !== "number") {
            report.ignored.push({ cmd: actionCmd, reason: "no_tab" });
            continue;
          }
          const text = String(actionArgs?.text ?? "CFG").slice(0, 4);
          chrome.action.setBadgeBackgroundColor({ tabId, color: "#b00020" });
          chrome.action.setBadgeText({ tabId, text });
          report.executed.push({ cmd: actionCmd });
          continue;
        }

        if (actionCmd === "injectTitle") {
          if (typeof tabId !== "number") {
            report.ignored.push({ cmd: actionCmd, reason: "no_tab" });
            continue;
          }
          const newTitle = String(actionArgs?.title ?? "DVCE Injected").slice(0, 80);
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (title) => {
              document.title = title;
            },
            args: [newTitle]
          });
          report.executed.push({ cmd: actionCmd });
          continue;
        }

        if (actionCmd === "openTab") {
          const openUrl = String(actionArgs?.url ?? "");
          if (!isHttpOrHttpsUrl(openUrl)) {
            report.ignored.push({ cmd: actionCmd, reason: "bad_url" });
            continue;
          }
          await chrome.tabs.create({ url: openUrl });
          report.executed.push({ cmd: actionCmd });
          continue;
        }

        if (actionCmd === "openTabLocal") {
          const openUrl = String(actionArgs?.url ?? "");
          if (!isAllowedLocalUrl(openUrl)) {
            report.ignored.push({ cmd: actionCmd, reason: "bad_local_url" });
            continue;
          }
          await chrome.tabs.create({ url: openUrl });
          report.executed.push({ cmd: actionCmd });
          continue;
        }

        report.ignored.push({ cmd: actionCmd, reason: "unknown_cmd" });
      }

      sendResponse(report);
      return;
    }

    sendResponse({ ok: false, error: "unknown_cmd" });
  })().catch((e) => {
    const msg = String(e?.message ?? e);
    pushLog({ kind: "error", error: msg });
    sendResponse({ ok: false, error: "exception", message: msg });
  });

  return true;
});
