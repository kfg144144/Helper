// Content script: scans the page for MCQs and displays a transient overlay with result

// Listen for a scan request from background (toolbar button click)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.action === 'scan-mcq') {
    // Only perform Gemini API calls when the message explicitly sets `forced: true`.
    // This ensures the call is made only via the command/shortcut or other forced paths.
    console.log('[content] onMessage scan-mcq received forced=', !!message.forced);
    if (message.forced === true) {
      console.log('[content] triggering forced scan');
      triggerScanImmediate(true);
    }
    sendResponse({ ok: true });
  }
});

// Simple normalizer used to compare option strings
function normalizeText(s) {
  return (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
}

// Allow test pages to trigger a scan via window.postMessage({ type: 'MCQ_SCAN' })
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  // Only trigger when forced:true is present in the message
  if (msg && msg.type === 'MCQ_SCAN' && msg.forced === true) {
    console.log('[content] received window forced MCQ_SCAN');
    triggerScanImmediate(true);
  }
});

// Auto-scan on load and on DOM changes. Debounced to avoid spamming requests.
let _debounceTimer = null;
let _lastCallTs = 0;
let _lastFoundHash = null;
const DEBOUNCE_MS = 1500; // wait before sending a new scan after DOM change
const MIN_INTERVAL_MS = 3000; // minimum time between Gemini calls

// Auto-scanning is disabled for keyboard-only mode, so remove debounced automatic
// scans. If you want to re-enable, call triggerScanDebounced() from appropriate
// places or add a toggle setting.
function triggerScanDebounced() {
  // No-op; only forced triggers will call Gemini
}

function triggerScanImmediate(force = false) {
  const now = Date.now();
  if (!force && now - _lastCallTs < MIN_INTERVAL_MS) {
    // too soon since last call
    return;
  }

  const found = scanForMCQ();
  if (!found) {
    // Only show 'N/A' if question changed or force requested
    const hash = JSON.stringify({ q: null, o: [] });
    if (force || hash !== _lastFoundHash) {
      showTransientMessage('N/A');
      _lastFoundHash = hash;
      _lastCallTs = now;
    }
    return;
  }

  const hash = JSON.stringify({ q: found.question, o: found.options });
  if (!force && hash === _lastFoundHash) {
    // same question/options as last time, skip
    return;
  }

  _lastFoundHash = hash;
  _lastCallTs = now;

  // Send question and options to background to call Gemini
  chrome.runtime.sendMessage({ action: 'ask-gemini', question: found.question, options: found.options }, (resp) => {
    const show = (text) => showTransientMessage(text);

    if (!resp || !resp.ok || !resp.answer) {
      show('N/A');
      return;
    }

    // Map the returned answer text to an option index/letter (a, b, c...)
    const returned = resp.answer;
    const normReturned = normalizeText(returned);

    // 1) If returned is a single letter like 'A' or 'b', use it
    const letterMatch = normReturned.match(/^([a-z])\)?$/i);
    if (letterMatch) {
      show(letterMatch[1].toLowerCase());
      return;
    }

    // 2) Try to match returned text to one of the extracted options
    let letter = null;
    for (let i = 0; i < found.options.length; i++) {
      const opt = found.options[i];
      const normOpt = normalizeText(opt);
      if (normOpt === normReturned || normOpt.includes(normReturned) || normReturned.includes(normOpt)) {
        letter = String.fromCharCode(97 + i); // a, b, c...
        break;
      }
    }

    // 3) As a fallback, if returned contains an uppercase letter like 'A) Paris', pick that
    if (!letter) {
      for (let i = 0; i < found.options.length; i++) {
        const letterToken = String.fromCharCode(65 + i).toLowerCase();
        if (normReturned.includes(letterToken)) {
          letter = String.fromCharCode(97 + i);
          break;
        }
      }
    }

    show(letter || 'N/A');
  });
}

// Initial load does not trigger scanning in keyboard-only mode.

// Observe DOM changes to detect new questions (subtree changes + added nodes + characterData)
const observer = new MutationObserver(() => {
  triggerScanDebounced();
});
observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });


