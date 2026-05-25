export {}

document.addEventListener("mouseup", () => {
  const selection = window.getSelection()?.toString().trim()
  if (selection && selection.length > 10 && selection.length < 2000) {
    try {
      chrome.runtime.sendMessage({
        type: "SELECTED_TEXT",
        text: selection,
      }).catch(() => {})
    } catch (e) {
      // Extension context invalidated due to hot-reload, ignore
    }
  }
})