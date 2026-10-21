// theme.js – Design des Kalenders (Hell, Dunkel, Aurora, Glow, Raster, eigenes Bild, Video) und die eigene Vorschau-Karte.
// Läuft schon bei document_start, damit die Seite möglichst ohne hellen Blitz dunkel lädt.
//
// Abschnitte:
//   1. Design an/aus und Farben lesen
//   2. Flächen und Texte der Seite einordnen (Klassen crlf-s1/s2/fg/…, wirken nur im Dunkelmodus)
//   3. Hintergrund freilegen (große deckende Flächen durchsichtig machen)
//   4. Bewertungen für die Vorschau (Crunchyroll-Sterne und AniList)
//   5. Eigene Vorschau-Karte (.crlf-peek) statt der Einblendung der Seite
//   6. Start, Beobachter und Einstellungen
//   7. Eigenes Hintergrundbild (Design „Bild“)
//   8. Animierter Hintergrund (Design „Video“)
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
const CRLF_VIDEOS = ["haus_1", "haus_2", "baum_1", "baum_2", "altstadt_1", "altstadt_2"];
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

// ===== 4. Bewertungen für die Vorschau =====
// Zwei Werte untereinander: die Sterne von Crunchyroll und das aktuelle AniList-Rating samt Platz in der
// laufenden Season. Gespeichert in storage.local "crRating2" als { "<quelle>|<schlüssel>": { t, v } }.
const crlfRatingMem = new Map(); // laufende/fertige Abfragen dieser Seite (Promise je Schlüssel)
const CRLF_RATING_TTL = 864e5; // AniList: 1 Tag
const CRLF_PURGE = 200 * 864e5; // ältere Einträge beim Speichern entfernen
// Crunchyroll-Sterne gelten die ganze Season: bis Season-Ende laut AniList plus drei Wochen,
// mindestens aber Folgenzahl × 1 Woche + 2 Wochen bzw. 90 Tage
function crlfCrValid(al) {
  return (hit) => {
    const age = Date.now() - hit.t;
    const byEpisodes = al && al.episodes ? (al.episodes * 7 + 14) * 864e5 : 0;
    if (age < Math.max(90 * 864e5, byEpisodes)) return true;
    return !!(al && al.end && Date.now() < al.end + 21 * 864e5);
  };
}
// neue Bewertung von einer Serienseite (series.js): nicht auf alte Fehlermeldungen im Speicher warten.
// Nur geänderte Crunchyroll-Einträge vergessen; laufende AniList-Abfragen bleiben.
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local" || !c.crRating2) return;
  const before = c.crRating2.oldValue || {}, after = c.crRating2.newValue || {};
  for (const id of Object.keys(after)) if (id.startsWith("cr|") && (!before[id] || before[id].t !== after[id].t)) crlfRatingMem.delete(id);
});
// Schreibzugriffe auf crRating2 nacheinander, damit parallele Abfragen sich nicht gegenseitig überschreiben
let crlfRatingWrite = Promise.resolve();
// (gespeichert wird der deutsche Name; übersetzt erst bei der Anzeige, siehe crlfRatingBox)
const CRLF_SEASONS = { WINTER: "Winter", SPRING: "Frühling", SUMMER: "Sommer", FALL: "Herbst" };

// Bewertung aus dem HTML einer Serienseite (strukturierte Daten bzw. eingebetteter Seitenzustand)
function crlfRatingFromHtml(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== "object") return null;
        if (o.aggregateRating && o.aggregateRating.ratingValue) return o.aggregateRating;
        for (const v of Object.values(o)) { const r = walk(v); if (r) return r; }
        return null;
      };
      const ar = walk(JSON.parse(m[1]));
      if (ar) return { value: +ar.ratingValue, count: +(ar.ratingCount || ar.reviewCount || 0), best: +(ar.bestRating || 5) };
    } catch (e) {}
  }
  // eingebetteter Seitenzustand (z. B. "rating":{"average":"4.9","total":12345})
  const m = html.match(/"average"\s*:\s*"?(\d(?:\.\d+)?)"?\s*,\s*"total"\s*:\s*"?(\d+)/);
  return m ? { value: +m[1], count: +m[2], best: 5 } : null;
}

