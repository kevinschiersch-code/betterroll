// theme.js – Design des Kalenders (Hell, Dunkel, Aurora, Glow, Raster, eigenes Bild, Video) und die eigene Vorschau-Karte.
// Läuft schon bei document_start, damit die Seite möglichst ohne hellen Blitz dunkel lädt.
//
// Abschnitte (seit 1.86.24 auf mehrere Dateien verteilt, Reihenfolge wie im Manifest):
//   1. Design an/aus und Farben lesen                                   theme.js
//   2. Flächen und Texte der Seite einordnen (Klassen crlf-s1/s2/fg/…, wirken nur im Dunkelmodus)   theme.js
//   3. Hintergrund freilegen (große deckende Flächen durchsichtig machen)   theme.js
//   4. Bewertungen für die Vorschau (Crunchyroll-Sterne und AniList)     theme-rating.js
//   5. Eigene Vorschau-Karte (.crlf-peek) statt der Einblendung der Seite  theme-peek.js
//   7. Eigenes Hintergrundbild (Design „Bild“)                           theme-bg.js
//   8. Animierter Hintergrund (Design „Video“)                           theme-bg.js
//   6. Start, Beobachter und Einstellungen                               theme-start.js (zuletzt)
//
// Eigene Texte (Vorschau, Bewertungszeilen, Knopf-Titel) laufen über T() aus i18n.js.
//
// Das Kalender-Markup ist nicht vollständig bekannt: helle Flächen und dunkle Texte werden deshalb
// einmalig erkannt und mit Klassen versehen, die nur im Dunkelmodus (html.crlf-dark) wirken.

// ===== 1. Design an/aus und Farben lesen =====
let crlfTheme = "dark";
let crlfActive = true; // Hauptschalter des Add-ons
let crlfBg = "aurora"; // Hintergrund: aurora | glow | grid | banner (eigenes Bild) | video | off
const CRLF_BGS = ["aurora", "glow", "grid", "banner", "video"];
// Motive des Designs „Video“ (backgrounds/<name>.webm, Standbild backgrounds/blur/<name>.jpg)
const CRLF_VIDEOS = ["haus_1", "baum_1", "altstadt_2", "leuchtturm_1", "regen_1", "dach_1", "bahnsteig_1", "kirsch_1"];
let crlfVideo = "auto"; // ein Name aus CRLF_VIDEOS oder "auto" (wechselnd)

// Klassen am <html> setzen: crlf-themed (Add-on an), crlf-dark, crlf-bg + crlf-bg-<name> (Hintergrund-Design)
function crlfApplyTheme(theme) {
  document.documentElement.classList.toggle("crlf-themed", crlfActive);
  document.documentElement.classList.toggle("crlf-dark", crlfActive && theme === "dark");
  // Hintergrund-Designs (Aurora, Glow, Raster, Bild, Video) sind dunkle Designs; im hellen Modus aus
  const bgOn = crlfActive && theme === "dark" && CRLF_BGS.includes(crlfBg);
  document.documentElement.classList.toggle("crlf-bg", bgOn);
  for (const b of CRLF_BGS) document.documentElement.classList.toggle(`crlf-bg-${b}`, bgOn && b === crlfBg);
  if (bgOn && document.body) crlfClearCovers();
  crlfBannerSync();
  crlfVideoSync();
  // erst nach dem ersten Einfärben prüfen, sonst gelten die Originalfarben der Seite
  if (crlfActive && theme === "dark" && document.body && document.body.dataset.crlfC) crlfFixContrast(document.body);
  const btn = document.getElementById("crlf-theme-toggle");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀" : "☾";
    btn.title = T("Kalender hell/dunkel umschalten"); // Sprache steht evtl. erst nach dem Anlegen fest
    btn.hidden = !crlfActive;
  }
}

// Moderne Farbformate (oklch, lab, color(...)) über eine 1×1-Canvas nach rgb umrechnen, mit Zwischenspeicher
const crlfColorCache = new Map();
let crlfCtx = null;
function crlfToRgb(c) {
  if (crlfColorCache.has(c)) return crlfColorCache.get(c);
  let out = null;
  try {
    crlfCtx = crlfCtx || Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    crlfCtx.clearRect(0, 0, 1, 1);
    crlfCtx.fillStyle = "#000";
    crlfCtx.fillStyle = c;
    crlfCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = crlfCtx.getImageData(0, 0, 1, 1).data;
    out = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  } catch (e) {}
  if (crlfColorCache.size > 500) crlfColorCache.clear();
  crlfColorCache.set(c, out);
  return out;
}

