# MCQ Gemini Helper (browser extension)

This is a minimal browser extension (Manifest v3) that extracts a multiple-choice question (MCQ) and its options from the current web page, sends the question and options to the Gemini API (gemini-2.5-flash) using the API format shown in the user's spec, and displays a temporary message containing the correct option or "Night Mode is ON" if the answer cannot be determined or doesn't match any provided option.

Key behavior:
- The extension does NOT auto-select any option on the page.
- If Gemini returns a match that equals one of the given options, that option text is shown briefly (1 second).
- Otherwise, the message "Night Mode is ON" is shown briefly (1 second).

Installation (developer mode):
1. Open your browser's Extensions page (e.g., chrome://extensions).
2. Enable Developer mode.
3. Click "Load unpacked" and select this project folder.

Usage:
1. Click the extension toolbar button while on a page containing an MCQ.
2. The extension will scan the page for an MCQ (heuristics: radio groups, lists after question marks, labeled options).
3. It will call the Gemini API. Set your API key in the options page (right-click > Options or via the extension details page) under "GEMINI API KEY".

Notes and assumptions:
- The extension stores the API key in chrome.storage.sync as `GEMINI_API_KEY`.
- The request uses the endpoint:
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
  with header `x-goog-api-key` and the JSON payload matching the user's example.
- The extension uses some heuristics to find MCQs; it may not find every possible question layout. If none found, it shows "Night Mode is ON".

Security:
- Storing API keys in extension storage has risks; consider rotating keys or using a secure backend in production.