// Heuristics to find MCQ: try radio groups, then lists after question marks, then labeled options
function scanForMCQ() {
  // 1) Radio input groups
  const radios = Array.from(document.querySelectorAll('input[type=radio]'));
  if (radios.length) {
    // group by name
    const byName = {};
    for (const r of radios) {
      const name = r.name || '__no_name__';
      byName[name] = byName[name] || [];
      byName[name].push(r);
    }

    for (const name of Object.keys(byName)) {
      const group = byName[name];
      if (group.length >= 2) {
        // try to find a question text: nearest previous heading or text node
        const question = findNearestQuestionText(group[0]);
        const options = group.map((r) => {
          const label = findLabelForInput(r);
          return label || (r.nextSibling ? r.nextSibling.textContent : '') || r.value || '';
        }).filter(Boolean);
        if (options.length >= 2) return { question: question || '', options };
      }
    }
  }

  // 2) Lists near question mark
  const allTextNodes = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, div, span'));
  for (const el of allTextNodes) {
    const txt = (el.textContent || '').trim();
    if (txt.includes('?') && txt.length < 400) {
      // look for next sibling list or ul/ol within same container
      let list = null;
      if (el.nextElementSibling && (el.nextElementSibling.tagName.toLowerCase() === 'ul' || el.nextElementSibling.tagName.toLowerCase() === 'ol')) {
        list = el.nextElementSibling;
      } else {
        list = el.querySelector('ul, ol');
      }
      if (list) {
        const lis = Array.from(list.querySelectorAll('li')).map(li => li.textContent.trim()).filter(Boolean);
        if (lis.length >= 2) return { question: txt, options: lis };
      }
    }
  }

  // 3) Look for groups of adjacent elements that look like options (short lines)
  const candidates = Array.from(document.querySelectorAll('li, .option, .choices, .choice, label'));
  if (candidates.length >= 2) {
    // find nearest preceding text node for question
    const first = candidates[0];
    const question = findNearestQuestionText(first);
    const options = candidates.slice(0, 10).map(c => c.textContent.trim()).filter(Boolean);
    if (options.length >= 2) return { question: question || '', options };
  }

  return null;
}

function findNearestQuestionText(el) {
  // Walk backwards siblings and parent to find text containing a question mark or a heading
  let curr = el;
  for (let i = 0; i < 6 && curr; i++) {
    // previous siblings
    let ps = curr.previousElementSibling;
    while (ps) {
      const txt = (ps.textContent || '').trim();
      if (txt && (txt.includes('?') || /^h[1-6]$/i.test(ps.tagName))) return txt;
      ps = ps.previousElementSibling;
    }
    curr = curr.parentElement;
    if (!curr) break;
    const txt = (curr.textContent || '').trim();
    if (txt && (txt.includes('?') || /^h[1-6]$/i.test(curr.tagName))) return txt;
  }
  return null;
}

function findLabelForInput(input) {
  // first try for label[for]
  if (input.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (lbl) return lbl.textContent.trim();
  }
  // try parent label
  let p = input.parentElement;
  for (let i = 0; i < 3 && p; i++) {
    if (p.tagName && p.tagName.toLowerCase() === 'label') return p.textContent.trim();
    p = p.parentElement;
  }
  // try next sibling text
  if (input.nextSibling && input.nextSibling.textContent) return input.nextSibling.textContent.trim();
  return null;
}

// Create and show a transient overlay message for 1 second
function showTransientMessage(text) {
  // remove any existing
  const existing = document.getElementById('__mcg_overlay__');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = '__mcg_overlay__';
  div.textContent = text;
  Object.assign(div.style, {
    position: 'fixed',
    bottom: '10%',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.85)',
    color: 'white',
    padding: '10px 16px',
    borderRadius: '8px',
    zIndex: 2147483647,
    fontSize: '16px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.5)'
  });
  document.documentElement.appendChild(div);

  setTimeout(() => {
    div.remove();
  }, 1000);
}
