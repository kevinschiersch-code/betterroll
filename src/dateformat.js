// dateformat.js – Datum/Uhrzeit im Kalender auf deutsche Schreibweise umstellen: "10/17" -> "17.10.", "5:00pm" -> "17:00".
// Nur Textknoten, die komplett aus Datum bzw. Uhrzeit bestehen, damit Titel unangetastet bleiben.
const CRLF_DATE_RE = /^(\s*)(\d{1,2})\/(\d{1,2})(\s*)$/;
const CRLF_TIME_RE = /^(\s*)(\d{1,2}):(\d{2})\s?(am|pm)(\s*)$/i;
const crlfOriginalText = new WeakMap(); // Textknoten -> Originaltext
let crlfDateFormat = "de";
let crlfDateActive = true; // Hauptschalter des Add-ons

// „10/17 · 5:00pm“ -> „17.10. · 17:00“ (null, wenn kein Datum/keine Uhrzeit erkannt)
function crlfToGerman(text) {
  let m = text.match(CRLF_DATE_RE);
  if (m) return `${m[1]}${m[3].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[4]}`;
  m = text.match(CRLF_TIME_RE);
  if (m) {
    let h = +m[2] % 12;
    if (m[4].toLowerCase() === "pm") h += 12;
    return `${m[1]}${String(h).padStart(2, "0")}:${m[3]}${m[5]}`;
  }
  return null;
}

// einen Text-Knoten umstellen bzw. auf das Original zurücksetzen
function crlfFormatNode(node) {
  const known = crlfOriginalText.get(node);
  if (crlfDateActive && crlfDateFormat === "de") {
    // Seite hat den Text inzwischen selbst geändert? Dann neu als Original übernehmen
    const original = known && known.converted === node.data ? known.original : node.data;
    const converted = crlfToGerman(original);
    if (converted === null) return;
    crlfOriginalText.set(node, { original, converted });
    if (node.data !== converted) node.data = converted;
  } else if (known && known.converted === node.data) {
    node.data = known.original;
    crlfOriginalText.delete(node);
  }
}

// alle Text-Knoten unter root umstellen (eigene Knöpfe und Eingabefelder ausgenommen)
function crlfFormatTree(root) {
  if (root.nodeType === 3) return crlfFormatNode(root);
  if (root.nodeType !== 1 || root.closest(".crlf-actions, #crlf-theme-toggle, #crlf-tools, script, style, input, textarea")) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) crlfFormatNode(n);
}

chrome.storage.sync.get({ dateFormat: "de", active: true }, ({ dateFormat, active }) => {
  crlfDateFormat = dateFormat;
  crlfDateActive = active;
  crlfFormatTree(document.body);
  new MutationObserver((muts) => crlfTime("Datumsformat", () => {
    for (const m of muts) {
      if (m.type === "characterData") crlfFormatNode(m.target);
      else m.addedNodes.forEach(crlfFormatTree);
    }
  })).observe(document.body, { childList: true, subtree: true, characterData: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(changes.dateFormat || changes.active)) return;
  if (changes.dateFormat) crlfDateFormat = changes.dateFormat.newValue;
  if (changes.active) crlfDateActive = changes.active.newValue;
  crlfFormatTree(document.body);
});
