// Content script: displays a transient overlay with result from background script

// Listen for the final result from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.action === "show-result") {
    showTransientMessage(message.text || "N/A");
    sendResponse({ ok: true });
  }
});

// Allow test pages to trigger a scan via window.postMessage({ type: 'MCQ_SCAN' })
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (msg && msg.type === "MCQ_SCAN" && msg.forced === true) {
    console.log(
      "[content] received window forced MCQ_SCAN, requesting screenshot",
    );

    // Check if we are already thinking to prevent spam
    const existing = document.getElementById("__mcg_overlay__");
    if (!existing || existing.textContent !== ".") {
      showTransientMessage(".");
    }

    // Tell background to take a screenshot and query Gemini Vision
    chrome.runtime.sendMessage({ action: "trigger-screenshot-scan" });
  }
});

// Create and show a transient overlay message
function showTransientMessage(text) {
  // remove any existing
  const existing = document.getElementById("__mcg_overlay__");
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.id = "__mcg_overlay__";
  div.textContent = text;
  Object.assign(div.style, {
    position: "fixed",
    bottom: "10px",
    left: "10px",
    background: "rgba(0,0,0,0.85)",
    color: "white",
    padding: "4px 8px",
    borderRadius: "6px",
    zIndex: 2147483647,
    fontSize: "12px",
    fontWeight: "normal",
    boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
    fontFamily: "sans-serif",
    transition: "opacity 0.2s",
  });

  document.documentElement.appendChild(div);

  // Leave the answer up for 1 second before removing it
  setTimeout(() => {
    if (div && div.parentNode) {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 200);
    }
  }, 1000);
}
