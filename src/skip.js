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
// Nächste Folge (mit autoSkip, Nutzerwunsch): In der letzten Sekunde einer Folge (oder bei ended, Pause in der letzten
// Sekunde, obigem Hänger) drückt BetterRoll sofort den Knopf „Nächste Folge“, wenn es einen gibt; sonst öffnet es den
// Link „Nächste Folge“ unter dem Player. Nach der letzten Folge (weder Knopf noch Link) passiert nichts. Der
// Player-Rahmen meldet das Ende per postMessage an die Seite, die die Adresse kennt.
// Abspann gegen Ende einer Folge: Gibt es den Knopf „Nächste Folge“, wird statt „Abspann überspringen“ gleich dieser
// gedrückt (der Sprung ans Ende ließ den Player oft hängen). Hängt es nach einem Abspann-Sprung, geht es ebenso weiter.
// Was am Folgenende passiert, steht zum Nachvollziehen im Popup unter „Letzte Fehler“ (Ort „Folgenende“).
(() => {
  const WHAT = /intro|opening|vorspann|recap|rückblick|zusammenfassung|credits|abspann|outro|ending/i;
  const VERB = /skip|überspring/i;
  const STABLE_MS = 500, CHECK_MS = 2000, TRIES = 3;
  const END_S = 3, STALL_MS = 1500;
  const NEXT_RE = /^(nächste folge|next episode|up next|als nächstes|siguiente episodio|épisode suivante|prossimo episodio|próximo episódio)$/i;
  let on = true, active = true, timer = 0;
  // pro Knopf: { since (sichtbar seit), tries, clickedAt, from, off (stehen lassen) }; wieder frei, sobald er verschwindet
  let state = new WeakMap();
  let seen = [], episode = "", lastClick = 0; // erledigte Abschnitte { start, end } dieser Folge
  let stuck = { at: -1, since: 0, step: 0, when: 0 }; // Hänger am Folgenende: letzte Zeit, seit wann still, Schritt
  let outro = false; // Abspann dieser Folge schon per Knopf übersprungen (danach hängt der Player oft am Ende)
  const OUTRO = /credits|abspann|outro|ending/i;
  const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  // Messung am Folgenende: Einträge unter „Letzte Fehler“ im Popup (Ort „Folgenende“), zum Nachvollziehen von Hängern
  const note = (msg) => { try { chrome.runtime.sendMessage({ type: "crlf-error", where: "Folgenende", msg }).catch(() => {}); } catch (e) { /* Add-on neu geladen */ } };
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
    document.addEventListener(type, (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || own(v)) return;
      arm();
      if (type === "ended" || (type === "pause" && isFinite(v.duration) && v.duration > 60 && v.duration - v.currentTime < 1.5)) finished(v);
    }, true);
  }

  // ===== Nächste Folge =====
  // Je Folge einmal: erst den Knopf „Nächste Folge“ dieses Rahmens drücken; gibt es keinen, übernimmt die Seite
  // (Knopf dort, sonst Link „Nächste Folge“ unter dem Player)
  let doneEp = "", planned = "";
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
  function finished(v) {
    if (!on || !(v.duration > 60)) return;
    watch(v);
    if (doneEp === episode) return;
    doneEp = episode;
    const btn = nextButton();
    if (btn) { note(`Ende bei ${mmss(v.currentTime)}/${mmss(v.duration)}: Knopf „Nächste Folge“ gedrückt`); return press(btn); }
    if (window.top === window) return goNext();
    try { window.top.postMessage({ crlfEnded: 1 }, "https://www.crunchyroll.com"); } catch (e) { /* fremde Seite */ }
  }
  if (window.top === window) addEventListener("message", (e) => {
    if ((e.origin === "https://static.crunchyroll.com" || e.origin === location.origin) && e.data && e.data.crlfEnded) goNext();
  });
  function goNext() {
    if (!on || !/\/watch\//.test(location.pathname) || planned === location.href) return;
    planned = location.href;
    const btn = nextButton();
    if (btn) { note("Seite: Knopf „Nächste Folge“ gedrückt"); return press(btn); }
    const a = nextLink();
    note(a ? "Seite: Link „Nächste Folge“ geöffnet" : "kein Knopf und kein Link „Nächste Folge“ gefunden");
    if (a) location.assign(a);
  }
  // Link zur nächsten Folge: Überschrift „Nächste Folge“ o. Ä., darüber der kleinste Kasten mit einem /watch/-Link zu
  // einer anderen Folge
  function nextLink() {
    const cur = (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1] || "";
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
    const now = Date.now(), t = video.currentTime;
    atEnd(video, now, t);
    if (!on) return;
    const d = video.duration;
    // letzte Sekunde (nach übersprungenem Abspann: letzte 10 s): weiter zur nächsten Folge
    if (d > 60 && (d - t <= 1 || (outro && d - t <= 10))) return finished(video);
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
      // Abspann gegen Ende der Folge: lieber gleich „Nächste Folge“ drücken (Nutzerwunsch; der Sprung des
      // Abspann-Knopfs ans Ende ließ den Player oft hängen). Ohne solchen Knopf wie gewohnt überspringen.
      const isOutro = d > 60 && t > d / 2 && (OUTRO.test(text + " " + testid) || d - t < 300);
      if (isOutro) {
        const nb = nextButton();
        if (nb) {
          s.off = true; doneEp = episode; lastClick = now;
          note(`Abspann bei ${mmss(t)}/${mmss(d)}: statt Überspringen Knopf „Nächste Folge“ gedrückt`);
          press(nb);
          return;
        }
      }
      lastClick = now;
      s.tries++; s.clickedAt = now;
      const from = t;
      video.addEventListener("seeked", () => {
        if (Date.now() - now > 4000) return;
        s.off = true; // gesprungen: erledigt
        if (video.currentTime > from) seen.push({ start: from - 1, end: video.currentTime });
        if (isOutro) { outro = true; note(`Abspann übersprungen: ${mmss(from)} → ${mmss(video.currentTime)} von ${mmss(d)} (kein Knopf „Nächste Folge“ im Player)`); }
      }, { once: true });
      press(el);
      return;
    }
  }

  // neue Folge = Liste leeren
  function watch(video) {
    const key = location.href + "|" + (video.currentSrc || "");
    if (key !== episode) { episode = key; seen = []; state = new WeakMap(); stuck = { at: -1, since: 0, step: 0, when: 0 }; outro = false; }
  }

  // Hänger am Folgenende lösen: erst ans Ende springen, 1,5 s später notfalls „ended“ melden (Autoplay der nächsten Folge)
  function atEnd(video, now, t) {
    const d = video.duration;
    // Daten zu Ende (die angegebene Länge kann etwas über dem letzten Bild liegen): in den letzten 15 s, nichts mehr gepuffert
    const b = video.buffered, dry = video.readyState < 3 && (!b.length || b.end(b.length - 1) - t < 0.5) && d - t <= 15;
    if (!isFinite(d) || d < 60 || (d - t > END_S && !dry && !(outro && d - t <= 30)) || stuck.step >= 2) { stuck.at = -1; return; }
    if (Math.abs(t - stuck.at) > 0.01) { stuck.at = t; stuck.since = now; return; } // läuft noch
    const wait = d - t > END_S ? 2 * STALL_MS : STALL_MS;
    if (now - stuck.since < wait || now - stuck.when < STALL_MS) return;
    stuck.when = now; stuck.step++;
    note(`Hänger bei ${mmss(t)}/${mmss(d)} (Zustand ${video.readyState}${outro ? ", nach Abspann-Sprung" : ""})`);
    if (on && outro) { stuck.step = 2; return finished(video); } // nach Abspann-Sprung: gleich zur nächsten Folge
    if (stuck.step === 1) { try { video.currentTime = d; } catch (e) { /* Player lässt nicht spulen */ } }
    else if (!video.ended) video.dispatchEvent(new Event("ended")); // kommt auch bei finished() an
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
