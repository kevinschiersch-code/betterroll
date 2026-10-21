// theme-start.js – Start, Beobachter und Einstellungen; kommt als letzte Design-Datei, damit alle Teile geladen sind
// Teil des Kalender-Designs; Reihenfolge der Dateien im Manifest: theme.js, theme-rating.js, theme-peek.js, theme-bg.js, theme-start.js.
// Alle teilen sich einen Bereich (gleiche Variablen und Funktionen wie früher in einer Datei).

// ===== 6. Start, Beobachter und Einstellungen =====

// liegt el in einer fest stehenden, niedrigen Leiste (position fixed/sticky, z. B. Kopfzeile)?
function crlfInBar(el, vh) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const pos = getComputedStyle(p).position;
    if ((pos === "fixed" || pos === "sticky") && p.getBoundingClientRect().height < vh * 0.4) return true;
  }
  return false;
}

// runder Knopf unten rechts: Kalender hell/dunkel
function crlfAddToggle() {
  if (document.getElementById("crlf-theme-toggle")) return;
  const btn = document.createElement("button");
  btn.id = "crlf-theme-toggle";
  btn.type = "button";
  btn.title = T("Kalender hell/dunkel umschalten");
  btn.addEventListener("click", () => chrome.storage.sync.set({ pageTheme: crlfTheme === "dark" ? "light" : "dark" }));
  document.body.appendChild(btn);
  crlfApplyTheme(crlfTheme);
}
// Start, sobald es den body gibt: Knopf ☀/☾ anlegen, Seite einordnen, Hintergrund freilegen, Änderungen beobachten
function crlfStart() {
  crlfAddToggle();
  crlfTime("Design: Start (ganze Seite)", () => { crlfWithOriginalColors(() => crlfClassifyTree(document.body)); crlfFixContrast(document.body); });
  // spät nachgeladene oder per Übergang eingeblendete Teile (z. B. Menü der Kopfleiste) noch einmal prüfen
  for (const ms of [1500, 4000]) setTimeout(() => crlfTime("Design: Nachprüfung (ganze Seite)", () => { crlfFixContrast(document.body); crlfClearCovers(); }), ms);
  crlfClearCovers();
  addEventListener("resize", () => { clearTimeout(crlfClearTimer); crlfClearTimer = setTimeout(crlfClearCovers, 300); });

  let added = [];
  let changed = new Set();
  let scheduled = false;
  const flush = () => crlfTime("Design: neue Teile einfärben", flushNow);
  // Vorschau der Seite, die durch die eigene Vorschau-Karte ersetzt und unsichtbar ist: nicht einfärben
  const visible = (n) => n.isConnected && !n.closest("[data-crlf-hidepop]");
  const flushNow = () => {
    scheduled = false;
    // zuerst die Vorschau der Seite suchen: wird sie übernommen (unsichtbar), entfällt ihr Einfärben
    crlfFindPopups();
    const nodes = added.filter(visible); added = [];
    const roots = [...changed].filter(visible); changed = new Set();
    // z. B. angeklickter Tag als Reiter: Seite tauscht Klassen, Farben neu erfassen
    roots.forEach(crlfReset);
    crlfClassifyTree([...roots, ...nodes], true);
    crlfFixContrast([...roots, ...nodes]);
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") {
        if (m.target.nodeType === 1 && crlfSiteClassChanged(m)) changed.add(m.target);
      } else {
        // eigene Teile (Vorschau, Bewertung, Knöpfe) lösen keinen Einfärbe-Lauf aus
        if (crlfOwnMutation(m)) continue;
        for (const n of m.addedNodes) if (n.nodeType === 1 && !n.dataset.crlfC) added.push(n);
      }
    }
    if ((added.length || changed.size) && !scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
}

// Design aus den Einstellungen laden und bei Änderungen (Popup, ☀/☾-Knopf) sofort umschalten
chrome.storage.sync.get({ pageTheme: "dark", active: true, pageBg: "aurora", pageVideo: "auto" }, ({ pageTheme, active, pageBg, pageVideo }) => {
  crlfVideo = pageVideo;
  crlfTheme = pageTheme;
  crlfActive = active;
  crlfBg = pageBg;
  crlfApplyTheme(pageTheme);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(changes.pageTheme || changes.active || changes.pageBg || changes.pageVideo)) return;
  if (changes.pageVideo) crlfVideo = changes.pageVideo.newValue;
  if (changes.pageBg) crlfBg = changes.pageBg.newValue;
  if (changes.pageTheme) crlfTheme = changes.pageTheme.newValue;
  if (changes.active) crlfActive = changes.active.newValue;
  crlfApplyTheme(crlfTheme);
});

// Start (am Dateiende, damit alle Abschnitte geladen sind)
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", crlfStart);
else crlfStart();