// AniList: Durchschnittsnote, Mitglieder, Platz in der Season (bestbewertet vor beliebteste) und Start der nächsten
// Staffel. Anime per Abgleich (match.js) statt erstem Suchtreffer.
const CRLF_REL = "relations{edges{relationType node{id type format status season seasonYear startDate{year month day}}}}";
async function crlfAniListRating(name, en) {
  if (typeof alSearch !== "function" || typeof anilist !== "function") return null;
  const results = await alSearch(name);
  // englischer Titel aus der Serien-Adresse: deutsche Titel findet AniList oft nicht
  if (en && en.toLowerCase() !== name.toLowerCase()) for (const x of await alSearch(en).catch(() => [])) if (!results.some((y) => y.id === x.id)) results.push(x);
  const media = (typeof crlfBestMatch === "function" && crlfBestMatch(name, results, en)) || results[0];
  if (!media) return null;
  const d = await anilist(`query($id:Int){Media(id:$id){averageScore popularity siteUrl episodes description(asHtml:false) endDate{year month day} rankings{rank type allTime season year} ${CRLF_REL}}}`, { id: media.id });
  const m = d && d.Media;
  if (!m) return null;
  const inSeason = (m.rankings || []).filter((r) => !r.allTime && r.season);
  const rank = inSeason.find((r) => r.type === "RATED") || inSeason.find((r) => r.type === "POPULAR");
  const e = m.endDate || {};
  return { value: m.averageScore || 0, count: m.popularity || 0, url: m.siteUrl, episodes: m.episodes || 0, desc: crlfCleanDesc(m.description),
    end: e.year && e.month ? Date.UTC(e.year, e.month - 1, e.day || 28) : 0,
    rank: rank ? { n: rank.rank, rated: rank.type === "RATED", season: `${CRLF_SEASONS[rank.season] || ""} ${rank.year || ""}`.trim() } : null,
    next: await crlfNextSeason(m).catch(() => null) };
}
// AniList-Beschreibung lesbar machen: ohne HTML-Reste und Quellenangabe, höchstens ~500 Zeichen (am Satzende gekürzt)
function crlfCleanDesc(t) {
  if (!t) return "";
  t = t.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\((?:Source|Quelle)[^)]*\)/gi, "").replace(/\[Written by[^\]]*\]/gi, "")
    .replace(/\bNote:.*$/is, "").replace(/\s+/g, " ").trim();
  if (t.length <= 520) return t;
  const cut = t.slice(0, 520), end = cut.lastIndexOf(". ");
  return (end > 200 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, "") + " …");
}
// AniList-Daten einer Serie (Note, Mitglieder, nächste Staffel, Beschreibung) – einmal je Serie, für Bewertung und Beschreibung
function crlfAniListJob(name, url) {
  const en = url && ((url.match(/\/series\/[^/?#]+\/([a-z0-9-]+)/i) || [])[1] || "").replace(/-+/g, " ").trim();
  return name ? crlfCachedRating("al3", name.toLowerCase(), () => crlfAniListRating(name, en)) : Promise.resolve(null);
}

// Nächste Staffel: der Fortsetzungs-Kette (SEQUEL, Serie) folgen, bis eine noch nicht gestartete kommt (höchstens 4 Schritte).
// Ergebnis { y, m, d, season } – so genau, wie AniList es kennt; null, wenn kein Termin bekannt ist.
async function crlfNextSeason(m) {
  for (let hop = 0; m && hop < 4; hop++) {
    const edge = ((m.relations && m.relations.edges) || []).find((x) => x.relationType === "SEQUEL" && x.node && x.node.type === "ANIME" && /^(TV|TV_SHORT|ONA)$/.test(x.node.format || ""));
    if (!edge) return null;
    const n = edge.node, sd = n.startDate || {};
    const future = n.status === "NOT_YET_RELEASED" || (sd.year && Date.UTC(sd.year, (sd.month || 12) - 1, sd.day || 28) > Date.now());
    if (future) return sd.year || n.seasonYear ? { y: sd.year || n.seasonYear, m: sd.month || 0, d: sd.day || 0, season: n.season || "" } : null;
    const r = await anilist(`query($id:Int){Media(id:$id){${CRLF_REL}}}`, { id: n.id });
    m = r && r.Media;
  }
  return null;
}
// Termin als Text: „12.01.2027“, „Januar 2027“, „Winter 2027“ oder „2027“
function crlfNextText(n) {
  if (!n || !n.y) return "";
  if (n.m && n.d) return new Date(Date.UTC(n.y, n.m - 1, n.d)).toLocaleDateString(crlfLocale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  if (n.m) return new Date(Date.UTC(n.y, n.m - 1, 1)).toLocaleDateString(crlfLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  return n.season ? `${T(CRLF_SEASONS[n.season] || "")} ${n.y}`.trim() : String(n.y);
}

// Ein Wert pro Quelle und Serie, unabhängig voneinander geladen: was zuerst da ist, wird gleich angezeigt
function crlfCachedRating(kind, key, load, valid) {
  const id = `${kind}|${key}`;
  if (crlfRatingMem.has(id)) return crlfRatingMem.get(id);
  const job = (async () => {
    const { crRating2: store = {} } = await chrome.storage.local.get("crRating2");
    const hit = store[id];
    if (hit && (valid ? valid(hit) : Date.now() - hit.t < CRLF_RATING_TTL)) return hit.v;
    const v = await load().catch(() => null);
    // nur Treffer speichern (sonst beim nächsten Mal erneut versuchen)
    if (v && !v.error) {
      crlfRatingWrite = crlfRatingWrite.then(async () => {
        const { crRating2: cur = {} } = await chrome.storage.local.get("crRating2");
        for (const [k, e] of Object.entries(cur)) if (Date.now() - e.t > CRLF_PURGE) delete cur[k];
        cur[id] = { t: Date.now(), v };
        await chrome.storage.local.set({ crRating2: cur });
      }).catch((e) => crlfError("Bewertung speichern", e));
    }
    if (!v || v.error) setTimeout(() => { if (crlfRatingMem.get(id) === job) crlfRatingMem.delete(id); }, 60000); // später erneut versuchen
    return v;
  })();
  crlfRatingMem.set(id, job);
  return job;
}

// Crunchyroll-Sterne einer Serie: aus dem HTML der öffentlichen Serienseite (wie ein normaler Seitenaufruf).
// Klappt das nicht, hilft series.js: es merkt sich die Bewertung, sobald man die Serienseite einmal öffnet.
async function crlfCrunchyrollRating(url) {
  try {
    const html = await crlfSeriesPage(url);
    if (html) {
      const r = crlfRatingFromHtml(html);
      if (r && r.value) return r;
    }
  } catch (e) {}
  return { error: "noch nicht bekannt. Serienseite einmal öffnen, dann steht sie hier", open: url };
}

// Bewertungszeilen „Crunchyroll“ und „Aktuell“; stehen sofort mit Platzhaltern da und füllen sich, sobald Daten da sind
function crlfRatingBox(name, url) {
  const box = document.createElement("div");
  box.className = "crlf-pop-rating";
  box.dataset.key = url || name;
  const r = { cr: undefined, al: undefined };
  const fmt = (n, d) => n.toLocaleString(crlfLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });
  const NB = "\u00a0";
  const row = (label, value, meta) => {
    const line = document.createElement("div");
    line.className = "crlf-pop-rrow";
    const l = document.createElement("i"); l.textContent = label;
    const b = document.createElement("b"); b.textContent = value;
    const s = document.createElement("small"); s.textContent = meta || NB;
    line.append(l, b, s);
    return line;
  };
  // Beide Zeilen stehen von Anfang an (Platzhalter), damit sich die Größe der Vorschau beim Laden nicht ändert
  const render = () => {
    box.replaceChildren();
    const crOk = r.cr && !r.cr.error;
    const line = row("Crunchyroll", "", "");
    const stars = line.querySelector("b");
    stars.className = "crlf-stars";
    stars.textContent = "★★★★★";
    const num = document.createElement("b");
    stars.after(num);
    if (crOk) {
      const pct = Math.max(0, Math.min(100, (r.cr.value / (r.cr.best || 5)) * 100));
      stars.style.setProperty("--crlf-fill", `${pct}%`);
      const cnt = r.cr.count >= 1e6 ? T("{0} Mio.", fmt(r.cr.count / 1e6, 1)) : r.cr.count >= 1e3 ? T("{0} Tsd.", fmt(r.cr.count / 1e3, 1)) : r.cr.count ? fmt(r.cr.count, 0) : "";
      num.textContent = fmt(r.cr.value, 1);
      line.querySelector("small").textContent = cnt ? T("{0} Bewertungen", cnt) : NB;
    } else {
      stars.style.setProperty("--crlf-fill", "0%");
      num.textContent = "–";
      line.classList.add("crlf-pop-rwait");
      line.querySelector("small").textContent = r.cr === undefined ? T("wird geladen …") : T("noch keine Bewertung");
    }
    box.append(line);
    if (r.al && r.al.value) {
      const season = (r.al.rank && r.al.rank.season || "").replace(/^\S+/, (w) => T(w)); // „Sommer 2026“ -> „Summer 2026“
      const rank = r.al.rank ? `#${r.al.rank.n} ${r.al.rank.rated ? T("bestbewertet") : T("beliebteste")} ${season}`.trim() : "";
      box.append(row(T("Aktuell"), `${r.al.value} %`, [rank, "AniList"].filter(Boolean).join(" · ")));
    } else {
      const w = row(T("Aktuell"), "– %", r.al === undefined ? T("wird geladen …") : T("keine Daten"));
      w.classList.add("crlf-pop-rwait");
      box.append(w);
    }
    // nächste Staffel: Zeile ist immer da (gleiche Höhe der Vorschau), ohne bekannten Termin bleibt sie leer
    const nx = r.al && r.al.next ? crlfNextText(r.al.next) : "";
    const nl = row(T("Nächste Staffel"), nx || NB, nx ? (r.al.next.m && r.al.next.d ? T("Start") : T("ungefährer Start")) + " · AniList" : NB);
    nl.classList.add("crlf-pop-rnext");
    if (!nx) nl.style.visibility = "hidden";
    box.append(nl);
  };
  render();
  const sid = url && (url.match(/\/series\/([A-Z0-9]+)/i) || [])[1];
  const alJob = crlfAniListJob(name, url);
  alJob.then((v) => { r.al = v; render(); });
  // Gültigkeit der Crunchyroll-Sterne hängt an der Season (Folgenzahl/Ende von AniList)
  alJob.catch(() => null).then((al) => sid ? crlfCachedRating("cr", sid, () => crlfCrunchyrollRating(url), crlfCrValid(al)) : null)
    .then((v) => { r.cr = v; render(); });
  return box;
}

// ===== 5. Eigene Vorschau-Karte =====
// Die Vorschau der Seite gibt es in mehreren Varianten (breit, gestapelt, mit/ohne Folgenbild). Statt sie umzubauen,
// werden ihre Inhalte gelesen und in einer schmalen, immer gleich aufgebauten Karte am Rand gezeigt.
// Die Original-Vorschau bleibt (unsichtbar) bestehen; Knöpfe leiten den Klick an sie weiter.
const crlfMouse = { x: -1, y: -1 };
// Handy-Modus (z. B. Firefox für Android): kein Mauszeiger, nur Finger. Dann öffnet langes Tippen auf eine Karte die
// Vorschau als Blatt am unteren Rand; sie bleibt offen, bis man daneben tippt oder ✕ drückt.
const crlfTouch = matchMedia("(hover: none) and (pointer: coarse)").matches;
if (crlfTouch) document.documentElement.setAttribute("data-crlf-touch", "");
// Blatt am unteren Rand des SICHTBAREN Bereichs in Bildschirmgröße, auch wenn die Seite herausgezoomt ist
// (Vorschau: höchstens frac der Höhe; fixed = genau diese Höhe, für das Kommentarfenster)
function crlfFitSheet(el, frac, fixed) {
  if (!crlfTouch || !el || !el.isConnected) return;
  const vv = window.visualViewport, s = (vv && vv.scale) || 1;
  const vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight, ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
  const m = 8 / s, h = vh * s * frac;
  Object.assign(el.style, { transformOrigin: "0 0", transform: Math.abs(s - 1) > 0.01 ? `scale(${1 / s})` : "", width: `${vw * s - 16}px`,
    left: `${ox + m}px`, right: "auto", bottom: "auto", maxHeight: `${h}px`, height: fixed ? `${h}px` : "" });
  el.style.top = `${oy + vh - el.offsetHeight / s - m}px`;
}
if (crlfTouch && window.visualViewport) for (const type of ["resize", "scroll"]) visualViewport.addEventListener(type, () => {
  crlfFitSheet(crlfPeekEl, 0.8);
  if (typeof commentPanel !== "undefined") crlfFitSheet(commentPanel, 0.85, true);
}, { passive: true });
addEventListener("mousemove", (e) => { crlfMouse.x = e.clientX; crlfMouse.y = e.clientY; }, { capture: true, passive: true });
let crlfPeekEl = null, crlfPeekSrc = null, crlfPeekKey = "", crlfPeekWatch = 0, crlfHoverCard = null, crlfPeekRO = null, crlfPeekCard = null, crlfPeekSeen = 0;

// Neben die Karte setzen (rechts, sonst links – wo Platz ist) und immer ganz im Bild halten: oben/unten verschieben;
// passt es in der Höhe nicht, erst breiter, dann kleinere Schrift statt Scrollen.
// Ein offenes Kommentar-Panel zählt wie der Bildschirmrand; passt die Vorschau nirgends daneben, liegt sie darüber.
function crlfPlacePeek() {
  const p = crlfPeekEl;
  if (!p || !p.isConnected) return;
  if (crlfTouch) { crlfFitSheet(p, 0.8); return; } // Handy: Blatt am unteren Rand
  const cp = document.querySelector(".crlf-cpanel");
  const cpLeft = cp && cp.offsetWidth ? cp.getBoundingClientRect().left : Infinity;
  const vw = Math.min(document.documentElement.clientWidth, cpLeft), vh = innerHeight, m = 8, gap = 12;
  for (const step of ["", "crlf-pk-wide", "crlf-pk-wide crlf-pk-small", "crlf-pk-wide crlf-pk-small crlf-pk-tiny"]) {
    p.classList.remove("crlf-pk-wide", "crlf-pk-small", "crlf-pk-tiny");
    if (step) p.classList.add(...step.split(" "));
    if (p.offsetHeight <= vh - 2 * m) break;
  }
  const w = p.offsetWidth, h = p.offsetHeight;
  const card = crlfHoverCard && crlfHoverCard.isConnected ? crlfHoverCard.getBoundingClientRect() : null;
  let left, top;
  if (card) {
    const roomR = vw - m - card.right - gap, roomL = card.left - gap - m;
    const right = roomR >= w || roomR >= roomL;
    left = right ? card.right + gap : card.left - gap - w;
    p.dataset.side = right ? "right" : "left";
    top = card.top;
  } else { left = vw - m - w; top = m; }
  // passt sie weder links noch rechts neben die Karte, ohne das Panel zu berühren: rechts daneben über das Panel legen
  const fullW = document.documentElement.clientWidth;
  if (card && cpLeft < Infinity && card.right + gap + w > vw - m && card.left - gap - w < m) left = Math.min(card.right + gap, fullW - m - w);
  else left = Math.min(left, vw - m - w);
  left = Math.max(m, left);
  top = Math.max(m, Math.min(top, vh - m - h));
  p.classList.toggle("crlf-pk-over", left + w > cpLeft); // nie unter dem Panel verschwinden
  p.style.left = `${Math.round(left)}px`;
  p.style.top = `${Math.round(top)}px`;
}

// Ersatz-Beschreibung von AniList (englisch), wenn die Seite keine liefert (ihre Serienseite enthält keine).
// Füllt den Platzhalter p, sofern er dann noch leer ist.
function crlfPeekAniDesc(p, d) {
  if (!p || p.dataset.crlfAl) return;
  p.dataset.crlfAl = "wait";
  crlfAniListJob(d.name, d.url).then((al) => {
    if (!p.isConnected || p.textContent || !al || !al.desc) return;
    crlfPeekDescText(p, al.desc, true);
  }).catch(() => {});
}
// Beschreibungstext setzen; al = von AniList (kleiner Hinweis dahinter)
function crlfPeekDescText(p, text, al) {
  p.textContent = text;
  p.classList.remove("crlf-pk-ph");
  p.dataset.crlfAl = al ? "1" : "";
  if (al) { const s = document.createElement("small"); s.className = "crlf-pk-src"; s.textContent = " " + T("AniList · englisch"); p.append(s); }
}

// Bildgröße (natürliche Maße bevorzugt) und Adresse, auch bei Lazy-Load (data-src)
function crlfImgInfo(img) {
  const r = img.getBoundingClientRect();
  const w = img.naturalWidth || +img.getAttribute("width") || r.width, h = img.naturalHeight || +img.getAttribute("height") || r.height;
  const src = img.currentSrc || img.getAttribute("src") || img.dataset.src || "";
  return { img, w, h, src: /^data:/.test(src) && img.dataset.src ? img.dataset.src : src };
}

// Bild der Seite noch nicht geladen? (ohne Größe, oder nur ein Platzhalter-Pixel, solange das echte Bild in data-src wartet)
function crlfImgPending(img) {
  const src = img.currentSrc || img.getAttribute("src") || "";
  if (/^data:/.test(src) || !src) return !!img.dataset.src;
  return !img.complete || !img.naturalWidth;
}

// Inhalte aus der Vorschau der Seite lesen: Titel (größte Schrift), Poster (Hochformat), Folgenbild (Querformat),
// Beschreibung, Folgennummer/-titel, Fortschritt und Knöpfe. null, wenn kein Titel erkennbar ist.
function crlfPeekData(pop) {
  const strip = (t) => t.replace(/[^\p{L}\s]/gu, "");
  const buttons = [...pop.querySelectorAll("button, a, [role=button]")].filter((b) => CRLF_POP_RE.test(strip(b.textContent)) && !b.closest(".crlf-peek"));
  const inButton = (e) => buttons.some((b) => b.contains(e));
  // Fortschritt als Text („Progress: 91%“, oft ein versteckter Hinweis neben dem Balken): Wert merken, nicht als Text zeigen
  const PROG_RE = /^(?:progress|fortschritt|angesehen|watched)\s*:?\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/i;
  let progress = null;
  const leaves = [...pop.querySelectorAll("*")].filter((e) => {
    if (e.children.length || !e.textContent.trim() || inButton(e) || e.closest(".crlf-pop-rating, .crlf-season")) return false;
    const m = e.textContent.trim().match(PROG_RE);
    if (m) { if (progress == null) progress = Math.min(1, parseFloat(m[1].replace(",", ".")) / 100); return false; }
    return true;
  });
  let title = null, size = 0;
  for (const e of leaves) {
    const t = e.textContent.trim();
    if (t.length < 2 || /^(serie|series|\d+)$/i.test(t)) continue;
    const cs = getComputedStyle(e);
    const fs = parseFloat(cs.fontSize) * (cs.textTransform === "uppercase" ? 1.1 : 1);
    if (fs > size) { size = fs; title = e; }
  }
  if (!title) return null;
  const imgs = [...pop.querySelectorAll("img")].map(crlfImgInfo).filter((o) => o.src && o.w > 30 && o.h > 30);
  const poster = imgs.filter((o) => o.h > o.w).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  const thumb = imgs.filter((o) => o.w > o.h * 1.2).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  // Bilder, die die Seite noch lädt (Größe unbekannt): dafür hält die Vorschau den Platz frei (crlfPeekBuild)
  const pending = [...pop.querySelectorAll("img")].filter((i) => !i.closest(".crlf-peek") && crlfImgPending(i));
  // Beschreibung: längster Text vor dem Folgenbild (der Folgentitel steht danach)
  const desc = leaves.filter((e) => e !== title && e.textContent.trim().length >= 25 && !(thumb && (thumb.img.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)))
    .sort((a, b) => b.textContent.length - a.textContent.length)[0];
  let epNo = "", epTitle = "";
  if (thumb) {
    // Folgennummer: kurze Zahl im Umfeld des Bildes; Folgentitel: erster Text nach dem Bild
    for (let p = thumb.img.parentElement, i = 0; p && p !== pop && i < 3 && !epNo; p = p.parentElement, i++) {
      const n = [...p.querySelectorAll("*")].find((e) => !e.children.length && /^\d{1,4}$/.test(e.textContent.trim()));
      if (n) epNo = n.textContent.trim();
    }
    const after = leaves.filter((e) => e !== title && e !== desc && (thumb.img.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    const t = after.find((e) => !/^\d{1,4}$/.test(e.textContent.trim()) && e.textContent.trim().length > 1 && !/^(nur für premium|premium|nur mit premium|premium only|members only)$/i.test(e.textContent.trim()));
    if (t) epTitle = t.textContent.trim();
  }
  // sonst aus einem Fortschrittselement (role=progressbar / aria-valuenow / <progress>)
  if (progress == null) {
    const pb = pop.querySelector('[role=progressbar], progress');
    if (pb) {
      const v = parseFloat(pb.getAttribute("aria-valuenow") ?? pb.value), max = parseFloat(pb.getAttribute("aria-valuemax") ?? pb.max) || 100;
      if (v >= 0 && max > 0) progress = Math.min(1, v / max);
    }
  }
  // sonst schmaler, farbiger Balken (Breite laut Stil oder Anteil an der Breite seines Behälters)
  if (progress == null) for (const e of pop.querySelectorAll("div, span")) {
    if (e.closest(".crlf-peek")) continue;
    const sw = (e.getAttribute("style") || "").match(/(?:^|;)\s*width\s*:\s*(\d{1,3}(?:\.\d+)?)%/);
    if (sw && e.getBoundingClientRect().height <= 8) { progress = Math.min(1, parseFloat(sw[1]) / 100); break; }
    const r = e.getBoundingClientRect();
    if (!(r.height > 0 && r.height <= 8 && r.width > 4) || !e.parentElement) continue;
    const bg = crlfParse(getComputedStyle(e).backgroundColor);
    if (!bg || bg.a < 0.6 || bg.gray) continue;
    const pr = e.parentElement.getBoundingClientRect();
    const base = pr.width > r.width + 2 ? pr.width : (thumb ? thumb.img.getBoundingClientRect().width : 0);
    if (base > 0) { progress = Math.max(0, Math.min(1, r.width / base)); break; }
  }
  const link = pop.querySelector('a[href*="/series/"]');
  const raw = title.textContent.trim();
  const sp = typeof crSplitSeason === "function" ? crSplitSeason(raw) : { title: raw };
  return { name: sp.title || raw, season: sp.season, part: sp.part, url: link ? link.href.split("?")[0] : null,
    poster: poster && poster.src, thumb: thumb && thumb.src, desc: desc ? desc.textContent.trim() : "",
    epNo, epTitle, progress, pending, buttons: buttons.map((b) => {
      const a = b.closest("a[href]") || b.querySelector("a[href]");
      return { el: b, label: b.textContent.trim(), href: b.href || (a && a.href) || "", play: !/playlist|watchlist/i.test(b.textContent) };
    }) };
}

// Vorschau-Karte schließen und alle Beobachter beenden
function crlfPeekClose() {
  clearInterval(crlfPeekWatch);
  if (crlfPeekRO) { crlfPeekRO.disconnect(); crlfPeekRO = null; }
  if (crlfPeekEl) { crlfPeekRemember(crlfPeekEl); crlfPeekEl.remove(); }
  crlfPeekEl = crlfPeekSrc = null;
  crlfPeekKey = "";
}

// Ist die Original-Vorschau noch offen? (entfernt, ausgeblendet oder Vorfahr unsichtbar = zu)
function crlfPopOpen(pop) {
  if (!pop || !pop.isConnected || !pop.getClientRects().length) return false;
  for (let p = pop.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.visibility === "hidden" || (parseFloat(cs.opacity) < 0.1 && !p.matches(".qtip")) || cs.display === "none") return false;
  }
  return true;
}

// Liegt die Maus (letzte bekannte Position) über dem Element? pad = Rand in px
function crlfWithin(el, pad) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return crlfMouse.x >= r.left - pad && crlfMouse.x <= r.right + pad && crlfMouse.y >= r.top - pad && crlfMouse.y <= r.bottom + pad;
}
const crlfPkWait = new WeakSet(); // Bilder der Seite, auf deren Laden die Vorschau schon wartet
let crlfLastPeek = { name: "", card: null }; // zuletzt gezeigter Anime und seine Karte
// Titel zum Vergleichen: klein, ohne Klammerzusätze und Satzzeichen
const crlfNorm = (t) => (t || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^\p{L}\p{N}]/gu, "");

// Vorschau-Karte bauen bzw. aktualisieren; true = Vorschau der Seite übernommen (auch wenn gerade nichts gezeigt wird)
function crlfPeek(pop) {
  const d = crlfPeekData(pop);
  if (!d) return false;
  pop.setAttribute("data-crlf-hidepop", "");
  // nur zeigen, wenn die Daten zur Karte unter der Maus gehören: die Seite füllt ihre Vorschau beim Wechsel erst
  // verzögert neu (sonst blitzt kurz der vorige Anime auf) und schließt sie beim Scrollen nicht immer
  const card = (pop.closest && pop.closest("article.release, .js-release")) || crlfHoverCard;
  if (!crlfTouch && card && !crlfWithin(card, 2) && !crlfWithin(crlfPeekEl, 14)) return true;
  const cite = card && card.querySelector("cite, .season-name, h1");
  const a = crlfNorm(cite && (cite.dataset.crlfOrig || cite.textContent)).slice(0, 12), b = crlfNorm(d.name).slice(0, 12);
  // veraltet = gleicher Anime wie zuletzt gezeigt, aber andere Karte, deren Titel nicht passt
  const stale = crlfLastPeek.name === d.name && crlfLastPeek.card !== card;
  // sicherer: Serien-ID der Karte und der Vorschau vergleichen (auch wenn dazwischen ein anderer Anime kurz überfahren wurde)
  const sid = (u) => ((String(u || "").match(/\/series\/([A-Z0-9]+)/i) || [])[1] || "").toUpperCase();
  const cs = card && !crlfTouch ? sid((card.querySelector('a[href*="/series/"]') || {}).href) : "", ps = sid(d.url);
  if ((cs && ps && cs !== ps) || (stale && a && b && !a.startsWith(b) && !b.startsWith(a))) { if (crlfPeekCard !== card) crlfPeekClose(); return true; }
  crlfLastPeek = { name: d.name, card };
  crlfPeekSrc = pop;
  // nachgeladene Bilder der Seite: noch einmal lesen, sobald sie da sind (Laden löst sonst keine Änderung aus)
  for (const i of d.pending) if (!crlfPkWait.has(i)) { crlfPkWait.add(i); i.addEventListener("load", () => { crlfPkWait.delete(i); if (crlfPeekSrc === pop) crlfPeek(pop); }, { once: true }); }
  const key = [d.name, d.season, d.poster, d.thumb, d.epTitle, d.progress, d.desc.length].join("|");
  if (crlfPeekEl && crlfPeekEl.isConnected && key === crlfPeekKey) { crlfPlacePeek(); return true; }
  // gleiche Vorschau, nur Bild/Folge nachgeladen: in den freigehaltenen Platz einsetzen statt neu bauen (kein Springen)
  if (crlfPeekEl && crlfPeekEl.isConnected && (crlfPeekUpgrade(crlfPeekEl, d, card) || crlfPeekFill(crlfPeekEl, d))) { crlfPeekKey = key; crlfPlacePeek(); return true; }
  crlfPeekBuild(d, key);
  return true;
}

// Vorschau-Karte aus den gelesenen Daten d bauen und zeigen (Maus: neben der Karte; Handy: Blatt am unteren Rand)
function crlfPeekBuild(d, key) {
  if (crlfPeekEl) { crlfPeekRemember(crlfPeekEl); crlfPeekEl.remove(); }
  crlfPeekKey = key;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const panel = el("aside", "crlf-peek");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", T("Vorschau: {0}", d.name));
  const top = el("div", "crlf-pk-top");
  // Poster/Folgenbild noch nicht geladen: Platz in fester Größe freihalten, damit später nichts verrutscht
  // (frühe Vorschau aus der Karte: Folgenbild kommt erst mit der Vorschau der Seite)
  const waitPoster = !d.poster && (d.pending.length > 0 || d.early), waitThumb = !d.thumb && (d.pending.length > (waitPoster ? 1 : 0) || (d.early && d.epNo));
  if (d.poster) { const im = el("img", "crlf-pk-poster"); im.src = d.poster; im.alt = ""; top.append(im); }
  else if (waitPoster) top.append(el("div", "crlf-pk-poster crlf-pk-ph"));
  const info = el("div", "crlf-pk-info");
  const h = el("div", "crlf-pk-title", d.name);
  if (d.season) {
    const b = el("span", "crlf-season crlf-pk-season");
    crlfSeasonBadge(b, d.season, d.part);
    h.append(" ", b);
  }
  info.append(h, crlfRatingBox(d.name, d.url));
  if (d.buttons.length) info.append(crlfPeekButtons(d));
  top.append(info);
  panel.append(top);
  if (crlfTouch) {
    const x = el("button", "crlf-pk-close", "✕");
    x.type = "button";
    x.setAttribute("aria-label", T("Schließen"));
    x.addEventListener("click", crlfPeekClose);
    panel.append(x);
  }
  // Beschreibung noch nicht da: Platzhalter in fester Höhe (die Vorschau behält ihre Größe). Text kommt mit der
  // Einblendung der Seite (crlfPeekUpgrade); hat die keine, ersatzweise von AniList
  if (!d.desc) {
    const p = el("p", "crlf-pk-desc crlf-pk-ph");
    panel.append(p);
    if (!d.early) crlfPeekAniDesc(p, d); // Daten der Seite sind schon da, ohne Beschreibung
    else setTimeout(() => crlfPeekAniDesc(p, d), 2500); // Seite meldet sich nicht: nicht ewig warten
  } else {
    const p = el("p", "crlf-pk-desc");
    crlfPeekDescText(p, d.desc, d.descAl);
    panel.append(p);
  }
  if (d.thumb || waitThumb) {
    const ep = el("div", "crlf-pk-ep");
    const th = el("div", "crlf-pk-thumb");
    if (d.thumb) { const im = el("img"); im.src = d.thumb; im.alt = ""; th.append(im); }
    else ep.classList.add("crlf-pk-ph");
    if (d.epNo) th.append(el("b", null, d.epNo));
    // Fortschrittsbalken unter dem Bild, so breit wie das Bild (wie auf der Crunchyroll-Seite)
    const shot = el("div", "crlf-pk-shot");
    shot.append(th);
    if (d.progress != null || d.early) {
      const bar = el("div", "crlf-pk-bar");
      bar.append(el("i"));
      crlfPeekBar(bar, d.progress);
      shot.append(bar);
    }
    const txt = el("div", "crlf-pk-eptext");
    crlfPeekEpText(txt, d);
    ep.append(shot, txt);
    panel.append(ep);
  }
  panel._crlfData = d;
  panel._crlfEarly = !!d.early;
  panel._crlfCard = crlfHoverCard;
  document.documentElement.appendChild(panel);
  crlfPeekEl = panel;
  crlfPeekCard = crlfHoverCard;
  crlfPeekSeen = Date.now();
  crlfPlacePeek();
  // Bewertung/Bilder laden nach: Größe ändert sich -> neu platzieren
  if (crlfPeekRO) crlfPeekRO.disconnect();
  crlfPeekRO = new ResizeObserver(() => crlfPlacePeek());
  crlfPeekRO.observe(panel);
  panel.querySelectorAll("img").forEach((i) => i.addEventListener("load", crlfPlacePeek));
  // kommt ein freigehaltenes Bild nicht (z. B. Ladefehler), den leeren Platz nach einer Weile wieder entfernen
  if (panel.querySelector(".crlf-pk-ph")) setTimeout(() => {
    if (crlfPeekEl !== panel) return;
    panel.querySelectorAll("div.crlf-pk-poster.crlf-pk-ph, .crlf-pk-ep.crlf-pk-ph").forEach((e) => e.remove());
    crlfPlacePeek();
  }, 4000);
  // offen bleiben, solange Original-Vorschau, Karte oder unsere Karte unter der Maus sind; erst nach kurzer Pause schließen
  // (nach Mausposition statt :hover – das ist zuverlässiger, auch über dem Spalt zwischen Karte und Vorschau)
  clearInterval(crlfPeekWatch);
  if (crlfTouch) return; // Handy: offen bis Tippen daneben oder ✕
  crlfPeekWatch = setInterval(() => {
    const inside = crlfPopOpen(crlfPeekSrc) || crlfWithin(crlfPeekEl, 14) || crlfWithin(crlfPeekCard, 2);
    if (inside) { crlfPeekSeen = Date.now(); return; }
    if (Date.now() - crlfPeekSeen > 500) crlfPeekClose();
  }, 120);
}

// Fortschrittsbalken unter dem Folgenbild; ohne Wert unsichtbar, hält aber den Platz (frühe Vorschau)
function crlfPeekBar(bar, progress) {
  bar.style.visibility = progress == null ? "hidden" : "";
  const pct = Math.round((progress || 0) * 100);
  bar.title = T("Fortschritt {0} %", pct);
  bar.firstChild.style.setProperty("--p", `${pct}%`);
}

// Knöpfe der Vorschau (Abspielen/Fortsetzen, Playlist …)
function crlfPeekButtons(d) {
  const row = document.createElement("div");
  row.className = "crlf-pk-btns";
  d.buttons.slice(0, 3).forEach((b, i) => {
    const btn = document.createElement("button");
    btn.className = "crlf-pk-btn" + (i === 0 ? " crlf-pk-primary" : "");
    btn.textContent = b.label;
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      // die Original-Vorschau ist evtl. schon zu: dann über den Link gehen (Abspielen: Folge der Karte, Playlist: Serienseite)
      if (b.el && b.el.isConnected && crlfPopOpen(crlfPeekSrc)) { b.el.click(); return; }
      const card = crlfPeekCard && crlfPeekCard.querySelector('a[href*="/watch/"]');
      const href = b.href || (b.play ? card && card.href : d.url) || d.url;
      if (href) location.href = href;
    });
    row.append(btn);
  });
  return row;
}

// Folgennummer und -titel neben dem Folgenbild
function crlfPeekEpText(txt, d) {
  txt.textContent = "";
  const add = (tag, text) => { const e = document.createElement(tag); e.textContent = text; txt.append(e); };
  if (d.epNo) add("small", T("Folge {0}", d.epNo));
  if (d.epTitle) add("span", d.epTitle);
}

// Nachgeladenes Poster/Folgenbild in den freigehaltenen Platz der offenen Vorschau setzen.
// false = passt nicht (anderer Anime, Text geändert oder kein Platz frei) -> neu bauen
function crlfPeekFill(panel, d) {
  const old = panel._crlfData;
  if (!old || old.name !== d.name || old.season !== d.season || old.desc.length !== d.desc.length) return false;
  const ph = panel.querySelector("div.crlf-pk-poster.crlf-pk-ph");
  // schon gezeigte Bilder bleiben (auch wenn die Seite eine andere Größe desselben Bildes liefert); neu bauen nur, wenn kein Platz da ist
  if (d.poster && !ph && !panel.querySelector("img.crlf-pk-poster")) return false;
  if (d.thumb && !panel.querySelector(".crlf-pk-ep")) return false;
  const bar = panel.querySelector(".crlf-pk-bar");
  if (d.progress != null && d.progress !== old.progress && !bar) return false;
  if (bar && d.progress != null) crlfPeekBar(bar, d.progress);
  if (d.poster && ph) {
    const im = document.createElement("img"); im.className = "crlf-pk-poster"; im.alt = ""; im.src = d.poster;
    im.addEventListener("load", crlfPlacePeek);
    ph.replaceWith(im);
  }
  const ex = panel.querySelector(".crlf-pk-ep");
  if (ex) {
    if (d.thumb && !ex.querySelector(".crlf-pk-thumb img")) {
      const im = document.createElement("img"); im.alt = ""; im.src = d.thumb;
      im.addEventListener("load", crlfPlacePeek);
      ex.querySelector(".crlf-pk-thumb").prepend(im);
      ex.classList.remove("crlf-pk-ph");
    }
    const th = ex.querySelector(".crlf-pk-thumb");
    let b = th.querySelector("b");
    if (d.epNo && !b) { b = document.createElement("b"); th.append(b); }
    if (b) { if (d.epNo) b.textContent = d.epNo; else b.remove(); }
    crlfPeekEpText(ex.querySelector(".crlf-pk-eptext"), d);
  }
  panel._crlfData = { ...d, progress: d.progress ?? old.progress };
  return true;
}

// Frühe Vorschau (aus der Karte gebaut, bevor die Seite ihre eigene zeigt) mit den Daten der Seite ergänzen:
// Knöpfe, Folgenbild, Folgentitel, Fortschritt. Alles hat schon seinen Platz, es verschiebt sich nichts.
function crlfPeekUpgrade(panel, d, card) {
  const old = panel._crlfData;
  // gilt, solange die Vorschau offen ist (die Seite füllt ihre Einblendung oft in mehreren Schritten)
  if (!old || !panel._crlfEarly || panel._crlfCard !== card) return false;
  const ph = panel.querySelector("div.crlf-pk-poster.crlf-pk-ph");
  if (ph && d.poster) {
    const im = document.createElement("img"); im.className = "crlf-pk-poster"; im.alt = ""; im.src = d.poster;
    im.addEventListener("load", crlfPlacePeek);
    ph.replaceWith(im);
  }
  const btns = panel.querySelector(".crlf-pk-btns");
  if (btns && d.buttons.length) btns.replaceWith(crlfPeekButtons(d));
  else if (!btns && d.buttons.length) panel.querySelector(".crlf-pk-info").append(crlfPeekButtons(d));
  const p = panel.querySelector(".crlf-pk-desc");
  if (p && d.desc && (!p.textContent || p.dataset.crlfAl === "1")) crlfPeekDescText(p, d.desc, false); // Text der Seite vor AniList
  else if (p && !p.textContent) crlfPeekAniDesc(p, { ...old, ...d, name: old.name, url: old.url || d.url });
  const ep = panel.querySelector(".crlf-pk-ep");
  if (ep) {
    const th = ep.querySelector(".crlf-pk-thumb");
    if (d.thumb && !th.querySelector("img")) {
      const im = document.createElement("img"); im.alt = ""; im.src = d.thumb;
      im.addEventListener("load", crlfPlacePeek);
      th.prepend(im);
      ep.classList.remove("crlf-pk-ph");
    }
    const bar = ep.querySelector(".crlf-pk-bar");
    if (bar && d.progress != null) crlfPeekBar(bar, d.progress);
    const epNo = d.epNo || old.epNo;
    let b = th.querySelector("b");
    if (epNo && !b) { b = document.createElement("b"); th.append(b); }
    if (b) b.textContent = epNo;
    crlfPeekEpText(ep.querySelector(".crlf-pk-eptext"), { ...d, epNo });
  }
  panel._crlfUpgraded = true;
  // weitere Nachlieferungen (Bilder) laufen wie bei einer normalen Vorschau über crlfPeekFill
  panel._crlfData = { ...d, desc: d.desc || old.desc, progress: d.progress ?? old.progress, epNo: d.epNo || old.epNo };
  return true;
}

// Zwischenspeicher der fertigen Vorschau je Serie (Beschreibung, Knöpfe, aktuelle Folge), bleibt über Neuladen erhalten
const crlfSid = (u) => ((String(u || "").match(/\/series\/([A-Z0-9]+)/i) || [])[1] || "").toUpperCase();
const crlfPeekMem = new Map();
const crlfPeekMemReady = chrome.storage.local.get("crPeek").then(({ crPeek }) => {
  for (const [k, v] of Object.entries(crPeek || {})) if (!crlfPeekMem.has(k)) crlfPeekMem.set(k, v);
}).catch(() => {});
let crlfPeekMemT = 0;
function crlfPeekRemember(panel) {
  const d = panel && panel._crlfData, sid = d && crlfSid(d.url || (panel._crlfCard && (panel._crlfCard.querySelector('a[href*="/series/"]') || {}).href));
  if (!sid || ((panel._crlfEarly || d.fromCard) && !panel._crlfUpgraded)) return; // nur Daten, die die Seite selbst geliefert hat
  const p = panel.querySelector(".crlf-pk-desc"), img = panel.querySelector(".crlf-pk-thumb img");
  const al = !!(p && p.dataset.crlfAl === "1");
  const entry = { desc: p ? (p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild.textContent : p.textContent) : "", al, buttons: (d.buttons || []).slice(0, 3).map((b) => ({ label: b.label, play: !!b.play })),
    epNo: d.epNo || "", epTitle: d.epTitle || "", thumb: img && !/^data:/.test(img.getAttribute("src")) ? img.getAttribute("src") : "", at: Date.now() };
  if (!entry.desc && !entry.buttons.length) return;
  crlfPeekMem.delete(sid);
  crlfPeekMem.set(sid, entry);
  while (crlfPeekMem.size > 300) crlfPeekMem.delete(crlfPeekMem.keys().next().value); // älteste zuerst raus
  clearTimeout(crlfPeekMemT);
  crlfPeekMemT = setTimeout(() => chrome.storage.local.set({ crPeek: Object.fromEntries(crlfPeekMem) }).catch(() => {}), 1500);
}

// Vorschau schon beim Überfahren aus der Karte zeigen, statt auf die (verzögerte) Vorschau der Seite zu warten.
// Beschreibung kommt von der Serienseite (vorgeladen); Knöpfe/Folgenbild ergänzt crlfPeekUpgrade, sobald die Seite sie liefert.
let crlfEarlyT = 0, crlfEarlyCard = null;
function crlfPeekEarly(card) {
  if (card === crlfEarlyCard || (crlfPeekEl && crlfPeekCard === card)) return; // läuft schon bzw. ist schon offen
  clearTimeout(crlfEarlyT);
  crlfEarlyCard = card;
  crlfEarlyT = setTimeout(async () => {
    crlfEarlyCard = null;
    if (crlfHoverCard !== card || !card.isConnected || !crlfWithin(card, 2) || (crlfPeekEl && crlfPeekCard === card)) return;
    if (!document.documentElement.classList.contains("crlf-themed")) return;
    const d = crlfPeekFromCard(card);
    if (!d) return;
    // Bild der Karte: Hochformat = Poster, Querformat = Folgenbild
    const img = d.poster && [...card.querySelectorAll("img")].map(crlfImgInfo).find((o) => o.src === d.poster);
    if (img && img.w > img.h) { d.thumb = d.poster; d.poster = null; }
    const line = [...card.querySelectorAll("*")].find((e) => !e.closest(".crlf-actions") && /(Folgen?|Episoden?|Episodes?)\s*\d/i.test(e.textContent) && e.textContent.length < 60);
    d.epNo = line ? (line.textContent.match(/(?:Folgen?|Episoden?|Episodes?)\s*(\d+)/i) || [])[1] || "" : "";
    const pr = card.querySelector("progress");
    if (pr && pr.max > 0 && pr.value > 0) d.progress = Math.min(1, pr.value / pr.max);
    d.early = true;
    d.fromCard = false;
    // schon einmal gesehen (auch vor dem Neuladen): Beschreibung, Knöpfe und Folge aus dem Zwischenspeicher, dann sieht
    // die frühe Vorschau gleich aus wie die fertige; sonst Platzhalter, die Seite liefert nach
    await crlfPeekMemReady;
    const mem = crlfPeekMem.get(crlfSid(d.url));
    if (mem) {
      d.desc = mem.desc || "";
      d.descAl = !!mem.al;
      if (mem.buttons && mem.buttons.length) d.buttons = mem.buttons.map((b) => ({ el: null, label: b.label, href: "", play: b.play }));
      if (mem.epNo && mem.epNo === d.epNo) { d.thumb = d.thumb || mem.thumb || null; d.epTitle = mem.epTitle || ""; }
    }
    if (crlfHoverCard !== card || !card.isConnected || !crlfWithin(card, 2) || (crlfPeekEl && crlfPeekCard === card)) return;
    if (!d.desc && d.url) d.fromCard = true; // Beschreibung von der Serienseite oder der Seite nachtragen
    crlfPeekSrc = null;
    crlfLastPeek = { name: d.name, card };
    crlfPeekBuild(d, `early|${d.name}`);
  }, 180);
}

// Vorschau-Daten direkt aus einer Kalenderkarte (Handy: die Seite zeigt ohne Maus keine eigene Vorschau)
function crlfPeekFromCard(card) {
  const cite = card.querySelector("cite, .season-name, h1");
  const raw = ((cite && (cite.dataset.crlfOrig || cite.textContent)) || "").trim();
  if (!raw) return null;
  const sp = typeof crSplitSeason === "function" ? crSplitSeason(typeof crStripLanguage === "function" ? crStripLanguage(raw) : raw) : { title: raw };
  const img = [...card.querySelectorAll("img")].map(crlfImgInfo).filter((o) => o.src && o.img.getBoundingClientRect().width > 20).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const series = card.querySelector('a[href*="/series/"]'), watch = card.querySelector('a[href*="/watch/"]');
  const url = series ? series.href.split("?")[0] : null;
  const buttons = [];
  if (watch) buttons.push({ el: null, label: T("Abspielen"), href: watch.href, play: true });
  if (url) buttons.push({ el: null, label: T("Zur Serie"), href: url, play: false });
  return { name: sp.title || raw, season: sp.season, part: sp.part, url, poster: img ? img.src : null, thumb: null, desc: "",
    epNo: "", epTitle: "", progress: null, pending: [], buttons, fromCard: true };
}

// Langes Tippen (ca. 0,45 s, ohne Wischen) auf eine Karte öffnet die Vorschau; der folgende Klick öffnet dann nichts
let crlfLP = null;
if (crlfTouch) {
  addEventListener("touchstart", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (crlfPeekEl && t && !crlfPeekEl.contains(t)) crlfPeekClose();
    if (crlfLP) clearTimeout(crlfLP.timer);
    crlfLP = null;
    const card = t && !t.closest("button, .crlf-btn, .crlf-peek, .crlf-cpanel") && t.closest("article.release, .js-release");
    if (!card || e.touches.length !== 1) return;
    const lp = { x: e.touches[0].clientX, y: e.touches[0].clientY, fired: false };
    lp.timer = setTimeout(() => {
      const d = crlfPeekFromCard(card);
      if (!d || crlfLP !== lp) return;
      lp.fired = true;
      crlfHoverCard = card;
      crlfPeekSrc = null;
      crlfLastPeek = { name: d.name, card };
      crlfPeekBuild(d, `card|${d.name}`);
      if (navigator.vibrate) navigator.vibrate(12);
    }, 450);
    crlfLP = lp;
  }, { capture: true, passive: true });
  addEventListener("touchmove", (e) => {
    if (!crlfLP || crlfLP.fired) return;
    const p = e.touches[0];
    if (Math.hypot(p.clientX - crlfLP.x, p.clientY - crlfLP.y) > 10) { clearTimeout(crlfLP.timer); crlfLP = null; }
  }, { capture: true, passive: true });
  addEventListener("touchend", () => { if (crlfLP && !crlfLP.fired) { clearTimeout(crlfLP.timer); crlfLP = null; } }, { capture: true, passive: true });
  for (const type of ["click", "contextmenu"]) addEventListener(type, (e) => {
    if (!crlfLP || !crlfLP.fired) return;
    e.preventDefault(); e.stopPropagation();
    if (type === "click") crlfLP = null;
  }, true);
}

// Gefundene Vorschau der Seite übernehmen: nur die äußerste Ebene zählt (verschachtelte Kästen derselben
// Vorschau sonst doppelt), ihr Inhalt wird in die eigene Vorschau-Karte übertragen (crlfPeek)
function crlfStylePopup(pop) {
  const outer = pop.parentElement && pop.parentElement.closest("[data-crlf-pop]");
  if (outer) { pop.removeAttribute("data-crlf-pop"); pop = outer; }
  for (const inner of pop.querySelectorAll("[data-crlf-pop]")) inner.removeAttribute("data-crlf-pop");
  crlfPeek(pop);
}

// Vorschau der Seite unter dem Mauszeiger finden: schwebende Ebene (absolute/fixed, z-index) mit Text,
// die keine Kalenderkarten enthält. Sie wird markiert (data-crlf-pop) und an crlfPeek übergeben.
let crlfPopTimer = 0;
function crlfSolidifyPopups(x, y) {
  if (!document.documentElement.classList.contains("crlf-themed")) return;
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === document.body || el === document.documentElement) break;
    if (el.closest("[data-crlf-pop], .crlf-cpanel, .crlf-peek, #crlf-theme-toggle") || el.matches("img, video, picture, canvas, svg")) continue;
    const cs = getComputedStyle(el);
    if (!(cs.position === "absolute" || cs.position === "fixed") || !(parseInt(cs.zIndex) > 0)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 180 || r.height < 120 || !el.textContent.trim()) continue;
    // Kalenderbereiche (enthalten Karten mit Uhrzeit) sind keine Einblendung
    if ([...el.querySelectorAll("article.release, .js-release")].some((a) => a.querySelector("time, .available-time"))) continue;
    if (el.closest("article.release, .js-release") && !el.querySelector("button, [role=button]")) continue;
    el.classList.remove("crlf-bgclear");
    el.setAttribute("data-crlf-pop", "");
    crlfStylePopup(el);
  }
}

