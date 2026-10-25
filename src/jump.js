// jump.js – Spul-Knöpfe in der Leiste des Crunchyroll-Players (Nutzerwunsch): −1:30, −30 s und +1:30 direkt hinter
// „10 Sekunden vorspulen“ des Players (alle zusammen links in der Leiste). Die beiden 10-s-Knöpfe gibt es
// schon im Player; sie bleiben, wie sie sind, und bekommen nur eine „10“ ins Symbol, damit alle fünf gleich aussehen.
// Unsere Knöpfe übernehmen Klasse und Pfeil-Symbol der Player-Knöpfe (Größe, Farbe, Ausblenden wie die Leiste) und
// tragen die Sekunden als Zahl im Pfeil. Gespult wird direkt am Video (currentTime), mehrere Klicks hintereinander
// addieren sich. Nach vorne höchstens bis 1 s vor Schluss (dort drückt skip.js „Nächste Folge“).
// Player-DOM (Bitmovin + „katamari“-Leiste, Stand 25.10.): [data-testid=bottom-left-controls-stack] mit
// jump-backward-button, play-pause-button, jump-forward-button. Ohne diese Knöpfe (anderer Player) passiert nichts.
// Keine Schnittstelle, kein Netzverkehr. Schalter: Einstellung jumpBtns (ab Werk an).
(() => {
  const STEPS = [-90, -30, 90]; // Reihenfolge in der Leiste: [−10] ▶ [+10] −1:30 −30 +1:30
  let on = true, en = false;
  const num = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s));
  const SVG = "http://www.w3.org/2000/svg";

  const load = () => chrome.storage.sync.get({ active: true, jumpBtns: true, uiLang: "de" }, (s) => {
    on = s.active && s.jumpBtns; en = s.uiLang === "en";
    on ? scan() : undo();
  });
  load();
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "sync" && (c.active || c.jumpBtns || c.uiLang)) { undo(); load(); }
  });

  // Zahl in den Pfeil schreiben (Pfeil-Symbol 24×24, Kreismitte etwa bei 12/12,6); vierstellige Zahl etwas kleiner
  function mark(svg, s) {
    if (!svg || svg.querySelector("[data-crlf-jump]")) return;
    const t = document.createElementNS(SVG, "text");
    const txt = num(s);
    t.setAttribute("data-crlf-jump", "");
    t.setAttribute("x", "12"); t.setAttribute("y", "15");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", txt.length > 2 ? "5.6" : "7.2");
    t.setAttribute("font-weight", "800");
    t.setAttribute("fill", "currentColor");
    t.setAttribute("style", "font-family:inherit;letter-spacing:-0.2px;pointer-events:none");
    t.textContent = txt;
    svg.append(t);
  }

  // Video zum Player der Leiste (sonst das größte der Seite, ohne unser Hintergrundvideo im Kalender)
  function videoFor(el) {
    const own = (v) => v.closest(".crlf-video-layer, #crlf-video");
    const box = el.closest("#player-container, .player-container, .video-player-wrapper");
    const inBox = box && [...box.querySelectorAll("video")].find((v) => !own(v));
    if (inBox) return inBox;
    return [...document.querySelectorAll("video")].filter((v) => !own(v))
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }

  // um s Sekunden spulen; currentTime liefert nach dem Setzen sofort das Ziel, schnelle Klicks addieren sich also
  function jump(btn, s) {
    const v = videoFor(btn);
    if (!v || !isFinite(v.currentTime)) return;
    const t = v.currentTime, d = v.duration;
    const end = isFinite(d) && d > 0 ? Math.max(t, d - 1) : Infinity;
    try { v.currentTime = Math.max(0, Math.min(end, t + s)); } catch (e) { /* Player lässt nicht spulen */ }
  }

  // eigenen Knopf nach dem Vorbild des Player-Knopfs bauen
  function make(model, s) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = model.className;
    b.setAttribute("data-crlf-jump", String(s));
    const label = en ? `${s < 0 ? "Rewind" : "Forward"} ${num(Math.abs(s))}${Math.abs(s) < 60 ? " seconds" : ""}`
      : `${num(Math.abs(s))}${Math.abs(s) < 60 ? " Sekunden" : ""} ${s < 0 ? "zurückspulen" : "vorspulen"}`;
    b.setAttribute("aria-label", label);
    b.title = label;
    const icon = model.querySelector("svg");
    if (icon) { const c = icon.cloneNode(true); c.querySelectorAll("[data-crlf-jump]").forEach((x) => x.remove()); c.removeAttribute("data-testid"); b.append(c); mark(c, Math.abs(s)); }
    else b.textContent = (s < 0 ? "−" : "+") + num(Math.abs(s));
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); jump(b, s); });
    // nicht an den Player weiterreichen (Klick = Pause, Doppelklick = Vollbild, Leertaste = Pause)
    b.addEventListener("dblclick", (e) => e.stopPropagation());
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
    return b;
  }

  function scan() {
    if (!on) return;
    for (const stack of document.querySelectorAll("[data-testid=bottom-left-controls-stack]")) {
      const back = stack.querySelector("[data-testid=jump-backward-button]");
      const fwd = stack.querySelector("[data-testid=jump-forward-button]");
      if (!back || !fwd) continue;
      mark(back.querySelector("svg"), 10);
      mark(fwd.querySelector("svg"), 10);
      // direkt hinter dem +10: −1:30, −30, +1:30 (Symbol je nach Richtung vom −10- bzw. +10-Knopf)
      let at = fwd;
      for (const s of STEPS) {
        let b = stack.querySelector(`[data-crlf-jump="${s}"]`);
        if (!b) b = make(s < 0 ? back : fwd, s);
        if (b.previousElementSibling !== at) at.after(b);
        at = b;
      }
    }
  }

  function undo() {
    for (const e of document.querySelectorAll("button[data-crlf-jump]")) e.remove();
    for (const e of document.querySelectorAll("text[data-crlf-jump]")) e.remove();
  }

  // Die Leiste entsteht erst mit dem Player (und nach Folgenwechsel neu): Änderungen gebündelt nachsehen
  let timer = 0;
  new MutationObserver(() => {
    if (!on || timer) return;
    timer = setTimeout(() => { timer = 0; scan(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
