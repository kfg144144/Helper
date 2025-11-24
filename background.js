// background service worker
// Listens for action clicks and coordinates calling Gemini API when content script finds an MCQ

// Hardcode your Gemini API key here (x-goog-api-key). Replace the placeholder with your real key.
const GEMINI_API_KEY = 'AIzaSyDWAFJc8eFP6f6ZWtPeUTRnRJzxcjld5vM';

// On toolbar button click, send a message to the active tab to scan for MCQs
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    // Don't trigger a Gemini call from the toolbar by default (the content script
    // will only perform the call when message.forced === true)
    chrome.tabs.sendMessage(tab.id, { action: 'scan-mcq' });
  } catch (e) {
    // tab may not have content script ready; try to inject and then message
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      chrome.tabs.sendMessage(tab.id, { action: 'scan-mcq' });
    } catch (err) {
      console.error('Failed to inject content script or message it:', err);
    }
  }
});

// Add a keyboard command -> send forced scan to content script in the active tab.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'trigger-scan') return;
    console.log('[background] command received', command);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) return;
      const tab = tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { action: 'scan-mcq', forced: true }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('[background] sendMessage.lastError', chrome.runtime.lastError);
        }
        console.log('[background] sent forced scan to tab', tab.id, 'response:', resp);
      });
    } catch (e) {
      console.error('[background] Failed to trigger forced scan via keyboard command', e);
    }
  });
}

// Add a keyboard command listener that triggers a forced scan on the active tab
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'trigger-scan') {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || !tabs[0] || !tabs[0].id) return;
        const tabId = tabs[0].id;
        // Send a forced scan message (content script will run Gemini only for forced)
        chrome.tabs.sendMessage(tabId, { action: 'scan-mcq', forced: true });
      } catch (e) {
        console.error('Error sending forced scan to active tab:', e);
      }
    }
  });
}

// Helper to find a string inside an object recursively
function findFirstString(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstString(item);
      if (found) return found;
    }
  } else if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const found = findFirstString(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

// Normalize text for matching
function normalizeText(s) {
  return (s || '')
    .toString()
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Validate Gemini's text against provided options
function matchToOption(candidateText, options) {
  if (!candidateText) return null;
  const normalizedCandidate = normalizeText(candidateText);
  const normalizedOptions = options.map((o) => normalizeText(o));

  // exact match
  for (let i = 0; i < normalizedOptions.length; i++) {
    if (normalizedCandidate === normalizedOptions[i]) return options[i];
  }

  // single letter like 'A' or 'B' or 'a)'
  const letterMatch = normalizedCandidate.match(/^([a-z])\)?$/i);
  if (letterMatch) {
    const index = letterMatch[1].toLowerCase().charCodeAt(0) - 97;
    if (index >= 0 && index < options.length) return options[index];
  }

  // contains an option as substring
  for (let i = 0; i < normalizedOptions.length; i++) {
    if (normalizedCandidate.includes(normalizedOptions[i]) || normalizedOptions[i].includes(normalizedCandidate)) {
      return options[i];
    }
  }

  // try to find a single option token inside the candidate
  for (let i = 0; i < normalizedOptions.length; i++) {
    const parts = normalizedOptions[i].split(' ');
    if (parts.length && normalizedCandidate.includes(parts[0])) return options[i];
  }

  return null;
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.action === 'ask-gemini') {
    (async () => {
      const { question, options } = message;
      if (!question || !options || !options.length) {
        sendResponse({ ok: false, answer: null });
        return;
      }

      // Use the hardcoded key
      const key = GEMINI_API_KEY;
      if (!key || key === 'PASTE_YOUR_API_KEY_HERE') {
        console.error('Gemini API key is not set in background.js');
        sendResponse({ ok: false, answer: null });
        return;
      }

      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

      // Build prompt: ask for ONLY the correct option from the list
      const optionLetters = options.map((opt, idx) => `${String.fromCharCode(65 + idx)}) ${opt}`);
      const prompt = `Question: ${question}\nOptions:\n${optionLetters.join('\n')}\n\nReturn ONLY the correct option text exactly as it appears in the list above. If you cannot determine the answer, respond with 'UNKNOWN'.`;

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ]
          })
        });

        if (!resp.ok) {
          console.error('Gemini request failed', resp.status, await resp.text());
          sendResponse({ ok: false, answer: null });
          return;
        }

        const data = await resp.json();

        // Try to extract a textual answer from response in several ways
        let candidate = null;
        const possibleFields = [
          data?.candidates?.[0]?.content?.[0]?.text,
          data?.candidates?.[0]?.message?.content?.[0]?.text,
          data?.output?.[0]?.content?.[0]?.text
        ];
        for (const p of possibleFields) {
          if (p) {
            candidate = p;
            break;
          }
        }

        if (!candidate) {
          candidate = findFirstString(data);
        }

        const matched = matchToOption(candidate, options);
        if (matched) {
          sendResponse({ ok: true, answer: matched });
        } else {
          sendResponse({ ok: false, answer: null });
        }
      } catch (err) {
        console.error('Error calling Gemini API', err);
        sendResponse({ ok: false, answer: null });
      }
    })();

    // Return true to indicate we'll call sendResponse asynchronously
    return true;
  }
});
