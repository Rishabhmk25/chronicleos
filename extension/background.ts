// extension/background.ts
// Listens to all tab activity and forwards to FastAPI backend

const BACKEND_URL = "http://localhost:8000"

interface PageVisit {
  url: string
  title: string
  timestamp: number
  visit_start: number
  selected_text?: string
  page_text?: string
  tab_id: number
  session_id: string
}

// Track when each tab was activated
const tabStartTimes: Record<number, number> = {}
const sessionId = Date.now().toString()

// When user switches to a tab or opens a new one
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  tabStartTimes[tabId] = Date.now()
  const tab = await chrome.tabs.get(tabId)
  if (tab.url && !tab.url.startsWith("chrome://")) {
    sendVisit(tab, tabId)
  }
})

// When a tab finishes loading a new URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    tabStartTimes[tabId] = Date.now()
    sendVisit(tab, tabId)
  }
})

// When tab is closed, record duration
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStartTimes[tabId]
})

async function sendVisit(tab: chrome.tabs.Tab, tabId: number) {
  if (!tab.url || !tab.title) return
  // Skip chrome internal pages, new tab, extensions
  const skipPrefixes = ["chrome://", "chrome-extension://", "about:", "edge://"]
  if (skipPrefixes.some(prefix => tab.url!.startsWith(prefix))) return

  try {
    const urlObj = new URL(tab.url)
    if (urlObj.hostname === "localhost" || urlObj.hostname === "127.0.0.1") return
  } catch (e) {
    // Ignore invalid URLs
  }

  let pageText = ""
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body.innerText.substring(0, 5000)
    })
    if (results && results[0] && results[0].result) {
      pageText = results[0].result
    }
  } catch (e) {
    console.log("Could not grab page text", e)
  }

  const visit: PageVisit = {
    url: tab.url,
    title: tab.title,
    timestamp: Date.now(),
    visit_start: tabStartTimes[tabId] || Date.now(),
    tab_id: tabId,
    session_id: sessionId,
    page_text: pageText,
  }

  try {
    await fetch(`${BACKEND_URL}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visit),
    })
  } catch (e) {
    // Backend not running — silently ignore
    console.log("ChronicleOS: backend not reachable", e)
  }
}

// Listen for selected text from content script
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "SELECTED_TEXT" && sender.tab) {
    // Update the last capture with selected text
    fetch(`${BACKEND_URL}/capture/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: sender.tab.url,
        timestamp: Date.now(),
        selected_text: message.text,
      }),
    }).catch(() => {})
  }
})