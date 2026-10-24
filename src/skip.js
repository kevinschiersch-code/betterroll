// skip.js – Intro, Rückblick und Abspann automatisch überspringen (Nutzerwunsch). Läuft wie speed.js in allen Rahmen
// der Crunchyroll-Seiten (Player-iframe). Nutzt nur den eigenen „… überspringen“-Knopf des Players: Ist er 0,5 s
// sichtbar, wird er angeklickt. Springt der Player danach nicht, wird bis zu 3-mal neu geklickt. Kein eigenes Spulen
// (das frühere Warten + 1,5 s Zurück ließ den Player hängen).
// Jeder Abschnitt wird beim ersten Erreichen übersprungen, auch wenn man per Pfeiltasten/Spulen hineingesprungen ist.
// Nur wer danach selbst in einen schon übersprungenen Abschnitt zurückspult, sieht ihn (jede Folge merkt sich die
// Zeitspannen der erledigten Abschnitte).
// Keine Schnittstelle, kein Netzverkehr. Schalter: Einstellung autoSkip (ab Werk an).
// Dazu (unabhängig von autoSkip, nur Hauptschalter): Hängt der Player in den letzten Sekunden einer Folge fest (Video
// „spielt“, die Zeit steht aber 1,5 s still, „ended“ kommt nie, die nächste Folge startet nicht), wird ans Ende
// gesprungen; hilft das nicht, bekommt der Player das fehlende „ended“ selbst gemeldet. Je Folge höchstens einmal.
(() => {
  const WHAT = /intro|opening|vorspann|recap|rückblick|zusammenfassung|credits|abspann|outro|ending/i;
  const VERB = /skip|überspring/i;
  const STABLE_MS = 500, CHECK_MS = 2000, TRIES = 3;
  const END_S = 3, STALL_MS = 1500;
  let on = true, active = true, timer = 0;
  // pro Knopf: { since (sichtbar seit), tries, clickedAt, from, off (stehen lassen) }; wieder frei, sobald er verschwindet
  let state = new WeakMap();
  let seen = [], episode = "", lastClick = 0; // erledigte Abschnitte { start, end } dieser Folge
  let stuck = { at: -1, since: 0, step: 0, when: 0 }; // Hänger am Folgenende: letzte Zeit, seit wann still, Schritt
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
  for (const type of ["playing", "pause", "ended", "emptied"]) {
    document.addEventListener(type, (e) => { if (e.target instanceof HTMLVideoElement && !own(e.target)) arm(); }, true);
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
    const now = Date.now(), t = video.currentTime;
    atEnd(video, now, t);
    if (!on) return;
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
      if (s.clickedAt && now - s.clickedAt < CHECK_MS) continue; // warten, ob der Player springt
      if (now - s.since < STABLE_MS) continue; // erst klicken, wenn der Knopf bereit ist
      if (now - lastClick < CHECK_MS) return; // nie zwei Klicks kurz hintereinander (Knopf und innerer Knopf)
      lastClick = now;
      s.tries++; s.clickedAt = now;
      const from = t;
      video.addEventListener("seeked", () => {
        if (Date.now() - now > 4000) return;
        s.off = true; // gesprungen: erledigt
        if (video.currentTime > from) seen.push({ start: from - 1, end: video.currentTime });
      }, { once: true });
      press(el);
      return;
    }
  }

  // neue Folge = Liste leeren
  function watch(video) {
    const key = location.href + "|" + (video.currentSrc || "");
    if (key !== episode) { episode = key; seen = []; state = new WeakMap(); stuck = { at: -1, since: 0, step: 0, when: 0 }; }
  }

  // Hänger am Folgenende lösen: erst ans Ende springen, 1,5 s später notfalls „ended“ melden (Autoplay der nächsten Folge)
  function atEnd(video, now, t) {
    const d = video.duration;
    if (!isFinite(d) || d < 60 || d - t > END_S || stuck.step >= 2) { stuck.at = -1; return; }
    if (Math.abs(t - stuck.at) > 0.01) { stuck.at = t; stuck.since = now; return; } // läuft noch
    if (now - stuck.since < STALL_MS || now - stuck.when < STALL_MS) return;
    stuck.when = now; stuck.step++;
    if (stuck.step === 1) { try { video.currentTime = d; } catch (e) { /* Player lässt nicht spulen */ } }
    else if (!video.ended) video.dispatchEvent(new Event("ended"));
  }

  // eigentlicher Knopf zum Treffer: umgebender Knopf, sonst ein Knopf darin, sonst der Treffer selbst
  const target = (el) => el.closest("button, [role=button], a") || el.querySelector("button, [role=button]") || el;

  // Klick auslösen. Der Treffer kann ein SVG o. Ä. ohne .click() sein (data-testid am Symbol): dann den umgebenden
  // Knopf nehmen bzw. die Mausereignisse selbst schicken, wie ein echter Klick sie liefert
  function press(el) {
    const btn = target(el);
    if (typeof btn.click === "function") { btn.click(); return; }
    const r = btn.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) btn.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, at));
  }
})();
