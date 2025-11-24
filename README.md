
# dark-mode (browser extension)

This is a minimal browser extension (Manifest v3) that extracts a multiple-choice question (MCQ) and its options from the current web page, sends the question and options to the Gemini API (gemini-2.5-flash) using the API format shown in the user's spec, and displays a temporary message containing the correct option or "N/A" if the answer cannot be determined or doesn't match any provided option.

Key behavior:
- The extension does NOT auto-select any option on the page.
- If Gemini returns a match that equals one of the given options, that option text is shown briefly (1 second).
- Otherwise, the message "N/A" is shown briefly (1 second).

Installation (developer mode):
1. Open your browser's Extensions page (e.g., chrome://extensions).
2. Enable Developer mode.
3. Click "Load unpacked" and select this project folder.

Usage:
1. Press the keyboard shortcut Alt+Shift+Z (or configure it via your browser's extension keyboard shortcuts page) while on a page containing an MCQ to trigger the scan.
2. The extension will scan the page for an MCQ (heuristics: radio groups, lists after question marks, labeled options).
3. It will call the Gemini API and show a brief result overlay at the bottom center of the page.
4. Note: The toolbar button and automatic page scans do not trigger the Gemini call by default; only the keyboard shortcut or forced messages will.

Debugging & troubleshooting:
- If pressing Alt+Shift+Z doesn't trigger anything:
  - Open the Extensions page (chrome://extensions) → Keyboard shortcuts, and verify the command for this extension is set to Alt+Shift+Z.
  - Right-click the extension card → Inspect service worker (background) to open the background console. Press Alt+Shift+Z and watch for console logs like "[background] command received trigger-scan".
  - Open DevTools for the web page (F12) and check the Console for logs like "[content] onMessage scan-mcq received forced=true" and "[content] triggering forced scan".
  - On Linux, Alt+Shift combinations are sometimes reserved for changing keyboard layout; pick a different shortcut if necessary in the Keyboard shortcuts UI.
  - You can also test the scan locally on the test page by pressing Alt+Shift+Z in the page (the test page captures it and posts a forced message) or by pressing the "Manual Trigger" button on the test page.

Notes and assumptions:
- The extension stores the API key in chrome.storage.sync as `GEMINI_API_KEY`.
- The request uses the endpoint:
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  with header `x-goog-api-key` and the JSON payload matching the user's example.
- The extension uses some heuristics to find MCQs; it may not find every possible question layout. If none found, it shows "N/A".

Security:
- Storing API keys in extension storage has risks; consider rotating keys or using a secure backend in production.
