// extension/background.ts
// Listens to all tab activity, queues captures in-memory, and batches them to the backend.

const DEFAULT_BACKEND_URL = "https://chronicalos.onrender.com";

// Track tab activation times
const tabStartTimes = {};
const sessionId = Date.now().toString();

// In-memory queue for batch sync pipeline
let captureQueue = [];
let isFlushing = false;

// Retrieve active backend URL dynamically
async function getBackendUrl() {
  try {
    const res = await chrome.storage.local.get("cos_backend_url");
    return res.cos_backend_url || DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

// When user switches to a tab or opens a new one
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  tabStartTimes[tabId] = Date.now();
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith("chrome://")) {
      queueVisit(tab, tabId);
    }
  } catch (e) {
    console.log("Error handling tab activation:", e);
  }
});

// When a tab finishes loading a new URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // 1. Silent Single Sign-On (SSO) check for dashboard tabs
    const isDashboard =
      tab.url.includes("localhost:5173") ||
      tab.url.includes("localhost:5174") ||
      tab.url.includes("vercel.app");
    if (isDashboard) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            return {
              token: localStorage.getItem("cos_token"),
              username: localStorage.getItem("cos_username"),
              groqKey: localStorage.getItem("cos_groq_api_key"),
              nomicKey: localStorage.getItem("cos_nomic_api_key"),
              backendUrl: localStorage.getItem("cos_backend_url"),
            };
          },
        });
        if (results && results[0] && results[0].result) {
          const { token, groqKey, nomicKey, backendUrl } = results[0].result;
          const updates = {};
          if (token) updates.cos_token = token;
          if (groqKey) updates.cos_groq_api_key = groqKey;
          if (nomicKey) updates.cos_nomic_api_key = nomicKey;
          if (backendUrl) updates.cos_backend_url = backendUrl;
          if (Object.keys(updates).length > 0) {
            await chrome.storage.local.set(updates);
            console.log(
              "ChronicleOS: Background auto-synced auth token & BYOK config from dashboard tab!",
            );
          }
        }
      } catch (e) {
        // Silently ignore script injection errors
      }
    }

    // 2. Normal visit capture queuing
    if (!tab.url.startsWith("chrome://")) {
      tabStartTimes[tabId] = Date.now();
      queueVisit(tab, tabId);
    }
  }
});

// When tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStartTimes[tabId];
});

async function queueVisit(tab, tabId) {
  if (!tab.url || !tab.title) return;
  // Skip chrome internal pages, new tab, extensions
  const skipPrefixes = [
    "chrome://",
    "chrome-extension://",
    "about:",
    "edge://",
  ];
  if (skipPrefixes.some((prefix) => tab.url.startsWith(prefix))) return;

  try {
    const urlObj = new URL(tab.url);
    if (urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1")
      return;
  } catch (e) {
    return; // Skip invalid URLs
  }

  let pageText = "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body.innerText.substring(0, 5000),
    });
    if (results && results[0] && results[0].result) {
      pageText = results[0].result;
    }
  } catch (e) {
    console.log("Could not grab page text:", e);
  }

  const visit = {
    url: tab.url,
    title: tab.title,
    timestamp: Date.now(),
    visit_start: tabStartTimes[tabId] || Date.now(),
    tab_id: tabId,
    session_id: sessionId,
    page_text: pageText,
  };

  // Push to queue
  captureQueue.push(visit);
  console.log(
    `ChronicleOS queued page capture: ${tab.title}. Queue length: ${captureQueue.length}`,
  );

  // Trigger flush immediately if we have accumulated 5+ pages
  if (captureQueue.length >= 5) {
    flushQueue();
  }
}

// Core sync pipeline flush function
async function flushQueue() {
  if (captureQueue.length === 0 || isFlushing) return;
  isFlushing = true;

  // Take current batch and clear the active queue
  const batch = [...captureQueue];
  captureQueue = [];

  const backendUrl = await getBackendUrl();
  try {
    const { cos_token, cos_groq_api_key, cos_nomic_api_key } =
      await chrome.storage.local.get([
        "cos_token",
        "cos_groq_api_key",
        "cos_nomic_api_key",
      ]);
    const headers = { "Content-Type": "application/json" };
    if (cos_token) headers["Authorization"] = `Bearer ${cos_token}`;
    if (cos_groq_api_key) headers["X-Groq-Api-Key"] = cos_groq_api_key;
    if (cos_nomic_api_key) headers["X-Nomic-Api-Key"] = cos_nomic_api_key;

    console.log(
      `ChronicleOS syncing batch of ${batch.length} pages to ${backendUrl}...`,
    );
    const response = await fetch(`${backendUrl}/capture/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ captures: batch }),
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    console.log(
      `ChronicleOS successfully synced batch of ${batch.length} pages.`,
    );
  } catch (e) {
    console.log("ChronicleOS: sync failed, returning batch to queue", e);
    // Prepend batch back to retry on next flush
    captureQueue = [...batch, ...captureQueue];
  } finally {
    isFlushing = false;
  }
}

// Periodically flush the capture queue every 15 seconds
setInterval(flushQueue, 15000);

// Listen for selected text from content script (instant send or queue)
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "SELECTED_TEXT" && sender.tab) {
    chrome.storage.local.get("cos_token", async (res) => {
      const backendUrl = await getBackendUrl();
      const headers = { "Content-Type": "application/json" };
      if (res.cos_token) headers["Authorization"] = `Bearer ${res.cos_token}`;

      fetch(`${backendUrl}/capture/text`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: sender.tab.url,
          timestamp: Date.now(),
          selected_text: message.text,
        }),
      }).catch((e) => console.log("Failed to sync selected text:", e));
    });
  }
});