// Farbe lesen: { r, g, b, a, lum (Helligkeit 0..1), gray (fast farblos) } oder null bei durchsichtig/unbekannt
function crlfParse(c) {
  if (!c || c === "transparent") return null;
  let m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (!m && /^(oklch|oklab|lab|lch|color|hsl|hwb)\(/.test(c)) {
    const rgb = crlfToRgb(c);
    m = rgb && rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  }
  if (!m) return null;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return { r, g, b, a: m[4] === undefined ? 1 : +m[4], lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, gray: Math.max(r, g, b) - Math.min(r, g, b) < 28 };
}

// Abrufe bei crunchyroll.com so, wie die Seite sie selbst macht (gleiche Herkunft, eigene Cookies des Nutzers bleiben
// beim Nutzer). Firefox: content.fetch läuft im Namen der Seite; Chrome: normales fetch. Antworten immer als Text
// lesen, damit Firefox keine Objekte aus der Seite durchreicht.
const crlfFetch = typeof content !== "undefined" && content && typeof content.fetch === "function"
  ? (url, init) => content.fetch(url, init)
  : (url, init) => fetch(url, init);
// Serienseite je Adresse nur einmal laden: Sterne und volle Beschreibung teilen sich den Abruf (10 Min. gemerkt, Fehler 1 Min.)
const crlfPageMem = new Map();
function crlfSeriesPage(url) {
  if (!crlfPageMem.has(url)) {
    const job = crlfFetch(url, { credentials: "include" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    crlfPageMem.set(url, job);
    job.then((t) => setTimeout(() => { if (crlfPageMem.get(url) === job) crlfPageMem.delete(url); }, t ? 600000 : 60000));
  }
  return crlfPageMem.get(url);
}

// ===== 2. Flächen und Texte der Seite einordnen =====
// eigene Elemente und Bilder nie umfärben
const CRLF_SKIP = "img, svg, video, picture, iframe, canvas, #crlf-video, #crlf-video *, #crlf-theme-toggle, #crlf-tools, #crlf-tools *, .crlf-actions, .crlf-actions *, .crlf-cpanel, .crlf-cpanel *, .crlf-peek, .crlf-peek *, progress, progress *, .crlf-pbar, .crlf-pbar *";

// eigene Elemente von BetterRoll (Änderungen daran lösen keine Suche/Prüfung aus)
const CRLF_OWN = ".crlf-cpanel, .crlf-peek, #crlf-video, #crlf-banner, #crlf-tools, #crlf-theme-toggle, .crlf-actions, .crlf-btn, .crlf-alt, .crlf-meta, .crlf-nofav, .crlf-timerow, .crlf-pbar, .crlf-pop-rating";
// betrifft die Änderung (MutationRecord) nur eigene Elemente?
function crlfOwnMutation(m) {
  const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
  if (el && el.closest(CRLF_OWN)) return true;
  if (m.type !== "childList") return false;
  const nodes = [...m.addedNodes, ...m.removedNodes];
  return nodes.length > 0 && nodes.every((n) => n.nodeType === 1 && n.matches(CRLF_OWN));
}

// Ein Element einmalig einordnen (data-crlf-c merkt „schon erledigt“):
// crlf-s1/s2 = helle Fläche, crlf-fg/fg2 = dunkler/mittlerer Text, crlf-bd = heller Rahmen, crlf-sh = Schatten,
// crlf-gr = heller Verlauf, crlf-pb/pa = helle Fläche in ::before/::after
// Nur lesen: liefert die Klassen; gesetzt werden sie gesammelt in crlfClassifyTree (sonst erzwingt jedes Setzen vor dem
// nächsten getComputedStyle eine neue Stilberechnung der ganzen Seite)
function crlfClassify(el) {
  const add = [];
  const cs = getComputedStyle(el);
  const bg = crlfParse(cs.backgroundColor);
  // nur einfarbige Flächen: Hintergrundbilder (z. B. Vorschaubilder) bleiben unangetastet
  // helle Verläufe (z. B. weiße Ränder/Ausblendungen am Seitenrand) entfernen, echte Bilder (url) behalten
  const gradientOnly = cs.backgroundImage.includes("gradient(") && !cs.backgroundImage.includes("url(");
  if (gradientOnly) add.push("crlf-gr", "crlf-s1");
  if (bg && bg.a > 0.5 && bg.gray && (cs.backgroundImage === "none" || gradientOnly)) {
    if (bg.lum >= 0.97) add.push("crlf-s2");
    else if (bg.lum >= 0.6) add.push("crlf-s1");
  }
  const fg = crlfParse(cs.color);
  if (fg && fg.gray) {
    if (fg.lum < 0.3) add.push("crlf-fg");
    else if (fg.lum < 0.75) add.push("crlf-fg2");
  }
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    const bc = crlfParse(cs[`border${side}Color`]);
    if (parseFloat(cs[`border${side}Width`]) > 0 && bc && bc.gray && bc.lum > 0.6) { add.push("crlf-bd"); break; }
  }
  if (cs.boxShadow !== "none") add.push("crlf-sh");
  // Verläufe/helle Flächen in ::before/::after (z. B. weiße Ränder links/rechts am Kalender)
  for (const [pseudo, cls] of [["::before", "crlf-pb"], ["::after", "crlf-pa"]]) {
    const ps = getComputedStyle(el, pseudo);
    if (ps.content === "none" || ps.content === "normal") continue;
    const pbg = crlfParse(ps.backgroundColor);
    const light = pbg && pbg.a > 0.3 && pbg.gray && pbg.lum > 0.6;
    const grad = ps.backgroundImage.includes("gradient(") && !ps.backgroundImage.includes("url(");
    if (light || grad || ps.boxShadow !== "none") add.push(cls);
  }
  return add;
}

// Teilbäume einordnen (ein Element oder eine Liste): erst alle Farben lesen, dann alle Klassen setzen.
// original = Farben selbst mit crlfWithOriginalColors lesen, aber nur, wenn es überhaupt etwas Neues gibt (das
// Umschalten lässt den Browser die ganze Seite neu berechnen)
function crlfClassifyTree(roots, original = false) {
  const set = new Set();
  for (const root of [].concat(roots)) {
    if (!root || root.nodeType !== 1) continue;
    for (const el of [root, ...root.querySelectorAll("*")]) if (!el.dataset.crlfC && !el.matches(CRLF_SKIP)) set.add(el);
  }
  const els = [...set];
  if (!els.length) return;
  let found;
  if (original) crlfWithOriginalColors(() => { found = els.map(crlfClassify); });
  else found = els.map(crlfClassify);
  els.forEach((el, i) => {
    el.dataset.crlfC = "1";
    if (found[i].length) el.classList.add(...found[i]);
  });
}

// Nach dem Einfärben im Dunkelmodus: Texte, die trotzdem zu dunkel oder fast durchsichtig sind, aufhellen
// (ein Element oder eine Liste; erst alles lesen, dann gesammelt crlf-hi setzen)
function crlfFixContrast(roots) {
  if (!document.documentElement.classList.contains("crlf-dark")) return;
  const hi = new Set();
  const seen = new Set();
  const dimmed = (s) => parseFloat(s.opacity) < 0.6 || /opacity|brightness|grayscale/.test(s.filter) || s.mixBlendMode !== "normal";
  const hulls = new Set(); // Hüllen schon geprüft
  for (const root of [].concat(roots)) {
    if (!root || root.nodeType !== 1 || !root.isConnected) continue;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.matches(CRLF_SKIP) || el.closest(".crlf-dim, .crlf-hidden")) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      // sichtbare Textfarbe: -webkit-text-fill-color hat Vorrang vor color
      const fg = crlfParse(cs.webkitTextFillColor) || crlfParse(cs.color);
      if ((fg && fg.a < 0.5) || dimmed(cs) || crlfLowContrast(el, fg)) hi.add(el);
      // blass wirkende Beschriftungen kommen oft von durchsichtigen/gefilterten Hüllen (z. B. ausgewählter Tag,
      // Menüpunkte in der Kopfleiste): ganze Kette bis zum body prüfen, Hüllen mit Bildern auslassen
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.classList.contains("crlf-dim")) break;
        if (hulls.has(p)) continue;
        hulls.add(p);
        if (p.querySelector("img, video, picture")) continue;
        if (dimmed(getComputedStyle(p))) hi.add(p);
      }
    }
  }
  for (const el of hi) el.classList.add("crlf-hi");
}