// Die Vorschau der Seite erscheint NEBEN der Karte, nicht unter dem Mauszeiger: deshalb über ihren Inhalt finden
// (Knöpfe wie „Fortsetzen“, „Auf die Playlist“, „Ansehen“) und den umschließenden Kasten nehmen.
const CRLF_POP_RE = /^\s*(fortsetzen|weiterschauen|ansehen|jetzt ansehen|abspielen|auf die playlist|zur playlist|playlist|watchlist|zur watchlist|resume|continue|watch now|play|add to (watch|play)list)\s*$/i;
let crlfPopRan = 0; // Zeitpunkt der letzten Suche (doppelte Suchen kurz hintereinander sparen)
function crlfFindPopups() { crlfTime("Vorschau der Seite suchen", crlfFindPopupsNow); }
// nur suchen, wenn seit since (Zeitpunkt, performance.now) noch keine Suche lief
function crlfFindPopupsSince(since) { if (crlfPopRan < since) crlfFindPopups(); }
function crlfFindPopupsNow() {
  crlfPopRan = performance.now();
  if (!document.documentElement.classList.contains("crlf-themed")) return;
  const vw = innerWidth, vh = innerHeight;
  for (const btn of document.querySelectorAll("button, a, [role=button]")) {
    if (!CRLF_POP_RE.test(btn.textContent.replace(/[^\p{L}\s]/gu, "")) || btn.closest(".crlf-cpanel, .crlf-peek")) continue;
    const rb = btn.getBoundingClientRect();
    if (!rb.width || !rb.height) continue;
    // nach oben bis knapp vor den Bereich, der Kalenderkarten enthält oder fast den ganzen Bildschirm füllt
    let box = null;
    for (let p = btn.parentElement; p && p !== document.body; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width > vw * 0.9 || r.height > vh * 0.98) break;
      // die Vorschau kann auch IN der Kalenderkarte hängen: an der Karte selbst bzw. an Hüllen mit Karten anhalten
      if (p.matches("article.release, .js-release") && p.querySelector("time, .available-time")) break;
      if ([...p.querySelectorAll("article.release, .js-release")].some((a) => a.querySelector("time, .available-time"))) break;
      if (r.width >= 260 && r.height >= 160) box = p;
    }
    if (box) {
      box.classList.remove("crlf-bgclear");
      box.setAttribute("data-crlf-pop", "");
      crlfStylePopup(box);
    }
  }
}

