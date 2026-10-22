// theme-peek.js – eigene Vorschau-Karte (.crlf-peek) statt der Einblendung der Seite
// Teil des Kalender-Designs; Reihenfolge der Dateien im Manifest: theme.js, theme-rating.js, theme-peek.js, theme-bg.js, theme-start.js.
// Alle teilen sich einen Bereich (gleiche Variablen und Funktionen wie früher in einer Datei).

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
  const cat = typeof crlfCatDesc === "function" ? crlfCatDesc(crlfSid(d.url)) : "";
  if (cat) { crlfPeekDescText(p, cat, false); return; }
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
  // Katalog-Beschreibung (private Fassung), wenn die Einblendung keine oder nur eine gekürzte hat
  const cat = typeof crlfCatDesc === "function" ? crlfCatDesc(crlfSid(d.url) || crlfSid(card && (card.querySelector('a[href*="/series/"]') || {}).href)) : "";
  if (cat && (!d.desc || /(…|\.\.\.)\s*$/.test(d.desc))) d.desc = cat;
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
    // Folgenbild: der eigene Kalender (calbuild.js) hat keine Vorschau der Seite, die es sonst liefern würde; er legt es
    // an der Karte ab (data-crlf-thumb), sonst das Bild, das content.js durch das Poster ersetzt hat
    if (!d.thumb) {
      const own = card.closest("[data-crlf-thumb]") || card.querySelector("[data-crlf-thumb]");
      const orig = (own && own.dataset.crlfThumb) || [...card.querySelectorAll("img[data-crlf-poster-orig]")].map((i) => i.dataset.crlfPosterOrig).find((s) => s && !/^data:/.test(s));
      if (orig && orig !== d.poster) d.thumb = orig;
    }
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
    const cat = typeof crlfCatDesc === "function" ? crlfCatDesc(crlfSid(d.url)) : ""; // Katalog (private Fassung)
    if (cat) d.desc = cat;
    if (mem) {
      if (!cat) d.desc = mem.desc || "";
      d.descAl = !cat && !!mem.al;
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
