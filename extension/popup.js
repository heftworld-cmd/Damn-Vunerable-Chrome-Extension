function $(id) {
  return document.getElementById(id);
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

async function clearLogs() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "DVCE_CONTROL", action: "clearLogs" },
      (response) => resolve(response)
    );
  });
}

function formatLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) return "No logs yet.\n";
  return logs
    .map((l) => {
      const parts = [
        l.ts ?? "?",
        l.kind ?? "?",
        l.mode ?? "?",
        l.cmd ? `cmd=${l.cmd}` : "",
        l.action ? `action=${l.action}` : "",
        l.from ? `from=${l.from}` : ""
      ].filter(Boolean);
      return parts.join(" | ");
    })
    .join("\n");
}

async function refresh() {
  const state = await getState();
  if (!state?.ok) {
    $("mode").textContent = "error";
    $("logs").textContent = JSON.stringify(state, null, 2);
    return;
  }
  $("mode").textContent = state.mode;
  $("logs").textContent = formatLogs(state.logs);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("toggle").addEventListener("click", async () => {
    const state = await getState();
    const next = state?.mode === "fixed" ? "vulnerable" : "fixed";
    await setMode(next);
    await refresh();
  });

  $("options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("clear").addEventListener("click", async () => {
    await clearLogs();
    await refresh();
  });

  await refresh();
});