// Karte unter der Maus merken (dorthin setzt sich die Vorschau)
addEventListener("mouseover", (e) => {
  const card = e.target instanceof Element && !e.target.closest("[data-crlf-pop]") && e.target.closest("article.release, .js-release");
  if (!card) return;
  // andere Karte: alte Vorschau sofort weg, die neue erscheint, sobald ihre Daten da sind
  if (crlfPeekEl && crlfPeekCard && card !== crlfPeekCard) crlfPeekClose();
  if (card !== crlfHoverCard && !crlfTouch) { crlfHoldScrollFor(card); crlfPrefetch(card); }
  crlfHoverCard = card;
  if (!crlfTouch) crlfPeekEarly(card);
}, true);

// Daten der Vorschau schon beim Überfahren laden (Serienseite, AniList), damit sie gleich vollständig erscheint
let crlfPrefetchT = 0;
function crlfPrefetch(card) {
  clearTimeout(crlfPrefetchT);
  crlfPrefetchT = setTimeout(() => {
    if (crlfHoverCard !== card || !card.isConnected) return;
    const d = crlfPeekFromCard(card);
    if (!d || !d.url) return;
    crlfSeriesPage(d.url);
    crlfRatingBox(d.name, d.url); // startet nur die Abrufe; Ergebnisse landen im Zwischenspeicher
  }, 60);
}

