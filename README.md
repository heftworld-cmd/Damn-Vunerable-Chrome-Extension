# DVCE (Local Lab) — Damn Vulnerable Chrome Extension

This is a **local-only training lab** you can use to teach common Chrome extension vulnerability patterns.

**Learning purpose only. Educational use only.**

**Do not publish this extension. Do not install it in your daily browser profile.**

## Setup

1. Start the local lab site:

   ```bash
   cd dvce/web
   python3 -m http.server 8000
   ```

2. Load the extension:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `dvce/extension`

3. Open the popup to toggle **Mode**:
   - `vulnerable`: intentionally unsafe behavior
   - `fixed`: basic checks to demonstrate mitigations

## Labs (run in the browser)

- Start here: `http://localhost:8000/`
- `http://localhost:8000/lab-postmessage.html` — `window.postMessage` bridge drives privileged actions
- `http://localhost:8000/lab-iframe.html` — cross-origin iframe can drive the same bridge if you don’t validate `event.source`/`event.origin`
- `http://localhost:8000/lab-dom.html` — content script injects `?dvceBanner=` into the DOM (unsafe in vulnerable mode)
- `http://localhost:8000/lab-war.html` — `web_accessible_resources` can expose packaged data
- `http://localhost:8000/lab-permissions.html` — why excessive permissions are high impact
- `http://localhost:8000/lab-storage.html` — insecure storage of secrets (fake token demo)
- `http://localhost:8000/lab-remote-config.html` — remote config interpreted as privileged actions
- `http://localhost:8000/lab-extension-pages.html` — HTML injection in extension pages (options)
- `http://localhost:8000/lab-csp.html` — CSP basics for extensions
- `http://localhost:8000/lab-supply-chain.html` — supply chain & dependency risks
- `http://localhost:8000/lab-updates.html` — update/publisher security checklist
- `http://localhost:8000/lab-privacy.html` — data exfiltration & tracking abuse concepts

## How DVCE works (high level)

DVCE is intentionally built like many real-world extensions:

```
Web page JS (localhost)
  └─ window.postMessage({ cmd, args })
       └─ dvce/extension/content.js (content script)
            └─ chrome.runtime.sendMessage({ cmd, args })
                 └─ dvce/extension/sw.js (service worker)
                      └─ privileged action (tabs, scripting, storage, ...)
                 └─ response
       └─ window.postMessage({ type: "DVCE_RESPONSE", response })
```

Key parts:
- `dvce/extension/content.js`: runs inside matching webpages and acts as a “bridge” (untrusted page → extension).
- `dvce/extension/sw.js`: the privileged “brain” (where dangerous actions typically happen).
- `dvce/extension/options.html` / `dvce/extension/options.js`: a privileged extension page (high impact if it gets XSS/HTML injection).

## DVCE modes

- **vulnerable**: the bridge is permissive and the service worker executes risky commands.
- **fixed**: basic sender validation + command allowlisting (defense-in-depth; not a complete secure design).

Tip: keep the DVCE popup open during labs — it shows a log of received commands and the sender URL.

## Lab walkthroughs (what to click + what to observe)

### 1) `lab-postmessage.html` — page → content script → service worker

- Try: click `setBadge`, `openTab`, `openTabLocal`, `injectTitle`.
- Observe:
  - vulnerable mode: all actions run.
  - fixed mode: risky `openTab` is blocked; safer `openTabLocal` is allowed.
- Code path: `content.js` forwards the message → `sw.js` runs the command.

### 2) `lab-iframe.html` — cross-origin iframe drives the same bridge

- Try: in the iframe, click `Send setBadge`.
- Observe:
  - vulnerable mode: badge changes (the bridge accepts iframe messages).
  - fixed mode: badge does not change (blocks `event.source !== window`).
- What this teaches: an embedded third-party iframe can become an attacker-controlled input channel if you don’t validate `event.source` + `event.origin`.

### 3) `lab-dom.html` — content script DOM injection (page-context XSS)

- Try (example):
  - `http://localhost:8000/lab-dom.html?dvceBanner=%3Cb%3EHello+from+HTML%3C%2Fb%3E`
- Observe:
  - vulnerable mode: the banner renders as bold HTML (because `innerHTML` is used).
  - fixed mode: the banner shows literal text (because `textContent` is used).
- What this teaches: extensions can accidentally *introduce* XSS into websites by using dangerous DOM sinks.

### 4) `lab-war.html` — `web_accessible_resources` can leak packaged data

- Try: paste the DVCE extension ID and click `Load leaked.js`.
- Where to get the extension ID:
  - `chrome://extensions` (Details), or
  - run `getManifestInfo` from `lab-permissions.html` (DVCE returns `manifest.id`).
- Observe: the page can load `chrome-extension://<id>/public/leaked.js` and read its exported data.

### 5) `lab-permissions.html` — why over-permission is dangerous

- Try: click `Get manifest info` and `Get active tab info`.
- Observe: permissions and host permissions define the blast radius if anything else goes wrong (XSS, supply chain, unsafe messaging).

### 6) `lab-storage.html` — insecure storage of sensitive data

- Requires: **vulnerable** mode (fixed blocks `storeSecret`/`readSecret` from webpages).
- Try: `Save token (sync)`, then `Read token (sync)`.
- What this teaches: if the extension is compromised later, anything stored in `chrome.storage` can be stolen.

### 7) `lab-remote-config.html` — remote config interpreted as privileged actions

- Requires: **vulnerable** mode (fixed blocks `applyRemoteConfig`).
- Try: choose `remote-config-safe.json` vs `remote-config-danger.json`, then click `Fetch + apply config`.
- Observe: the service worker fetches JSON and performs actions described by the config.
- What this teaches: “config” can become a remote command channel even without loading remote JavaScript.

### 8) `lab-extension-pages.html` — HTML injection in extension pages (high severity)

- Requires: **vulnerable** mode (fixed blocks `openOptionsWithMsg`).
- Try: click `Ask DVCE to open options.html`.
- Observe: DVCE opens its own `options.html?dvceMsg=...` and (in vulnerable mode) renders attacker-controlled HTML using `innerHTML`.
- What this teaches: injection in extension pages can become extension-level compromise.

### 9) `lab-csp.html` — CSP basics for extensions

- This lab is mostly conceptual; connect it with `lab-extension-pages.html` (why CSP matters when injection exists).

### 10) `lab-supply-chain.html`, `lab-updates.html`, `lab-privacy.html`

- These are conceptual labs/checklists to connect “how the compromise happens” (messaging/XSS/deps) with “how it scales” (updates/telemetry/privacy impact).

## Troubleshooting

- If you see errors like `Cannot read properties of undefined (reading 'sendMessage')`:
  - reload DVCE on `chrome://extensions`
  - ensure the lab is opened as `http://localhost:8000/...` (DVCE is local-only and only matches localhost/127.0.0.1)
- If you see “(no response)”, you may be in **fixed** mode and the command is intentionally blocked.
