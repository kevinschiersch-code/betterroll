// speed.js – Abspielgeschwindigkeit im Crunchyroll-Player (Nutzerwunsch). Läuft auf allen Crunchyroll-Seiten und in
// ihren Rahmen (der Player steckt je nach Seite in einem iframe von static.crunchyroll.com).
// Der Player hat ein eigenes Menü „Abspielgeschwindigkeit“ (Knopf „1x“ in der Leiste): dessen Einträge werden durch
// unser Feld ersetzt (Schnellwahl 1x / 1.1x / 1.25x / 1.5x und Schieberegler 0.5–2 in 0.05er-Schritten), der Knopf
// der Leiste zeigt unseren Wert. Das Feld gehört damit zum Menü und blendet mit der Player-Leiste aus.
// Nur falls ein Player gar kein solches Menü hat, erscheint ersatzweise ein schlichter Knopf oben rechts, der samt
// Feld ebenfalls ausblendet, wenn die Maus ruht. Die Wahl gilt auch für die nächste Folge (storage.local „playerSpeed“).
// Tasten - und + (Haupttastatur und Ziffernblock) ändern die Geschwindigkeit in 0,05er-Schritten.
// Eigenes Shadow-DOM, damit sich Player-Stile und unsere Stile nicht stören. Schalter: Einstellung speedCtl (ab Werk an).
(() => {
  const QUICK = [1, 1.1, 1.25, 1.5], MIN = 0.5, MAX = 2, STEP = 0.05;
  // Überschrift des Player-Menüs, seine Einträge („0.5x“, „Normal“) und der Knopf der Leiste („1x“)
  const LABEL_RE = /^((abspiel|wiedergabe)?geschwindigkeit|playback speed|speed|velocidad( de reproducción)?|vitesse( de lecture)?|velocità( di riproduzione)?|velocidade( de reprodução)?)$/i;
  const OPTION_RE = /^(\d+([.,]\d+)?\s?[x×]|normal|standard|normale)$/i;
  const RATE_RE = /^\d+([.,]\d+)?\s?[x×]$/i;
  const FALLBACK_MS = 8000; // so lange nach einem Menü-Knopf des Players suchen, bevor der Ersatzknopf kommt
  let speed = 1, on = true, en = false, video = null, host = null, ui = null, hideTimer = 0;
  let nativeSeen = false, fallbackTimer = 0, menu = null;
  const hooked = new WeakSet(); // Videos, an denen die Ereignisse schon hängen
  const labeled = new Set(); // Textknoten im Knopf der Leiste, die unseren Wert zeigen
  const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(v * 20) / 20)); // 0,05er-Raster
  // Schreibweise wie der Player selbst: „1x“, „1.25x“
  const fmt = (v) => `${+v.toFixed(2)}x`;
  const ownText = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();
  const bare = (s) => s.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ""); // Pfeile/Zeichen vor und hinter der Überschrift weg

  chrome.storage.sync.get({ active: true, speedCtl: true, uiLang: "de" }, (s) => {
    on = s.active && s.speedCtl; en = s.uiLang === "en";
    chrome.storage.local.get({ playerSpeed: 1 }, (l) => { speed = clamp(+l.playerSpeed || 1); scan(); });
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && c.playerSpeed) { speed = clamp(+c.playerSpeed.newValue || 1); apply(); render(); }
    if (area === "sync" && (c.active || c.speedCtl || c.uiLang)) chrome.storage.sync.get({ active: true, speedCtl: true, uiLang: "de" }, (s) => {
      on = s.active && s.speedCtl; en = s.uiLang === "en";
      if (!on) { if (video) video.playbackRate = 1; undo(); } else scan();
      render();
    });
  });

  // ===== 1. Geschwindigkeit =====

  // Geschwindigkeit setzen; die Seite setzt sie bei neuer Folge/Quelle evtl. zurück -> bei diesen Ereignissen erneut
  function apply() { if (on && video && Math.abs(video.playbackRate - speed) > 0.001) video.playbackRate = speed; }
  // neue Geschwindigkeit wählen (gespeichert, gilt auch für die nächste Folge)
  function choose(v) { speed = clamp(v); apply(); render(); chrome.storage.local.set({ playerSpeed: speed }); }

  // ===== 2. Unser Feld =====

  // Feld im eigenen Shadow-DOM anlegen. kind "menu": im Menü des Players (Schrift und Farben von dort geerbt);
  // kind "float": Ersatzknopf oben rechts im Video, aufklappbar
  function build(kind) {
    host = document.createElement("div");
    host.setAttribute("data-crlf-speed", kind);
    host.style.cssText = kind === "menu" ? "display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box;" : "position:absolute;top:12px;right:12px;z-index:2147483000;";
    const root = host.attachShadow({ mode: "open" });
    const mk = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; parent.append(e); return e; };
    const css = `
      :host { display: block; font: inherit; color: inherit; }
      .w { font-family: inherit; font-weight: 600; font-size: 15px; line-height: 1.2; color: #fff; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; transition: opacity .25s; }
      .menu .w, .w.menu { align-items: stretch; }
      .w.idle { opacity: 0; pointer-events: none; }
      button { font: inherit; color: inherit; cursor: pointer; border: 0; background: transparent; border-radius: 6px; }
      button:hover, button:focus-visible { background: rgba(255,255,255,.12); outline: none; }
      .t { padding: 6px 10px; font-size: 16px; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
      .p { display: none; gap: 14px; padding: 14px 16px 16px; }
      .float .p { border-radius: 8px; background: rgba(35,35,35,.96); min-width: 250px; box-shadow: 0 4px 18px rgba(0,0,0,.4); }
      .open .p, .menu .p { display: grid; }
      .menu .p { padding: 4px var(--pad, 16px) 16px; gap: 12px; min-width: 0; }
      .q { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; min-width: 0; }
      .q button { padding: 9px 0; font-size: 14px; white-space: nowrap; background: rgba(255,255,255,.08); font-variant-numeric: tabular-nums; }
      .q button.on { background: #f47521; color: #000; }
      .s { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-width: 0; }
      input { width: 100%; min-width: 0; accent-color: #f47521; cursor: pointer; margin: 0; }
      output { min-width: 44px; text-align: right; font-size: 14px; font-variant-numeric: tabular-nums; }
`;
    // Stilblatt ohne <style>-Element: unterliegt nicht der CSP der Player-Seite
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); root.adoptedStyleSheets = [sheet]; } catch (e) { mk("style", null, root).textContent = css; }
    const w = mk("div", `w ${kind}`, root);
    if (kind === "float") { const t = mk("button", "t", w); t.type = "button"; t.addEventListener("click", () => w.classList.toggle("open")); }
    const p = mk("div", "p", w); p.setAttribute("role", "group");
    const q = mk("div", "q", p);
    const sl = mk("div", "s", p);
    const r = Object.assign(mk("input", null, sl), { type: "range", min: MIN, max: MAX, step: STEP });
    const o = mk("output", null, sl);
    ui = { w, t: root.querySelector(".t"), q, r, o, p };
    for (const v of QUICK) {
      const b = mk("button", null, q);
      b.type = "button"; b.dataset.v = v; b.textContent = fmt(v);
      b.addEventListener("click", () => choose(v));
    }
    r.addEventListener("input", () => choose(+r.value));
    // Klicks und Tasten im Feld nicht an den Player weitergeben (sonst Pause/Vollbild bzw. Menü zu)
    for (const t of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "wheel"]) host.addEventListener(t, (e) => e.stopPropagation());
    render();
  }

  // Anzeige auf den aktuellen Wert bringen (Feld und Knopf der Leiste)
  function render() {
    if (ui) {
      const title = en ? "Playback speed (keys - / +)" : "Abspielgeschwindigkeit (Tasten - / +)";
      if (ui.t) { ui.t.textContent = fmt(speed); ui.t.title = ui.t.ariaLabel = title; }
      ui.p.ariaLabel = title;
      ui.r.value = speed; ui.o.textContent = fmt(speed);
      for (const b of ui.q.children) b.classList.toggle("on", Math.abs(+b.dataset.v - speed) < 0.001);
    }
    if (on) labelButton();
  }

  // eigenes Feld und alle Eingriffe ins Player-Menü zurücknehmen (Schalter aus)
  function undo() {
    if (host) host.remove();
    host = ui = null;
    for (const r of document.querySelectorAll("[data-crlf-hid]")) { r.style.display = r.getAttribute("data-crlf-hid"); r.removeAttribute("data-crlf-hid"); }
    for (const e of document.querySelectorAll("[data-crlf-minw]")) { e.style.minWidth = e.getAttribute("data-crlf-minw"); e.removeAttribute("data-crlf-minw"); }
    for (const e of document.querySelectorAll("[data-crlf-fs]")) { e.style.fontSize = e.getAttribute("data-crlf-fs"); e.removeAttribute("data-crlf-fs"); }
    for (const n of labeled) n.nodeValue = fmt(1);
    labeled.clear();
    menu = null;
  }

  // ===== 3. Menü des Players =====

  // Menü „Abspielgeschwindigkeit“ suchen: sichtbare Überschrift, darüber der kleinste Kasten mit mindestens zwei
  // Einträgen wie „0.5x“
  function optionLeaves(box) {
    return [...box.querySelectorAll("*")].filter((e) => !e.closest("[data-crlf-speed]") && OPTION_RE.test(ownText(e)));
  }
  function findMenu() {
    if (!document.body) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.length < 60 && LABEL_RE.test(bare(n.nodeValue.trim())) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const head = n.parentElement;
      if (!head || head.closest("[data-crlf-speed]") || !head.getClientRects().length) continue;
      for (let p = head.parentElement, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
        const opts = optionLeaves(p);
        if (opts.length >= 2) return { box: p, head, opts };
      }
    }
    return null;
  }
  // kleinster gemeinsamer Vorfahr
  function common(nodes) {
    let a = nodes[0];
    while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
    return a;
  }
  // Einträge des Menüs ausblenden und unser Feld an ihre Stelle setzen
  function integrate(m) {
    const list = common(m.opts);
    // Liegt die Überschrift in derselben Liste, nur die Zeilen der Einträge ausblenden, sonst die ganze Liste
    const rows = list.contains(m.head)
      ? [...new Set(m.opts.map((o) => { let r = o; while (r.parentElement !== list) r = r.parentElement; return r; }))]
      : [list];
    for (const r of rows) if (!r.hasAttribute("data-crlf-hid")) { r.setAttribute("data-crlf-hid", r.style.display); r.style.setProperty("display", "none", "important"); }
    if (!host || host.getAttribute("data-crlf-speed") !== "menu") { if (host) host.remove(); build("menu"); }
    const last = rows[rows.length - 1];
    if (host.previousElementSibling !== last) last.after(host);
    menu = m.box;
    nativeSeen = true;
    render();
    fit(m);
  }

  // Menü sauber einpassen: Die lange Überschrift „Abspielgeschwindigkeit“ passt im schmalen Player-Menü nicht
  // ganz hinein (abgeschnitten). Dann den Kasten, der abschneidet, um das Nötige verbreitern – solange er im Bild
  // bleibt –, sonst die Überschrift etwas kleiner setzen. Unser Feld rückt so weit ein wie die Überschrift.
  // Rechteck des Textes selbst (ohne Innenabstand des Elements)
  function textBox(el) {
    const n = [...el.childNodes].find((x) => x.nodeType === 3 && x.nodeValue.trim()) || el.firstChild;
    if (!n) return null;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    return r.width ? r : null;
  }
  function fit(m) {
    for (const e of document.querySelectorAll("[data-crlf-minw]")) { e.style.minWidth = e.getAttribute("data-crlf-minw"); e.removeAttribute("data-crlf-minw"); }
    if (m.head.hasAttribute("data-crlf-fs")) { m.head.style.fontSize = m.head.getAttribute("data-crlf-fs"); m.head.removeAttribute("data-crlf-fs"); }
    const chain = [];
    for (let e = m.head; e && e !== document.body && chain.length < 12; e = e.parentElement) chain.push(e);
    const over = () => Math.max(0, ...chain.map((e) => e.scrollWidth - e.clientWidth));
    const need = over();
    if (need > 1) {
      // äußerster abschneidender Kasten (overflow nicht sichtbar) = das Menü-Fenster
      const clip = chain.filter((e) => getComputedStyle(e).overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1).pop()
        || chain.filter((e) => e.scrollWidth > e.clientWidth + 1).pop();
      if (clip) {
        clip.setAttribute("data-crlf-minw", clip.style.minWidth);
        clip.style.minWidth = `${clip.getBoundingClientRect().width + need}px`;
        // rechts so viel Rand wie links neben der Überschrift
        let r = clip.getBoundingClientRect();
        const t = textBox(m.head);
        if (t) { const gap = (t.left - r.left) - (r.right - t.right); if (gap > 0) clip.style.minWidth = `${r.width + gap}px`; }
        r = clip.getBoundingClientRect();
        if (over() > 1 || r.left < 0 || r.right > innerWidth) { clip.style.minWidth = clip.getAttribute("data-crlf-minw"); clip.removeAttribute("data-crlf-minw"); }
      }
      if (over() > 1) {
        // Plan B: Überschrift verkleinern, bis sie passt (höchstens auf 70 %)
        // (Ziel: rechts so viel Rand wie links)
        const fs = parseFloat(getComputedStyle(m.head).fontSize) || 16, t = textBox(m.head);
        const box = (chain.filter((e) => getComputedStyle(e).overflowX !== "visible").pop() || m.head).getBoundingClientRect();
        const avail = t ? box.width - 2 * Math.max(0, t.left - box.left) : m.head.clientWidth;
        m.head.setAttribute("data-crlf-fs", m.head.style.fontSize);
        if (t && avail > 0) m.head.style.fontSize = `${Math.max(fs * 0.7, fs * Math.min(1, avail / t.width))}px`;
      }
    }
    // Einrückung wie die Überschrift
    if (host) {
      const pad = Math.round((textBox(m.head) || m.head.getBoundingClientRect()).left - host.getBoundingClientRect().left);
      host.style.setProperty("--pad", `${pad >= 4 && pad <= 40 ? pad : 16}px`);
    }
  }
  function checkMenu() {
    if (!on || !video) return;
    if (menu && menu.isConnected && host && menu.contains(host) && menu.getClientRects().length) return; // schon erledigt
    const m = findMenu();
    if (m) integrate(m);
  }

  // Knopf „1x“ der Player-Leiste zeigt unseren Wert. Nur der Text wird geändert, das Element gehört dem Player.
  // Irgendein solcher Knopf (auch gerade ausgeblendet) heißt: der Player hat ein eigenes Menü, kein Ersatzknopf nötig.
  // Beschriftet wird nur, wenn genau einer sichtbar ist (mehrere wären eher die Einträge eines Menüs).
  function labelButton() {
    if (!video) return;
    const found = [];
    for (const b of document.querySelectorAll("button, [role=button]")) {
      if (b.closest("[data-crlf-speed]") || (menu && menu.contains(b))) continue;
      const leaf = [b, ...b.querySelectorAll("*")].find((x) => RATE_RE.test(ownText(x)));
      if (leaf) found.push(leaf);
    }
    if (!found.length) return;
    nativeSeen = true;
    if (host && host.getAttribute("data-crlf-speed") === "float") { host.remove(); host = ui = null; }
    const shown = found.filter((x) => x.getClientRects().length);
    if (shown.length !== 1) return;
    const tn = [...shown[0].childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!tn) return;
    labeled.add(tn);
    if (tn.nodeValue.trim() !== fmt(speed)) tn.nodeValue = fmt(speed);
  }

  // ===== 4. Ersatzknopf (Player ohne eigenes Menü) =====

  // Knopf in den Behälter des Videos hängen (im Vollbild bleibt er so sichtbar)
  function place() {
    if (!host || !video || host.getAttribute("data-crlf-speed") !== "float") return;
    const box = video.parentElement;
    if (!box) return;
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    if (host.parentElement !== box) box.appendChild(host);
  }
  // erst nach einer Weile ohne Menü-Knopf des Players anlegen
  function planFallback() {
    if (nativeSeen || host || fallbackTimer) return;
    fallbackTimer = setTimeout(() => {
      fallbackTimer = 0;
      if (!nativeSeen && on && video && !host) { build("float"); place(); wake(); }
    }, FALLBACK_MS);
  }
  // einblenden und nach 2,5 s Ruhe wieder ausblenden, aufgeklappt oder nicht (wie die Player-Leiste)
  function wake() {
    if (!ui || !ui.t) return;
    ui.w.classList.remove("idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!ui || !ui.t) return;
      ui.w.classList.add("idle");
      ui.w.classList.remove("open");
    }, 2500);
  }

  // ===== 5. Ablauf =====

  // Videos der Seite ohne unser eigenes Hintergrundvideo (Design „Video“ im Kalender)
  function vids() { return [...document.querySelectorAll("video")].filter((v) => !v.closest(".crlf-video-layer, #crlf-video")); }
  // größtes Video der Seite suchen, Geschwindigkeit setzen, Menü bzw. Ersatzknopf versorgen
  function scan() {
    if (!on) return;
    const v = vids().sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!v || v.clientWidth < 200) return;
    if (v !== video) {
      video = v;
      if (!hooked.has(v)) {
        hooked.add(v);
        for (const t of ["loadedmetadata", "play", "ratechange"]) v.addEventListener(t, () => setTimeout(apply, 0));
      }
    }
    apply(); checkMenu(); render(); planFallback(); place(); wake();
  }
  // Tasten - / + : langsamer / schneller. Nur auf Abspielseiten bzw. im Player-Rahmen, nicht beim Tippen in Feldern
  // und nicht mit Strg/Alt/Cmd (Strg + - ist der Zoom des Browsers). Ohne Video in diesem Rahmen (Fokus liegt auf der
  // äußeren Seite) wird nur gespeichert; der Player-Rahmen übernimmt den Wert über storage.onChanged.
  addEventListener("keydown", (e) => {
    if (!on || e.ctrlKey || e.altKey || e.metaKey || (e.key !== "-" && e.key !== "+")) return;
    if (!video && !/\/watch\//.test(location.pathname)) return;
    const el = e.composedPath()[0];
    if (el && el.nodeType === 1 && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && el.type !== "range"))) return;
    e.preventDefault(); e.stopPropagation();
    choose(speed + (e.key === "+" ? STEP : -STEP));
    wake();
  }, true);
  addEventListener("mousemove", wake, { passive: true, capture: true });
  addEventListener("fullscreenchange", () => setTimeout(scan, 100));
  // Menü sofort umbauen, sobald der Player es öffnet (vor dem Zeichnen, kein Aufblitzen der alten Einträge);
  // Video und Knopf der Leiste etwas gebündelt nachsehen
  let t = 0;
  new MutationObserver(() => {
    if (on && video) typeof crlfTime === "function" ? crlfTime("Tempo-Menü", () => { checkMenu(); labelButton(); }) : (checkMenu(), labelButton());
    clearTimeout(t); t = setTimeout(scan, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