// Karte nur halb im Bild: die Seite scrollt sie beim Überfahren selbst ins Bild, alles springt. Solches Scrollen ohne
// eigenes Zutun (Rad, Tasten, Klick/Ziehen, Finger) kurz nach dem Überfahren sofort rückgängig machen.
let crlfUserScroll = 0, crlfHold = null;
for (const type of ["wheel", "keydown", "mousedown", "touchmove"]) addEventListener(type, () => { crlfUserScroll = Date.now(); }, { capture: true, passive: true });
function crlfHoldScrollFor(card) {
  const list = [];
  for (let p = card.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement)
    if (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth) list.push([p, p.scrollLeft, p.scrollTop]);
  crlfHold = { until: Date.now() + 700, x: scrollX, y: scrollY, list };
}
addEventListener("scroll", (e) => {
  const h = crlfHold;
  if (!h || Date.now() > h.until) return;
  if (Date.now() - crlfUserScroll < 600) { crlfHold = null; return; }
  if (e.target === document || e.target === document.documentElement || e.target === document.body) {
    if (scrollX !== h.x || scrollY !== h.y) scrollTo({ left: h.x, top: h.y, behavior: "instant" });
  } else for (const [el, l, t] of h.list) if (el === e.target && (el.scrollLeft !== l || el.scrollTop !== t)) el.scrollTo({ left: l, top: t, behavior: "instant" });
}, { capture: true, passive: true });