// Kontrast Text gegen die nächste deckende Hintergrundfläche (im Dunkelmodus)
function crlfLowContrast(el, fg) {
  if (!fg) return false;
  for (let p = el; p; p = p.parentElement) {
    const bg = crlfParse(getComputedStyle(p).backgroundColor);
    if (bg && bg.a > 0.5) {
      const l1 = Math.max(fg.lum, bg.lum) + 0.05, l2 = Math.min(fg.lum, bg.lum) + 0.05;
      return l1 / l2 < 3;
    }
  }
  // keine deckende Fläche gefunden: im Dunkelmodus liegt der Text auf dunklem Grund
  return fg.lum < 0.45;
}

// alle Klassen, die die Einordnung vergibt (zum Zurücksetzen)
const CRLF_CLASSES = ["crlf-s1", "crlf-s2", "crlf-fg", "crlf-fg2", "crlf-bd", "crlf-sh", "crlf-gr", "crlf-hi", "crlf-pb", "crlf-pa"];

// Erfassen anhand der Originalfarben: Dunkelmodus kurz abschalten, erfassen, wieder an (ohne Zwischenbild).
// Das Lesen der Farben lässt den Browser den hellen Zustand berechnen; ohne Sperre starteten dabei Übergänge
// (Schatten, 💬, „Folge 3“) auf allen Karten, die danach sichtbar zurückblendeten (Flackern beim Überfahren).
// Daher Übergänge sperren, bis der Browser den dunklen Zustand wieder berechnet hat.
function crlfWithOriginalColors(fn) {
  const root = document.documentElement;
  const was = ["crlf-dark", "crlf-bg"].filter((c) => root.classList.contains(c));
  if (!was.length) return fn();
  root.classList.add("crlf-notrans");
  root.classList.remove(...was);
  try { fn(); } finally {
    root.classList.add(...was);
    getComputedStyle(root).color; // dunklen Zustand berechnen lassen, solange die Sperre gilt
    if (document.body) document.body.offsetWidth;
    root.classList.remove("crlf-notrans");
  }
}

