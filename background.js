// background service worker
// Listens for action clicks and coordinates calling Gemini API with a screenshot of the active tab

// Add your multiple API keys here
const GEMINI_API_KEYS = [
  "AIzaSyBmeEvGDvnToS8HYoSXAsPK3_Qw-wK_MBk",//1
  "AIzaSyDgZ97L6Jpy39ixopgqLkYwEFW9Cpf21XM",//2
  "AIzaSyDIQOJJhEAysZ_Af-XHM-UVAyJnkbqKSME",//3
];

let currentKeyIndex = 0;

async function handleScanTrigger(tab) {
  if (!tab || (!tab.id && !tab.windowId)) return;

  // Attempt to inject content script just in case it's not present
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (e) {
    console.warn("Script injection failed or already injected:", e);
  }

  // Notify the content script we are thinking
  chrome.tabs.sendMessage(tab.id, { action: "show-result", text: "." }, () => {
    // Ignore error if content script isn't ready to receive it right this millisecond
    if (chrome.runtime.lastError) {
    }
  });

  // Capture the visible tab image
  chrome.tabs.captureVisibleTab(
    tab.windowId,
    { format: "jpeg", quality: 80 },
    async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error("Failed to capture tab:", chrome.runtime.lastError);
        chrome.tabs.sendMessage(tab.id, {
          action: "show-result",
          text: "Error: Cannot capture screen",
        });
        return;
      }

      const base64Data = dataUrl.split(",")[1];

      // Updated to use the requested model
      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

      const prompt = `You are an expert system. You are given an image of a multiple-choice question on a screen. 
Please read the question and the options shown. 
Return ONLY the SINGLE LETTER (A, B, C, D...) corresponding to the correct option, in capital letters with no extra explanation.
If you cannot determine the answer, return EXACTLY 'UNKNOWN'. Be concise.`;

      const requestBody = JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data,
                },
              },
            ],
          },
        ],
      });

      let data = null;
      let success = false;
      let attempts = 0;
      const maxAttempts = GEMINI_API_KEYS.length;

      // Retry loop for API keys
      while (attempts < maxAttempts && !success) {
        const currentKey = GEMINI_API_KEYS[currentKeyIndex];

        try {
          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": currentKey,
            },
            body: requestBody,
          });

          if (resp.ok) {
            data = await resp.json();
            success = true;
            break; // Success, exit loop
          }

          // Handle 429 Too Many Requests (Quota Exceeded)
          if (resp.status === 429 || resp.status === 403) {
            console.warn(
              `API key at index ${currentKeyIndex} failed with status ${resp.status}. Switching to next key...`,
            );
            currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
            attempts++;
          } else {
            // Some other error (e.g. 400 Bad Request, 500 Server Error)
            console.error(
              "Gemini request failed",
              resp.status,
              await resp.text(),
            );
            break; // Don't retry on non-quota errors
          }
        } catch (err) {
          console.error("Network or fetch error:", err);
          break;
        }
      }

      if (!success || !data) {
        // If we exhausted all keys or hit an unrecoverable error
        let errorMsg = "Error: API request failed";
        if (attempts >= maxAttempts) {
          errorMsg =
            "hm";
        }
        chrome.tabs.sendMessage(tab.id, {
          action: "show-result",
          text: errorMsg,
        });
        return;
      }

      let candidate = null;
      // Extract from the response structure
      if (data?.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.text) {
            candidate = part.text;
            break;
          }
        }
      }

      if (!candidate) {
        candidate = "UNKNOWN";
      }

      candidate = candidate.trim();
      let letter = "N/A";

      if (candidate === "UNKNOWN") {
        letter = "UNKNOWN";
      } else {
        // Grab the first alphabetical character as the likely option letter
        const match = candidate.match(/([a-zA-Z])/);
        if (match) {
          letter = match[1].toUpperCase();
        }
      }

      // Send the final result letter to the content script for display
      chrome.tabs.sendMessage(tab.id, {
        action: "show-result",
        text: letter,
      });
    },
  );
}

// Trigger via browser action (extension icon click)
chrome.action.onClicked.addListener((tab) => {
  handleScanTrigger(tab);
});

// Trigger via keyboard command
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "trigger-scan") {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs && tabs.length > 0) {
          handleScanTrigger(tabs[0]);
        }
      } catch (e) {
        console.error("Error finding active tab for shortcut:", e);
      }
    }
  });
}

// Trigger via message from content script (e.g. forced scan from page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "trigger-screenshot-scan") {
    if (sender && sender.tab) {
      handleScanTrigger(sender.tab);
    } else {
      // Fallback if sender tab is undefined but we want to capture active
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs && tabs.length > 0) handleScanTrigger(tabs[0]);
      });
    }
    // Return true or sendResponse since we're handling async
    sendResponse({ ok: true });
  }
});
