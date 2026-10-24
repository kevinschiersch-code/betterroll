// overlay.js – läuft auf allen Crunchyroll-Seiten. Schließt bildschirmfüllende Einblendungen, die von selbst
// erscheinen (z. B. nach der letzten Folge), indem es ihren eigenen ✕-Knopf drückt (Nutzerwunsch; Popup → Erweitert →
// „Player“ ✕, Einstellung autoClose, ab Werk an). Vorsichtig, damit nichts Wichtiges zugeht:
//   - nur Ebenen, die den größten Teil des Fensters bedecken (fest stehend, über der Seite) und einen
//     Schließen-Knopf oben rechts haben
//   - nie mit Videoplayer, Eingabefeldern (Anmeldung, Suche) oder Cookie-Abfrage
//   - nie, wenn man kurz vorher selbst geklickt/getippt hat (dann hat man sie vermutlich selbst geöffnet, z. B. das Menü)
//   - je Ebene nur ein Versuch (geht sie davon nicht zu, bleibt sie offen)
//   - zusätzlich alle Fenster, die die Seite als Dialog kennzeichnet (siehe dialogs()), auch kleinere und im Vollbild
// Gesucht wird nur an einigen Punkten des Fensters (elementFromPoint und Vorfahren), nicht im ganzen Dokument.
(() => {
  let on = true, userAt = 0, timer = 0;
  const tried = new WeakSet(); // Ebenen, die schon einmal geschlossen werden sollten
  // Auf Folgenseiten erst nach 12 s schließen: Am Folgenende zeigt die Seite dort evtl. den Übergang zur nächsten Folge
  // (Autoplay); geht es weiter, ist der Dialog bis dahin von selbst weg. Nach der letzten Folge geht er danach zu.
  const WATCH_WAIT = 12e3, firstSeen = new WeakMap();
  const CLOSE_RE = /^(close|schlie(ß|ss)en|dismiss|×|✕|✖|x)$|close|schlie(ß|ss)en|dismiss/i;
  chrome.storage.sync.get({ active: true, autoClose: true }, (s) => { on = s.active && s.autoClose; check(); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "sync" || !(c.active || c.autoClose)) return;
    chrome.storage.sync.get({ active: true, autoClose: true }, (s) => { on = s.active && s.autoClose; });
  });
  for (const t of ["pointerdown", "keydown", "touchstart"]) addEventListener(t, () => { userAt = Date.now(); }, { capture: true, passive: true });

  // Schließen-Knopf der Ebene: Beschriftung/Titel nach „Schließen“, oder ein Kreuz, und er sitzt im oberen rechten Viertel
  function closeButton(layer, r) {
    for (const b of layer.querySelectorAll('button, [role="button"], a[href="#"], [aria-label]')) {
      const label = [b.getAttribute("aria-label"), b.getAttribute("title"), b.dataset && b.dataset.t, b.textContent].filter(Boolean).join(" ").trim();
      if (!label || label.length > 40 || !CLOSE_RE.test(label)) continue;
      const br = b.getBoundingClientRect();
      if (!br.width || !br.height) continue;
      if (br.left + br.width / 2 < r.left + r.width / 2 || br.top + br.height / 2 > r.top + r.height / 2) continue;
      return b;
    }
    return null;
  }

  // fest stehende Ebenen unter der Fenstermitte und vier weiteren Punkten (jeweils das Element und seine Vorfahren)
  function candidates(vw, vh) {
    const out = new Set();
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
      for (let el = document.elementFromPoint(vw * fx, vh * fy); el && el !== document.body && el !== document.documentElement; el = el.parentElement) out.add(el);
    }
    return out;
  }

  const SKIP_RE = /onetrust|consent|cookie|login|signin|sign-in|auth|search|player/i;
  const FIELDS = 'video, iframe, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select';
  const ident = (el) => `${el.id} ${el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className}`;
  function visible(el) {
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) >= 0.1;
  }
  // Cookie-Abfrage, Anmeldung, Suche, Player: auch in Vorfahren nicht anfassen
  function excluded(el) {
    if (el.closest('[class*="crlf-"], #crlf-theme-toggle, #crlf-tools')) return true;
    for (let a = el; a && a !== document.body; a = a.parentElement) if (SKIP_RE.test(ident(a))) return true;
    return false;
  }
  function close(el, btn) {
    tried.add(el);
    el.style.setProperty("visibility", "hidden", "important"); // nicht erst aufblitzen lassen
    btn.click();
    setTimeout(() => { if (el.isConnected) el.style.removeProperty("visibility"); }, 1500); // ging nicht zu: wieder zeigen
  }

  // Fenster, die sich selbst als Dialog ausweisen (<dialog open>, role="dialog"/"alertdialog", aria-modal) –
  // so markieren Seiten ihre Einblendungen, z. B. das Empfehlungsfenster nach der letzten Folge
  // (dialog.erc-end-slate-recommendations-carousel). Gilt auch im Vollbild und für Fenster beliebiger Lage/Größe
  // (ab 200×150 px). Erscheint ein Dialog kurz nach eigenem Klick/Tippen, hat man ihn selbst geöffnet: dann bleibt er.
  function dialogs(userOpened) {
    for (const d of document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      if (d.tagName === "DIALOG" && !d.open) { tried.delete(d); firstSeen.delete(d); continue; } // zu: beim nächsten Öffnen neu prüfen
      if (tried.has(d) || !visible(d)) continue;
      const r = d.getBoundingClientRect();
      if (r.width < 200 || r.height < 150) continue;
      if (userOpened && !d.matches(".erc-end-slate-recommendations-carousel")) { tried.add(d); continue; } // dieses nie selbst geöffnet
      if (excluded(d) || d.querySelector(FIELDS)) { tried.add(d); continue; }
      const btn = closeButton(d, r);
      if (!btn) continue;
      if (/\/watch\//.test(location.pathname)) {
        if (!firstSeen.has(d)) { firstSeen.set(d, Date.now()); setTimeout(check, WATCH_WAIT + 100); }
        if (Date.now() - firstSeen.get(d) < WATCH_WAIT) continue;
      }
      close(d, btn);
      return true;
    }
    return false;
  }

  // große Einblendung gefunden? Dann ihren ✕-Knopf drücken (je Ebene höchstens einmal)
  function check() {
    if (!on || !document.body) return;
    const userOpened = Date.now() - userAt < 1500; // selbst geöffnet
    if (dialogs(userOpened) || userOpened || document.fullscreenElement) return;
    const vw = innerWidth, vh = innerHeight;
    for (const el of candidates(vw, vh)) {
      if (tried.has(el) || el.closest('[class*="crlf-"], #crlf-theme-toggle, #crlf-tools')) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.6 || r.height < vh * 0.6) continue;
      if (el.querySelector(FIELDS) || SKIP_RE.test(ident(el))) continue;
      const btn = closeButton(el, r);
      if (!btn) continue;
      if (/\/watch\//.test(location.pathname)) {
        if (!firstSeen.has(el)) { firstSeen.set(el, Date.now()); setTimeout(check, WATCH_WAIT + 100); }
        if (Date.now() - firstSeen.get(el) < WATCH_WAIT) continue;
      }
      close(el, btn);
      return;
    }
  }

  // eigene Klassen (crlf-…) und eigene Elemente von BetterRoll lösen keine Prüfung aus
  const site = (v) => (v || "").split(/\s+/).filter((c) => c && !c.startsWith("crlf-")).sort().join(" ");
  const own = (m) => m.type === "attributes" ? m.attributeName === "class" && site(m.oldValue) === site(m.target.getAttribute("class"))
    : typeof crlfOwnMutation === "function" && crlfOwnMutation(m);
  new MutationObserver((muts) => { if (muts.every(own)) return; clearTimeout(timer); timer = setTimeout(() => typeof crlfTime === "function" ? crlfTime("Einblendungen schließen", check) : check(), 60); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"], attributeOldValue: true });
})();
