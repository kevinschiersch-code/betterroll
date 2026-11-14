// skip.js – Intro, Rückblick und Abspann automatisch überspringen, am Folgenende weiter zur nächsten Folge, dazu ein
// Fahrtenschreiber fürs Folgenende (Nutzerwunsch). Läuft wie speed.js in allen Rahmen der Crunchyroll-Seiten.
//
// Überspringen (Einstellung autoSkip, ab Werk an): Nutzt nur den eigenen „… überspringen“-Knopf des Players: Ist er
// 0,5 s sichtbar, wird er angeklickt. Springt der Player danach nicht, wird bis zu 3-mal neu geklickt. Kein eigenes
// Spulen (das frühere Warten + 1,5 s Zurück ließ den Player hängen). Jeder Abschnitt wird beim ersten Erreichen
// übersprungen, auch wenn man per Pfeiltasten/Spulen hineingesprungen ist. Nur wer danach selbst in einen schon
// übersprungenen Abschnitt zurückspult, sieht ihn (jede Folge merkt sich die Zeitspannen der erledigten Abschnitte).
// Was nach dem Abspann noch kommt (Teaser, Szene nach dem Abspann), läuft ganz normal bis zur letzten Sekunde.
//
// Nächste Folge (mit autoSkip): in der letzten Sekunde, bei „ended“, wenn der Player in den letzten 5 s (nach dem
// Abspann-Sprung schon früher) von selbst anhält, oder nach einem Hänger (End-Wächter). Dann: Player-Leiste per
// Mausbewegung einblenden und den Knopf „Nächste Folge“ drücken; ist 3 s später noch dieselbe Folge am Ende, zweiter
// Versuch mit echten Mausereignissen; 1,5 s danach der Link „Nächste Folge“ der Seite, als letzter Weg die Adresse der
// nächsten Folge aus dem Crunchyroll-Katalog (crnext.js, nur private Fassung). Nach der letzten Folge passiert nichts.
// Wer selbst eingreift (Maus/Taste), bekommt keinen weiteren Versuch; eine eigene Pause bleibt Pause. Steckt der
// Player in einem Rahmen, meldet der das Ende per postMessage an die Seite, die die Adresse kennt.
//
// End-Wächter (nur Hauptschalter): In den letzten 15 s einer Folge (nach dem Abspann-Sprung oder einem eigenen weiten
// Sprung nach vorn schon ab da) darf die Zeit nicht stillstehen, solange das Video spielen soll. Steht sie (in der
// letzten Sekunde 1,5 s, nach dem Abspann-Sprung 2,5 s, lädt der Player noch 6 s, sonst 3 s), wird der Player einmal
// angestoßen: über eine Lücke im Puffer springen bzw. minimal weiter + abspielen; ist nichts mehr geladen und lädt
// auch nichts (Daten enden vor der angegebenen Länge) oder ist fast Schluss: ans Ende springen. Steht er danach
// weiter, geht es zur nächsten Folge (vorher bekommt der Player das fehlende „ended“ gemeldet). Je Folge einmal.
//
// Pausen-Wächter: Bleibt der Player nach dem Klick auf den Abspann-Knopf in Pause stehen, wird er angestoßen bzw. es
// geht zur nächsten Folge (siehe unten).
//
// Fahrtenschreiber: Ab 90 s vor Schluss (oder ab dem Abspann-Sprung) bis die nächste Folge läuft, wird mitgeschrieben:
// Zeit, Zustand und Puffer des Videos, seine Ereignisse, eigene Eingaben (nur „Klick“/Tastenname) und alles, was
// BetterRoll tut (auch overlay.js über crlfEndRec). Nur lokal: storage.local „endLog“ (die letzten 2 Folgen, dazu die
// letzten 3 mit Hänger o. Ä.); im Popup kopiert „Kopieren“ unter „Letzte Fehler“ das Protokoll mit. Kurze Meldungen
// zusätzlich unter „Letzte Fehler“ (Ort „Folgenende“). Nach einem Add-on-Update (alte Skripte ohne Verbindung) landet
// das Protokoll vorübergehend im localStorage der Seite und wird beim nächsten Laden übernommen. Kein Netzverkehr
// (außer crnext.js).
(() => {
  const WHAT = /intro|opening|vorspann|recap|rückblick|zusammenfassung|credits|abspann|outro|ending/i;
  const VERB = /skip|überspring/i;
  const STABLE_MS = 500, CHECK_MS = 2000, TRIES = 3;
  const END_S = 3, STALL_MS = 1500, OUTRO_NUDGE_MS = 2500, OUTRO_STALL_MS = 3000, LOAD_STALL_MS = 6000;
  const END_ZONE_S = 15, PAUSE_ZONE_S = 5, PAUSE_WAIT_MS = 2000, RESCUE_MS = 2000, TRY_MS = 3000, WAKE_MS = 350;
  const NEXT_RE = /^(nächste folge|nächste episode|next episode|up next|als nächstes|siguiente episodio|épisode suivante|prossimo episodio|próximo episódio)$/i;
  let on = true, active = true, timer = 0;
  // pro Knopf: { since (sichtbar seit), tries, clickedAt, from, off (stehen lassen) }; wieder frei, sobald er verschwindet
  let state = new WeakMap();
  let seen = [], episode = "", lastClick = 0; // erledigte Abschnitte { start, end } dieser Folge
  let stuck = { at: -1, since: 0, step: 0, when: 0 }; // Hänger am Folgenende: letzte Zeit, seit wann still, Schritt
  let outro = false; // Abspann dieser Folge schon per Knopf übersprungen (danach hängt der Player oft am Ende)
  // weit nach vorn gesprungen (z. B. Abspann von Hand übersprungen), nicht beim Fortsetzen gleich nach dem Start;
  // letzte Zeit vor dem Sprung, Beginn der Folge
  let jumped = false, lastT = 0, epAt = 0;
  let doneEp = "", planned = "", userAt = 0;
  const OUTRO = /credits|abspann|outro|ending/i;
  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const epId = () => (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1] || "";
  // kurze Meldung unter „Letzte Fehler“ (Ort „Folgenende“), dazu ins Protokoll
  const note = (msg) => {
    recLine(null, msg);
    try { chrome.runtime.sendMessage({ type: "crlf-error", where: "Folgenende", msg }).catch(() => {}); } catch (e) { /* Add-on neu geladen */ }
  };
  const handled = (t) => seen.some((x) => t >= x.start - 3 && t <= x.end + 3);

  // Schalter lesen (Hauptschalter und autoSkip)
  const load = () => chrome.storage.sync.get({ active: true, autoSkip: true }, (s) => { active = s.active; on = s.active && s.autoSkip; arm(); });
  load();
  chrome.storage.onChanged.addListener((c, area) => { if (area === "sync" && (c.active || c.autoSkip)) load(); });

  // Prüfung alle 0,25 s, aber nur solange in diesem Rahmen ein Video läuft (der Knopf erscheint oft nur per Klassenwechsel).
  // Ohne laufendes Video (Kalender, Serienseiten, Pause) schläft die Prüfung; Start/Pause des Videos weckt sie.
  const own = (v) => v.closest(".crlf-video-layer, #crlf-video"); // eigenes Hintergrundvideo im Kalender
  const playing = () => [...document.querySelectorAll("video")].find((v) => !own(v) && !v.paused && !v.ended);
  function arm() {
    const run = active && !!playing();
    if (run && !timer) timer = setInterval(check, 250);
    else if (!run && timer) { clearInterval(timer); timer = 0; }
  }
  // Medien-Ereignisse steigen nicht auf, kommen aber in der Einfangphase am Dokument an
  const REC_EVENTS = ["waiting", "stalled", "suspend", "pause", "play", "playing", "seeking", "seeked", "ended", "emptied",
    "durationchange", "ratechange", "error", "abort", "loadstart"];
  for (const type of REC_EVENTS) {
    document.addEventListener(type, (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || own(v)) return;
      if (type === "playing" || type === "pause" || type === "ended" || type === "emptied") arm();
      if (type === "ended" && !rec && v.duration > 60) recStart(v, "Folgenende");
      recEvent(v, type);
      if (type === "seeking" && v.duration > 60 && v.duration - v.currentTime < 300 && v.currentTime - lastT > 30 && epAt && Date.now() - epAt > 10e3) jumped = true;
      if (type === "pause") paused(v);
      if (type === "ended") finished(v);
    }, true);
  }
  // eigene Eingaben: danach keine Versuche mehr, eine Pause gilt als gewollt; im Protokoll nur „Klick“ bzw. Tastenname
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, (e) => {
    if (!e.isTrusted) return;
    userAt = Date.now();
    if (rec) recLine(null, `du: ${t === "pointerdown" ? "Klick" : e.key === " " ? "Leertaste" : e.key && e.key.length > 1 ? e.key : "Taste"}`);
  }, true);

  // Pause am Folgenende: in der letzten Sekunde oder nach dem Abspann-Sprung von selbst (ohne eigenen Klick) gleich
  // weiter; hält der Player sonst in den letzten 5 s von selbst an und bleibt 2 s stehen, ebenfalls weiter
  function paused(v) {
    const d = v.duration, t = v.currentTime, at = Date.now();
    if (!isFinite(d) || d <= 60 || v.ended) return;
    if (at - userAt < 1500) return; // eigene Pause
    if (d - t < 1.5 || outro) return finished(v, `Player hält an bei ${mmss(t)}/${mmss(d)}`);
    if (d - t > PAUSE_ZONE_S) return;
    setTimeout(() => {
      if (!v.isConnected || !v.paused || v.ended || userAt > at || Math.abs(v.currentTime - t) > 0.05) return;
      if (rec) rec.bad = true;
      note(`Player hält von selbst an bei ${mmss(t)}/${mmss(d)}`);
      finished(v, "Pause von selbst kurz vor Schluss");
    }, PAUSE_WAIT_MS);
  }

  // ===== Nach einem Update =====
  // Nach Update oder Neuladen des Add-ons laufen in offenen Tabs die alten Skripte ohne Verbindung weiter: Chrome tauscht
  // sie nicht aus, und Crunchyroll wechselt Folgen ohne Neuladen, also bliebe die alte Version bis zum Schließen des
  // Tabs aktiv. Darum beim nächsten Seitenwechsel (z. B. zur nächsten Folge) einmal richtig laden statt nur umschalten.
  if (window.top === window && window.navigation) navigation.addEventListener("navigate", (e) => {
    if ((chrome.runtime && chrome.runtime.id) || e.hashChange || e.downloadRequest || !e.cancelable) return;
    const url = e.destination && e.destination.sameDocument && e.destination.url; // nur Umschalten ohne Laden
    if (!url || new URL(url).origin !== location.origin) return;
    e.preventDefault();
    location.assign(url);
  });

  // ===== Nächste Folge =====
  const NEXT_BTN = /(nächste|next)\s*(folge|episode)|up next|als nächstes/i;
  function nextButton() {
    for (const el of document.querySelectorAll('[data-testid*="next" i], button, [role="button"]')) {
      if (el.closest('[data-crlf-speed], [class*="crlf-"]')) continue;
      const text = label(el), testid = (el.getAttribute("data-testid") || "").toLowerCase();
      if (text.length > 80 || /vorherig|previous|prev\b/i.test(text + " " + testid)) continue;
      if (/next[-_ ]?(episode|video)|up[-_ ]?next/.test(testid) || NEXT_BTN.test(text)) return target(el);
    }
    return null;
  }
  // Je Folge einmal (nur auf Folgenseiten bzw. im Player-Rahmen)
  function finished(v, why) {
    if (!on || !(v.duration > 60)) return;
    if (window.top === window && !/\/watch\//.test(location.pathname)) return;
    watch(v);
    if (doneEp === episode) return;
    doneEp = episode;
    if (!rec) recStart(v, "Folgenende");
    advance(v, 0, why || `Ende bei ${mmss(v.currentTime)}/${mmss(v.duration)}`);
  }
  // Ablauf: Leiste wecken, Knopf drücken; nach 3 s noch dieselbe Folge am Ende: zweiter Versuch mit echten
  // Mausereignissen, dann Link oder Katalog-Adresse. Eigenes Eingreifen (Maus/Taste) beendet den Ablauf.
  function advance(v, n, why) {
    const href = location.href, ep = episode, started = Date.now(), t0 = v.currentTime;
    wake(v);
    setTimeout(async () => {
      if (location.href !== href || episode !== ep || !on) return; // schon weiter
      const pre = n ? `${n + 1}. Versuch` : why;
      const btn = n < 2 ? nextButton() : null;
      if (btn) {
        note(`${pre}: Knopf „Nächste Folge“ gedrückt (${desc(btn)})`);
        if (n && rec) rec.bad = true;
        handoff(); // falls der Knopf die Seite ganz neu lädt
        press(btn, n > 0);
        expectNext(href);
      } else if (window.top !== window) {
        recLine(v, "kein Knopf im Player-Rahmen: Seite übernimmt");
        try { window.top.postMessage({ crlfEnded: 1 }, "https://www.crunchyroll.com"); } catch (e) { /* fremde Seite */ }
        return;
      } else {
        const to = await nextUrl();
        if (location.href !== href || episode !== ep) return;
        if (to) { note(`${pre}: ${to.how} geöffnet`); return go(to.url); }
        if (n >= 1) { if (rec) rec.bad = true; return note(`${pre}: keine nächste Folge gefunden (${scan()})`); }
      }
      setTimeout(() => {
        if (location.href !== href || episode !== ep || userAt > started) return;
        const still = v.ended || v.paused || Math.abs(v.currentTime - t0) < 0.5 || v.duration - v.currentTime < 2;
        if (v.isConnected && still) advance(v, n + 1, why);
      }, n ? TRY_MS / 2 : TRY_MS); // nach dem 2. Knopfdruck schneller zur Adresse
    }, WAKE_MS);
  }
  // Player-Leiste einblenden: Maus über dem Video bewegen (wie ein Mensch)
  function wake(v) {
    const r = v.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.8 };
    const el = document.elementFromPoint(at.clientX, at.clientY) || v;
    for (const t of ["pointerover", "pointerenter", "pointermove", "mouseover", "mousemove"]) {
      try { el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, at)); } catch (e) { /* alter Browser */ }
    }
  }
  const desc = (el) => (el.getAttribute("data-testid") || el.getAttribute("data-t") || label(el) || el.tagName.toLowerCase()).slice(0, 50);
  // Zum Nachvollziehen: was gibt es auf der Seite an „next“-Elementen und Folgen-Links?
  function scan() {
    const ids = [...new Set([...document.querySelectorAll("[data-testid], [data-t]")]
      .map((el) => el.getAttribute("data-testid") || el.getAttribute("data-t"))
      .filter((x) => /next|up-?next|episode|nächste|end|autoplay|countdown|slate|card/i.test(x)))].slice(0, 8);
    return `Merkmale: ${ids.join(", ") || "keine"}; Folgen-Links: ${document.querySelectorAll('a[href*="/watch/"]').length}`;
  }
  // Lage am Folgenende fürs Protokoll: Knopf, offene Fenster, Merkmale
  function snap() {
    const btn = nextButton();
    const dlg = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')]
      .filter((d) => d.getBoundingClientRect().width > 0)
      .map((d) => String(d.getAttribute("data-testid") || d.getAttribute("class") || d.tagName).slice(0, 40));
    return `Knopf „Nächste Folge“: ${btn ? desc(btn) + (visible(btn) ? "" : " (unsichtbar)") : "keiner"} · Fenster: ${dlg.slice(0, 3).join(", ") || "keine"} · ${scan()}`;
  }
  if (window.top === window) addEventListener("message", (e) => {
    if ((e.origin === "https://static.crunchyroll.com" || e.origin === location.origin) && e.data && e.data.crlfEnded) goNext();
  });
  function goNext() {
    if (!on || !/\/watch\//.test(location.pathname) || planned === location.href) return;
    planned = location.href;
    const v = [...document.querySelectorAll("video")].find((x) => !own(x));
    advance(v || { getBoundingClientRect: () => document.body.getBoundingClientRect(), isConnected: true, ended: true, currentTime: 0, duration: 0 }, 0, "Player-Rahmen meldet Ende");
  }
  // Adresse der nächsten Folge: Link der Seite, sonst Katalog (crnext.js, nur private Fassung)
  async function nextUrl() {
    const a = nextLink();
    if (a) return { url: a, how: "Link „Nächste Folge“" };
    if (typeof crlfNextUrl !== "function" || !epId()) return null;
    try {
      const u = await crlfNextUrl(epId());
      return u ? { url: u, how: "Katalog-Adresse der nächsten Folge" } : null;
    } catch (e) { recLine(null, `Katalog: ${(e && e.message) || e}`); return null; }
  }
  // vor einem Seitenwechsel: Protokoll sichern und der neuen Seite sagen, dass sie es fortsetzt (sessionStorage)
  function handoff() {
    try { if (rec) sessionStorage.setItem("crlf-endrec-open", JSON.stringify({ id: rec.id, t: Date.now() })); } catch (e) { /* gesperrt */ }
    return recFlush();
  }
  async function go(url) {
    await Promise.race([handoff(), new Promise((r) => setTimeout(r, 400))]);
    location.assign(url);
  }
  // Link zur nächsten Folge: Kasten „Nächste Episode“, Link mit Kennzeichen „next“, sonst Überschrift „Nächste Folge“
  // o. Ä. und darüber der kleinste Kasten mit einem /watch/-Link zu einer anderen Folge
  function nextLink() {
    const cur = epId();
    const direct = document.querySelector('[data-t="next-episode"] a[href*="/watch/"]'); // Kasten „Nächste Episode“ unter dem Player
    if (direct) return direct.href;
    for (const a of document.querySelectorAll('a[href*="/watch/"]')) {
      const box = a.closest("[data-t], [data-testid]");
      const tag = [a.getAttribute("data-t"), a.getAttribute("data-testid"), a.getAttribute("aria-label"), a.getAttribute("title"), box && (box.getAttribute("data-t") || box.getAttribute("data-testid"))].filter(Boolean).join(" ");
      const id = (a.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
      if (id && id.toUpperCase() !== cur.toUpperCase() && /next|up-?next|nächste/i.test(tag) && !/prev|vorherig/i.test(tag)) return a.href;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.length < 40 && NEXT_RE.test(n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let p = n.parentElement, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
        const a = [...p.querySelectorAll('a[href*="/watch/"]')].find((x) => {
          const id = (x.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
          return id && id.toUpperCase() !== cur.toUpperCase();
        });
        if (a) return a.href;
      }
    }
    return "";
  }

  // Beschriftung eines Knopfs (aria-label, title, Text)
  const label = (el) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  // sichtbar und groß genug?
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05;
  };

  function check() {
    const video = playing();
    if (!video) return arm(); // Video weg oder angehalten: schlafen bis zum nächsten Start
    watch(video);
    const now = Date.now(), t = video.currentTime, d = video.duration;
    if (!video.seeking) lastT = t;
    recTick(video, now, t, d);
    guard(video, now, t);
    if (!on) return;
    // letzte Sekunde: weiter zur nächsten Folge
    if (d > 60 && d - t <= 1) return finished(video);
    const list = document.querySelectorAll('[data-testid*="skip" i], button, [role="button"]');
    for (let el of list) {
      if (el.closest("[data-crlf-speed]")) continue;
      const text = label(el);
      if (text.length > 60) continue; // ganze Leisten/Menüs, nicht ein Knopf
      const testid = (el.getAttribute("data-testid") || "").toLowerCase();
      if (!(testid.includes("skip") || (VERB.test(text) && WHAT.test(text)))) continue;
      el = target(el); // Hülle mit innerem Knopf: den Knopf nehmen (sonst kommt der Klick nicht an)
      if (!visible(el)) { state.delete(el); continue; }
      let s = state.get(el);
      if (!s) {
        // zurückgespult in einen schon übersprungenen Abschnitt: stehen lassen
        s = { since: now, tries: 0, clickedAt: 0, off: handled(t) };
        state.set(el, s);
      }
      if (s.off || s.tries >= TRIES) continue;
      if (video.seeking) return; // Player springt noch (langsames Laden): nicht erneut klicken
      if (s.clickedAt && now - s.clickedAt < CHECK_MS) continue; // warten, ob der Player springt
      if (now - s.since < STABLE_MS) continue; // erst klicken, wenn der Knopf bereit ist
      if (now - lastClick < CHECK_MS) return; // nie zwei Klicks kurz hintereinander (Knopf und innerer Knopf)
      const isOutro = d > 60 && t > d / 2 && (OUTRO.test(text + " " + testid) || d - t < 300); // Abspann gegen Ende
      lastClick = now;
      s.tries++; s.clickedAt = now;
      const from = t;
      if (isOutro) { recStart(video, "Abspann-Knopf"); recLine(video, `Abspann-Knopf gedrückt (${desc(el)}, ${s.tries}. Klick)`); rescue(video, now); }
      // „seeking“ kommt sofort mit dem Ziel, auch wenn das Laden dauert (auf „seeked“ zu warten, ließ bei langsamem
      // Laden den Abspann-Merker aus und den Knopf ein zweites Mal drücken)
      video.addEventListener("seeking", () => {
        if (Date.now() - now > 4000) return;
        s.off = true; // gesprungen: erledigt
        if (video.currentTime > from) seen.push({ start: from - 1, end: video.currentTime });
        if (isOutro) { outro = true; note(`Abspann übersprungen: ${mmss(from)} → ${mmss(video.currentTime)} von ${mmss(d)}`); }
      }, { once: true });
      press(el);
      return;
    }
  }

  // neue Folge = Liste leeren; ein offenes Protokoll endet, sobald eine andere Folge läuft
  function watch(video) {
    const key = location.href + "|" + (video.currentSrc || "");
    if (key === episode) return;
    if (rec && rec.key !== key) { clearTimeout(nextTimer); recStop(`andere Folge läuft: ${pagePath()}`); }
    episode = key; seen = []; state = new WeakMap(); stuck = { at: -1, since: 0, step: 0, when: 0 }; outro = false; jumped = false; epAt = Date.now();
  }

  // ===== End-Wächter =====
  // Ziel fürs Anstoßen: über eine Lücke im Puffer zum nächsten geladenen Stück, mitten in geladenen Daten minimal weiter;
  // null = vor uns ist nichts geladen
  function gapTarget(v, t) {
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.end(i) <= t + 0.3) continue; // liegt hinter uns bzw. endet gleich
      return b.start(i) > t + 0.01 ? b.start(i) + 0.05 : t + 0.05;
    }
    return null;
  }
  function guard(video, now, t) {
    const d = video.duration, left = d - t;
    if (!isFinite(d) || d < 60 || stuck.step >= 2 || (left > END_ZONE_S && !outro && !jumped)) { stuck.at = -1; return; }
    if (stuck.at < 0 || Math.abs(t - stuck.at) > 0.02) { stuck.at = t; stuck.since = now; return; } // läuft noch
    if (now - userAt < 4000) { stuck.since = now; return; } // eben selbst gespult/geklickt: dem Player Zeit lassen
    const gap = gapTarget(video, t), loading = gap === null && video.networkState === 2;
    const wait = stuck.step ? (outro && left > END_S ? OUTRO_STALL_MS : STALL_MS)
      : left <= 1.5 ? STALL_MS : outro ? OUTRO_NUDGE_MS : loading ? LOAD_STALL_MS : left <= END_S ? STALL_MS : 2 * STALL_MS;
    if (now - stuck.since < wait || now - stuck.when < STALL_MS) return;
    stuck.when = now; stuck.step++;
    if (rec) rec.bad = true;
    const b = video.buffered, buf = b.length ? mmss(b.end(b.length - 1)) : "–";
    note(`Hänger bei ${mmss(t)}/${mmss(d)} (Zustand ${video.readyState}, ${video.seeking ? "springt noch, " : ""}geladen bis ${buf}${outro ? ", nach Abspann-Sprung" : ""})`);
    recLine(video, `Wächter ${stuck.step}: Zeit steht seit ${((now - stuck.since) / 1000).toFixed(1)} s · ${vstate(video)} · ${snap()}`);
    if (stuck.step === 1) {
      // nach dem Abspann-Sprung kurz vor Schluss: gleich weiter
      if (outro && left <= END_S) { stuck.step = 2; return finished(video, "Hänger kurz vor Schluss"); }
      // Rest (Teaser) möglichst zeigen: über die Lücke bzw. minimal weiter und abspielen, das löst den Player oft;
      // kommt nichts mehr (nichts geladen, lädt auch nicht) und war kein Sprung: Daten enden vor der Länge -> ans Ende
      const to = left <= 1.5 ? d : gap !== null ? gap : outro || jumped || loading ? t + 0.05 : d;
      try { video.currentTime = to; video.play().catch(() => {}); } catch (e) { /* Player lässt nicht spulen */ }
      recLine(video, to === d ? "Wächter: ans Ende gesprungen" : `Wächter: angestoßen, weiter bei ${ft(to)}`);
      stuck.at = video.currentTime; stuck.since = now;
      return;
    }
    // steht weiter: zur nächsten Folge
    if (outro) return finished(video, "Hänger nach Abspann-Sprung");
    if (!video.ended) { recLine(video, "Wächter: „ended“ gemeldet"); video.dispatchEvent(new Event("ended")); } // kommt auch bei finished() an
  }

  // ===== Pausen-Wächter =====
  // Seit 11/2026 hält der Player beim Abspann-Sprung an und spielt oft nicht weiter (Pause mitten im Abspann mit
  // leerem Puffer oder Pause am Sprungziel kurz vor Schluss). Die Prüfung oben schläft bei Pause, darum läuft nach dem
  // Klick auf den Abspann-Knopf dieser eigene Takt: Steht das Video 2 s in Pause (ohne eigene Eingabe), wird in den
  // letzten 5 s gleich zur nächsten Folge gewechselt, sonst erst Abspielen angestoßen (Weg 1) und, wenn es 3 s später
  // weiter steht, zur nächsten Folge gewechselt (Knopf, danach Adresse: Weg 2). Endet, sobald das Video 2 s läuft.
  let rescueTimer = 0;
  function rescue(v, since) {
    clearInterval(rescueTimer);
    const ep = episode;
    let pos = v.currentTime, still = since, step = 0, moving = 0;
    const stop = () => { clearInterval(rescueTimer); rescueTimer = 0; };
    rescueTimer = setInterval(() => {
      const now = Date.now(), t = v.currentTime, d = v.duration;
      if (episode !== ep || doneEp === ep || !v.isConnected || !on || userAt > since || now - since > 90e3) return stop();
      if (v.seeking) { still = now; return; }
      if (Math.abs(t - pos) > 0.02) { pos = t; still = now; if (!v.paused && ++moving >= 4) stop(); return; }
      moving = 0;
      if ((!step && !v.paused) || now - still < (step ? 3000 : RESCUE_MS)) return; // läuft, aber steht: End-Wächter
      if (rec) rec.bad = true;
      if (step || v.ended || !(d - t > PAUSE_ZONE_S)) {
        stop();
        note(`Player steht nach Abspann-Knopf bei ${mmss(t)}/${mmss(d)}${step ? " (auch nach Anstoßen)" : ""}`);
        return finished(v, "Stillstand nach Abspann-Knopf");
      }
      step = 1; still = now;
      note(`Player bleibt nach Abspann-Knopf in Pause bei ${mmss(t)}/${mmss(d)}: Abspielen angestoßen`);
      recLine(v, `Pausen-Wächter: ${vstate(v)}`);
      try { v.play().catch((e) => recLine(v, `Abspielen abgelehnt (${(e && e.name) || e})`)); } catch (e) { /* kein Video mehr */ }
    }, 500);
  }

  // eigentlicher Knopf zum Treffer: umgebender Knopf, sonst ein Knopf darin, sonst der Treffer selbst
  const target = (el) => el.closest("button, [role=button], a") || el.querySelector("button, [role=button]") || el;

  // Klick auslösen. Der Treffer kann ein SVG o. Ä. ohne .click() sein (data-testid am Symbol): dann den umgebenden
  // Knopf nehmen bzw. die Mausereignisse selbst schicken, wie ein echter Klick sie liefert (real: immer so)
  function press(el, real) {
    const btn = target(el);
    if (!real && typeof btn.click === "function") { btn.click(); return; }
    const r = btn.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) btn.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, at));
  }

  // ===== Fahrtenschreiber =====
  const REC_BEFORE_S = 90, REC_KEEP = 2, REC_BAD = 3, REC_MAX = 100, START_WAIT_MS = 15e3;
  let rec = null, recV = null, recT = 0, recMove = { t: -1, at: 0 }, recAt = 0, recOdd = false, recOddSince = 0, nextTimer = 0;
  const recEvAt = {};
  const VER = (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return "?"; } })();
  const ft = (x) => (isFinite(x) ? `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, "0")}` : "–");
  const pagePath = () => location.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2,3})?\//i, "/").slice(0, 90);
  // Zustand des Videos: readyState/networkState, Schalter, geladene Stücke ab 5 s vor der aktuellen Zeit
  function vstate(v) {
    if (!v || !v.buffered) return "kein Video";
    const b = v.buffered, parts = [];
    for (let i = 0; i < b.length; i++) if (b.end(i) > v.currentTime - 5) parts.push(`${ft(b.start(i))}–${ft(b.end(i))}`);
    const flags = [v.paused && "Pause", v.seeking && "springt", v.ended && "Ende", v.error && `Fehler ${v.error.code}`].filter(Boolean).join(", ");
    return `Zustand ${v.readyState}/${v.networkState}${flags ? ", " + flags : ""} · Puffer ${parts.slice(0, 3).join(", ") || "leer"} · Länge ${ft(v.duration)}`;
  }
  const recOk = () => window.top !== window || /\/watch\//.test(location.pathname); // nur Folgenseiten bzw. Player-Rahmen
  function recStart(v, why) {
    if (!active || !recOk()) return;
    watch(v);
    if (rec) return;
    recV = v; recMove = { t: -1, at: 0 }; recAt = 0; recOdd = false;
    rec = { id: Date.now() + Math.random(), at: Date.now(), page: pagePath(), frame: window.top === window ? "Seite" : "Player-Rahmen", ver: VER, key: episode, lines: [] };
    recLine(v, `Start (${why}) · Tempo ${v.playbackRate}x · Auto-Skip ${on ? "an" : "aus"} · ${vstate(v)}`);
    // Katalog vorab fragen, damit die Adresse am Ende schon da ist
    if (window.top === window && typeof crlfNextUrl === "function" && epId()) crlfNextUrl(epId()).then(
      (u) => recLine(null, u ? `Katalog: nächste Folge ${u.replace(/^https?:\/\/[^/]+/, "")}` : "Katalog: keine nächste Folge"),
      (e) => recLine(null, `Katalog: ${(e && e.message) || e}`));
  }
  function recLine(v, text) {
    if (!rec) return;
    v = v || recV;
    const s = ((Date.now() - rec.at) / 1000).toFixed(1).padStart(6), t = v && isFinite(v.currentTime) ? ft(v.currentTime) : "";
    rec.lines.push(`${s}s ${t.padStart(7)}  ${String(text).replace(/\s+/g, " ")}`.slice(0, 240));
    if (rec.lines.length > REC_MAX) rec.lines.splice(1, rec.lines.length - REC_MAX); // erste Zeile (Start) bleibt
    if (!recT) recT = setTimeout(recFlush, 2000);
  }
  globalThis.crlfEndRec = (text) => recLine(null, text); // für overlay.js
  // gespeicherte Protokolle: neuestes zuerst, höchstens REC_KEEP
  // die letzten REC_KEEP Folgen, dazu die letzten REC_BAD mit Hänger o. Ä. (sonst verdrängen gute Folgen den Fall)
  const recMerge = (list, item) => {
    const all = [item, ...(list || []).filter((x) => x && x.id !== item.id)].sort((a, b) => b.at - a.at);
    const keep = new Set([...all.slice(0, REC_KEEP), ...all.filter((x) => x.bad).slice(0, REC_BAD)]);
    return all.filter((x) => keep.has(x));
  };
  async function recFlush() {
    clearTimeout(recT); recT = 0;
    if (!rec) return;
    const item = { id: rec.id, at: rec.at, page: rec.page, frame: rec.frame, ver: rec.ver, bad: !!rec.bad, lines: rec.lines.slice() };
    const local = () => { try { localStorage.setItem("crlf-endrec", JSON.stringify(item)); } catch (e) { /* voll/gesperrt */ } };
    if (!alive()) return local();
    try {
      const { endLog } = await chrome.storage.local.get("endLog");
      await chrome.storage.local.set({ endLog: recMerge(endLog, item) });
    } catch (e) { local(); }
  }
  function recStop(text) {
    if (!rec) return;
    if (text) recLine(null, text);
    try { sessionStorage.removeItem("crlf-endrec-open"); } catch (e) { /* gesperrt */ }
    recFlush(); // liest das Protokoll sofort, schreibt danach
    rec = null; recV = null;
  }
  // je Prüfung (0,25 s): normaler Lauf alle 10 s eine Zeile, sonst (Zeit steht, lädt, springt) jede Sekunde
  function recTick(v, now, t, d) {
    if (!rec && d > 60 && d - t <= REC_BEFORE_S && d - t > 0) recStart(v, "letzte 90 s");
    if (!rec) return;
    recV = v;
    if (Math.abs(t - recMove.t) > 0.02) recMove = { t, at: now };
    const still = now - recMove.at > 700, odd = still || v.readyState < 3 || v.seeking;
    if (odd !== recOdd) { recOdd = odd; recOddSince = now; recAt = 0; }
    if (now - recAt < (!odd ? 10e3 : now - recOddSince > 20e3 ? 5e3 : 1e3)) return;
    recAt = now;
    recLine(v, `${still ? "steht" : "läuft"} · ${vstate(v)}`);
  }
  function recEvent(v, type) {
    if (!rec || (recV && v !== recV && !(v.duration > 60))) return;
    const now = Date.now();
    if (now - (recEvAt[type] || 0) < 1000 && type !== "ended" && type !== "pause") return; // gleiche Meldung gehäuft
    recEvAt[type] = now;
    const more = type === "ratechange" ? ` (${v.playbackRate}x)` : /waiting|stalled|error|durationchange|emptied|loadstart|ended|pause/.test(type) ? ` · ${vstate(v)}` : "";
    recLine(v, `Ereignis ${type}${more}`);
  }
  // nach dem Wechsel: läuft die neue Folge binnen 15 s? Sonst festhalten und einmal Abspielen anstoßen
  function expectNext(fromHref) {
    clearTimeout(nextTimer);
    const since = Date.now();
    nextTimer = setTimeout(() => {
      if (!rec) return;
      if (fromHref && location.href === fromHref) return recStop("keine andere Folge geladen");
      const v = [...document.querySelectorAll("video")].find((x) => !own(x));
      if (v && !v.paused && !v.ended) return recStop(`nächste Folge läuft: ${pagePath()}`);
      if (rec) rec.bad = true;
      note(`Nächste Folge startet nicht von selbst (${pagePath()}, ${vstate(v)})`);
      if (!v || !on || userAt > since || !v.paused || v.currentTime > 5) return recStop();
      v.play().then(() => recStop("Abspielen angestoßen: läuft"), (e) => recStop(`Abspielen abgelehnt (${(e && e.name) || e})`));
    }, START_WAIT_MS);
  }
  if (window.top === window) {
    // Protokoll aus der Zeit ohne Verbindung (nach Update) übernehmen
    try {
      const s = localStorage.getItem("crlf-endrec");
      if (s && alive()) {
        localStorage.removeItem("crlf-endrec");
        const item = JSON.parse(s);
        chrome.storage.local.get("endLog").then(({ endLog }) => chrome.storage.local.set({ endLog: recMerge(endLog, item) })).catch(() => {});
      }
    } catch (e) { /* gesperrt */ }
    // nach Seitenwechsel durch BetterRoll: Protokoll fortsetzen, bis die neue Folge läuft
    try {
      const o = JSON.parse(sessionStorage.getItem("crlf-endrec-open") || "null");
      sessionStorage.removeItem("crlf-endrec-open");
      if (o && o.id && Date.now() - o.t < 60e3 && alive()) chrome.storage.local.get("endLog").then(({ endLog }) => {
        const item = (endLog || []).find((x) => x && x.id === o.id);
        if (!item || rec) return;
        rec = { ...item, key: null };
        episode = ""; // die erste Folge, die hier läuft, beendet das Protokoll (auch wenn sie schon lief)
        recLine(null, `Seite geladen: ${pagePath()}`);
        expectNext(null);
      }).catch(() => {});
    } catch (e) { /* gesperrt */ }
    addEventListener("pagehide", () => { if (rec) recFlush(); });
  }
})();