// Einordnung eines Teilbaums verwerfen (z. B. wenn die Seite die Klassen eines Elements tauscht)
function crlfReset(el) {
  for (const n of [el, ...el.querySelectorAll("[data-crlf-c]")]) {
    n.classList.remove(...CRLF_CLASSES);
    delete n.dataset.crlfC;
  }
}

// nur echte Klassenänderungen der Seite zählen, nicht unsere eigenen crlf-Klassen
function crlfSiteClassChanged(m) {
  const strip = (v) => (v || "").split(/\s+/).filter((c) => c && !c.startsWith("crlf-")).sort().join(" ");
  return strip(m.oldValue) !== strip(m.target.getAttribute("class"));
}

// ===== 3. Hintergrund freilegen =====
// Gewählter Hintergrund liegt hinter der Seite: alle großen, deckenden Flächen, die ihn verdecken, durchsichtig machen.
// Gefunden wird per Stichproben über den sichtbaren Bereich; Karten, Bilder und kleine Elemente bleiben unangetastet.
let crlfClearTimer = 0;
function crlfClearCovers() {
  if (!document.documentElement.classList.contains("crlf-bg") || !document.body) return;
  const vw = innerWidth, vh = innerHeight, seen = new Set();
  for (let x = 0.05; x < 1; x += 0.15) for (let y = 0.05; y < 1; y += 0.15) {
    for (const el of document.elementsFromPoint(x * vw, y * vh)) {
      if (el === document.documentElement || el === document.body || seen.has(el)) continue;
      seen.add(el);
      if (el.closest("article.release, .js-release, .crlf-item, img, video, picture, iframe, #crlf-theme-toggle, #crlf-tools, [role=dialog], [role=menu]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.3 && r.height < vh * 0.3) continue;
      if (crlfFloating(el)) continue; // Einblendungen (z. B. Vorschau beim Darüberfahren) behalten ihren Grund
      if (crlfInBar(el, vh)) continue; // feste Kopfleisten bleiben deckend, sonst scheint Inhalt beim Scrollen durch
      const cs = getComputedStyle(el);
      const bg = crlfParse(cs.backgroundColor);
      if ((bg && bg.a > 0.05) || (cs.backgroundImage !== "none" && !cs.backgroundImage.includes("url("))) el.classList.add("crlf-bgclear");
    }
  }
  crlfClearBarItems(vw);
}

// Menüpunkte der Kopfleiste (z. B. „Games“, „Store“) haben teils einen eigenen dunklen Kasten, „Shows“/„News“ nicht:
// kleine, dunkle, einfarbige Flächen mit Text im oberen Streifen durchsichtig machen (beim Darüberfahren leicht hell).
// Eingabefelder, Bilder, farbige Knöpfe (nicht grau) und aufgeklappte Menüs bleiben, wie sie sind.
function crlfClearBarItems(vw) {
  const seen = new Set();
  for (let x = 8; x < vw; x += 24) for (const y of [20, 34, 48]) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === document.documentElement || el === document.body || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.top > 60 || r.height > 90 || r.width > 320) continue;
      if (el.matches("input, textarea, select, img, svg, video, picture") || el.closest("#crlf-theme-toggle, #crlf-tools, [role=dialog], [role=menu]")) continue;
      if (!el.textContent.trim()) continue;
      const bg = crlfParse(getComputedStyle(el).backgroundColor);
      if (bg && bg.a > 0.5 && bg.gray && bg.lum < 0.25) el.classList.add("crlf-barclear");
    }
  }
}

// schwebende Einblendung? (gerade unsichtbar, mit Schatten oder als Ebene über der Seite)
function crlfFloating(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (parseFloat(cs.opacity) < 0.5 || cs.visibility === "hidden") return true;
    if (p.hasAttribute("data-crlf-pop")) return true;
  }
  const cs = getComputedStyle(el);
  return cs.boxShadow !== "none" || ((cs.position === "absolute" || cs.position === "fixed") && parseInt(cs.zIndex) > 0);
}