// Beim Scrollen kommt kein mousemove: prüfen, ob die Maus noch über Karte oder Vorschau ist, sonst sofort schließen
function crlfPeekScroll() {
  if (!crlfPeekEl || crlfTouch) return;
  requestAnimationFrame(() => {
    if (!crlfPeekEl) return;
    if (crlfWithin(crlfPeekEl, 0) || crlfWithin(crlfPeekCard, 0)) crlfPlacePeek();
    else crlfPeekClose();
  });
}
addEventListener("scroll", crlfPeekScroll, { capture: true, passive: true });
addEventListener("wheel", () => setTimeout(crlfPeekScroll, 60), { capture: true, passive: true });

// Maus bewegt: kurz danach nach der Vorschau der Seite suchen und sie einfärben
// (lief inzwischen schon eine Suche, z. B. nach einer Änderung der Seite, entfällt die eigene)
addEventListener("mousemove", (e) => {
  const at = performance.now();
  clearTimeout(crlfPopTimer);
  crlfPopTimer = setTimeout(() => { crlfTime("Vorschau unter der Maus", () => crlfSolidifyPopups(e.clientX, e.clientY)); crlfFindPopupsSince(at + 60); }, 120);
  // die Vorschau erscheint oft erst nach einer Verzögerung: noch zweimal nachsehen
  clearTimeout(crlfPopTimer2);
  crlfPopTimer2 = setTimeout(() => crlfFindPopupsSince(at + 500), 800);
  clearTimeout(crlfPopTimer3);
  crlfPopTimer3 = setTimeout(() => crlfFindPopupsSince(at + 1300), 1600);
}, { passive: true });
let crlfPopTimer2 = 0, crlfPopTimer3 = 0;
// Seite tauscht den Inhalt der Vorschau aus (anderer Anime): bei jeder Änderung kurz danach erneut anpassen
let crlfPopMutTimer = 0;
// Änderungen nur an eigenen Elementen (Knöpfe, Vorschau, Video …) zählen nicht; hat das Einfärben neuer Teile
// inzwischen ohnehin gesucht, entfällt die Suche
new MutationObserver((muts) => {
  if (muts.every(crlfOwnMutation)) return;
  const at = performance.now();
  clearTimeout(crlfPopMutTimer);
  crlfPopMutTimer = setTimeout(() => crlfFindPopupsSince(at), 60);
}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

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

// ===== 7. Eigenes Hintergrundbild (Design „Bild“) =====
// Das Bild liegt fertig verkleinert in storage.local „crBanner“ (siehe background.js). Es wird in eine feste
// Zeichenfläche hinter dem Kalender gemalt (deckend wie „cover“, leicht abgedunkelt) statt als CSS-Hintergrund:
// so greifen die Inhaltsregeln (CSP) der Seite nicht, und das Bild wird nirgends erneut abgerufen.
let crlfBannerSrc = null, crlfBannerBmp = null, crlfBannerJob = null, crlfBannerGen = 0;
// Zeichenfläche anlegen/entfernen und bei Bedarf neu malen (neues Bild, andere Fenstergröße)
function crlfBannerSync() {
  const on = document.documentElement.classList.contains("crlf-bg-banner") && crlfBannerSrc;
  let cv = document.getElementById("crlf-banner");
  if (!on || !document.body) { if (cv) cv.remove(); return; }
  if (!crlfBannerBmp) {
    const src = crlfBannerSrc;
    if (crlfBannerJob === src) return; // dieses Bild wird gerade schon entpackt
    crlfBannerJob = src;
    (async () => {
      const [head, b64] = src.split(",");
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return createImageBitmap(new Blob([bytes], { type: (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg" }));
    })().then((bmp) => {
      if (src !== crlfBannerSrc) { bmp.close(); return; } // inzwischen anderes Bild gewählt
      crlfBannerBmp = bmp;
      crlfBannerSync();
    }, () => {}).finally(() => { if (crlfBannerJob === src) crlfBannerJob = null; });
    return;
  }
  if (!cv) {
    cv = document.createElement("canvas");
    cv.id = "crlf-banner";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
  }
  const d = window.devicePixelRatio || 1, W = Math.round(innerWidth * d), H = Math.round(innerHeight * d);
  if (cv.width === W && cv.height === H && cv.dataset.gen === String(crlfBannerGen)) return;
  cv.width = W; cv.height = H; cv.dataset.gen = String(crlfBannerGen);
  const g = cv.getContext("2d"), bmp = crlfBannerBmp;
  const s = Math.max(W / bmp.width, H / bmp.height);
  g.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  // abdunkeln, oben etwas mehr (Kopfbereich, Tagesköpfe), damit Karten und Schrift lesbar bleiben
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(8, 9, 14, 0.62)");
  grad.addColorStop(0.45, "rgba(8, 9, 14, 0.38)");
  grad.addColorStop(1, "rgba(8, 9, 14, 0.5)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}
let crlfBannerResize = 0;
addEventListener("resize", () => { clearTimeout(crlfBannerResize); crlfBannerResize = setTimeout(crlfBannerSync, 150); });
// neues Bild aus storage.local übernehmen (null = keins)
function crlfBannerSet(b) {
  const src = b && b.src && b.src.startsWith("data:image/") ? b.src : null;
  if (src === crlfBannerSrc) return;
  crlfBannerSrc = src;
  crlfBannerGen++;
  if (crlfBannerBmp) crlfBannerBmp.close();
  crlfBannerBmp = null;
  crlfBannerSync();
}
chrome.storage.local.get("crBanner", ({ crBanner }) => crlfBannerSet(crBanner));
chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c.crBanner) crlfBannerSet(c.crBanner.newValue); });

// ===== 8. Animierter Hintergrund (Design „Video“) =====
// Die Videos liegen im Add-on (backgrounds/, web_accessible_resources), es wird nichts von außen geladen.
// Ambilight: das scharfe Video mittig mit weich ausgeblendetem Rand, dahinter füllt ein kleines, stark weichgezeichnetes
// Standbild (backgrounds/blur/) den Rest; ein zweites laufendes Video sähe gleich aus, kostet aber doppelt Rechenzeit.
// „Wechselnd“ (pageVideo "auto"): alle 45 s ein anderes Motiv, sanft überblendet; gleiche Motive nie direkt nacheinander.
const CRLF_VIDEO_SECS = 45, CRLF_VIDEO_FADE = 2500;
const crlfCalm = matchMedia("(prefers-reduced-motion: reduce)");
let crlfVidFront = 0, crlfVidTimer = 0, crlfVidQueue = [], crlfVidBusy = false;
// nächstes Motiv für „Wechselnd“: Runde reihum nach Motiv (haus, baum, altstadt), zufällig gemischt
function crlfVideoNext(cur) {
  if (!crlfVidQueue.length) {
    const mix = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const groups = {};
    for (const n of CRLF_VIDEOS) (groups[n.split("_")[0]] ||= []).push(n);
    const keys = mix(Object.keys(groups));
    if (cur && keys[0] === cur.split("_")[0]) keys.push(keys.shift());
    const lists = keys.map((k) => mix(groups[k]));
    while (lists.some((l) => l.length)) for (const l of lists) if (l.length) crlfVidQueue.push(l.shift());
  }
  return crlfVidQueue.shift();
}
function crlfVideoLayer() {
  const el = document.createElement("div");
  el.className = "crlf-video-layer";
  const blur = document.createElement("div");
  blur.className = "crlf-video-blur";
  const v = document.createElement("video");
  v.className = "crlf-video-main";
  Object.assign(v, { muted: true, loop: true, playsInline: true, disablePictureInPicture: true, preload: "auto" });
  v.setAttribute("muted", "");
  el.append(blur, v);
  return el;
}
// Ebene anlegen/entfernen; aus = Element weg, damit kein Video im Hintergrund weiterläuft
function crlfVideoSync() {
  const on = document.documentElement.classList.contains("crlf-bg-video");
  let box = document.getElementById("crlf-video");
  if (!on || !document.body) {
    clearTimeout(crlfVidTimer);
    if (box) { for (const v of box.querySelectorAll("video")) { v.pause(); v.removeAttribute("src"); v.load(); } box.remove(); }
    return;
  }
  if (!box) {
    box = document.createElement("div");
    box.id = "crlf-video";
    box.setAttribute("aria-hidden", "true");
    const shade = document.createElement("div");
    shade.className = "crlf-video-shade";
    box.append(crlfVideoLayer(), crlfVideoLayer(), shade);
    document.body.prepend(box);
  }
  const auto = !CRLF_VIDEOS.includes(crlfVideo), want = auto ? "1" : "";
  const cur = box.dataset.name, modeChanged = box.dataset.auto !== want;
  box.dataset.auto = want;
  if (!cur || (!auto && cur !== crlfVideo) || (auto && modeChanged)) crlfVideoShow(auto ? crlfVideoNext(cur) : crlfVideo);
  else crlfVideoPlay();
}
// Motiv auf der hinteren Ebene laden und über die vordere blenden
function crlfVideoShow(name) {
  const box = document.getElementById("crlf-video");
  if (!box || crlfVidBusy) return;
  clearTimeout(crlfVidTimer);
  crlfVidBusy = true;
  box.dataset.name = name;
  const layers = box.querySelectorAll(".crlf-video-layer"), inc = layers[1 - crlfVidFront], out = layers[crlfVidFront];
  const v = inc.querySelector("video");
  const ready = () => {
    v.removeEventListener("canplay", ready); v.removeEventListener("error", ready);
    if (!box.isConnected) { crlfVidBusy = false; return; }
    inc.classList.add("crlf-top", "crlf-on");
    out.classList.remove("crlf-top");
    crlfVidFront = 1 - crlfVidFront;
    crlfVideoPlay();
    setTimeout(() => {
      out.classList.remove("crlf-on");
      const ov = out.querySelector("video");
      ov.pause(); ov.removeAttribute("src"); ov.load(); // Decoder freigeben
      crlfVidBusy = false;
      crlfVideoSync(); // falls während der Überblendung umgestellt wurde
    }, crlfCalm.matches ? 0 : CRLF_VIDEO_FADE + 100);
  };
  v.addEventListener("canplay", ready); v.addEventListener("error", ready);
  inc.firstChild.style.backgroundImage = `url("${chrome.runtime.getURL(`backgrounds/blur/${name}.jpg`)}")`;
  v.src = chrome.runtime.getURL(`backgrounds/${name}.webm`);
  v.load();
}
// nur abspielen, wenn der Tab sichtbar ist und keine reduzierte Bewegung gewünscht ist (sonst Standbild, kein Wechsel)
function crlfVideoPlay() {
  const box = document.getElementById("crlf-video");
  if (!box) return;
  const v = box.querySelectorAll(".crlf-video-layer")[crlfVidFront].querySelector("video");
  clearTimeout(crlfVidTimer);
  if (document.hidden || crlfCalm.matches) { v.pause(); return; }
  v.play().catch(() => {});
  if (box.dataset.auto === "1") crlfVidTimer = setTimeout(() => crlfVideoShow(crlfVideoNext(box.dataset.name)), CRLF_VIDEO_SECS * 1000);
}
document.addEventListener("visibilitychange", crlfVideoPlay);
crlfCalm.addEventListener("change", crlfVideoPlay);

// Start (am Dateiende, damit alle Abschnitte geladen sind)
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", crlfStart);
else crlfStart();
