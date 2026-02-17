function $(id) {
  return document.getElementById(id);
}

function logLine(line) {
  $("out").textContent += line + "\n";
}

function setOutput(text) {
  $("out").textContent = text + "\n";
}

async function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "DVCE_CONTROL", action: "getState" },
      (response) => resolve(response)
    );
  });
}

async function setMode(mode) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "DVCE_CONTROL", action: "setMode", mode },
      (response) => resolve(response)
    );
  });
}

function getModeFromState(state) {
  return state?.mode === "fixed" ? "fixed" : "vulnerable";
}

function getQueryParam(name) {
  try {
    return new URL(window.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  if (!value) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.location.href = url.toString();
}

function renderDvceMsg(mode) {
  const dvceMsg = getQueryParam("dvceMsg") ?? "";
  $("dvceMsg").value = dvceMsg;

  const target = $("renderTarget");
  if (mode === "fixed") {
    target.textContent = dvceMsg;
    return;
  }

  // VULNERABLE (intentional): HTML injection on an extension page.
  // In real-world extensions, if this becomes script execution, it can mean full extension takeover.
  target.innerHTML = dvceMsg;
}

async function storageSet(key, value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => resolve({ ok: true }));
  });
}

async function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ [key]: null }, (r) => resolve(r?.[key] ?? null));
  });
}

async function storageRemove(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.remove([key], () => resolve({ ok: true }));
  });
}

async function getActiveTabInfo() {
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

async function tryEval() {
  try {
    // If CSP blocks eval, Chrome should throw a CSP error.
    // eslint-disable-next-line no-eval
    const result = eval("2+2");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function loadVendorScript(variant) {
  const safePath = "vendor/vendor-safe.js";
  const compromisedPath = "vendor/vendor-compromised.js";
  const path = variant === "compromised" ? compromisedPath : safePath;

  // Remove any previous vendor script tag and global.
  const old = document.getElementById("dvceVendorScript");
  if (old) old.remove();
  try {
    delete window.DVCE_VENDOR;
  } catch {
    // ignore
  }

  const src = chrome.runtime.getURL(path);
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "dvceVendorScript";
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed_to_load_vendor"));
    document.head.appendChild(s);
  });

  const vendor = window.DVCE_VENDOR;
  if (!vendor || typeof vendor.name !== "string" || typeof vendor.format !== "function") {
    throw new Error("bad_vendor_api");
  }
  return vendor;
}

async function refresh() {
  const state = await getState();
  if (!state?.ok) {
    setOutput(JSON.stringify(state, null, 2));
    return;
  }

  const mode = getModeFromState(state);
  $("mode").textContent = mode;
  $("extId").textContent = chrome.runtime.id;

  setOutput("DVCE Options loaded.\n");
  logLine("location.origin = " + location.origin);
  logLine("mode = " + mode);
  logLine("");

  renderDvceMsg(mode);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("toggleMode").addEventListener("click", async () => {
    const state = await getState();
    const next = getModeFromState(state) === "fixed" ? "vulnerable" : "fixed";
    await setMode(next);
    await refresh();
  });

  $("reloadWithMsg").addEventListener("click", () => {
    setQueryParam("dvceMsg", $("dvceMsg").value);
  });

  $("saveSecret").addEventListener("click", async () => {
    const value = $("secret").value;
    await storageSet("dvceSecret", value);
    logLine("Saved dvceSecret to chrome.storage.sync");
  });

  $("readSecret").addEventListener("click", async () => {
    const v = await storageGet("dvceSecret");
    logLine("Read dvceSecret: " + JSON.stringify(v));
  });

  $("clearSecret").addEventListener("click", async () => {
    await storageRemove("dvceSecret");
    logLine("Cleared dvceSecret");
  });

  $("activeTab").addEventListener("click", async () => {
    const tab = await getActiveTabInfo();
    logLine("Active tab: " + JSON.stringify(tab, null, 2));
  });

  $("tryEval").addEventListener("click", async () => {
    const r = await tryEval();
    logLine("eval() result: " + JSON.stringify(r, null, 2));
  });

  $("loadVendor").addEventListener("click", async () => {
    const variant = $("vendorVariant").value === "compromised" ? "compromised" : "safe";
    await storageSet("dvceVendorVariant", variant);
    try {
      const vendor = await loadVendorScript(variant);
      $("vendorStatus").textContent = vendor.name;
      logLine("Vendor says: " + vendor.format("hello"));
    } catch (e) {
      $("vendorStatus").textContent = "failed";
      logLine("Vendor load failed: " + String(e?.message ?? e));
    }
  });

  // Load preferred vendor if present (optional).
  try {
    const preferred = (await storageGet("dvceVendorVariant")) || "safe";
    $("vendorVariant").value = preferred === "compromised" ? "compromised" : "safe";
  } catch {
    // ignore
  }

  await refresh();
});

