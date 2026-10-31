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
// Player-Rahmen meldet das Ende per postMessage an die Seite, die die Adresse kennt. Seit 31.10.2026: vorher die
// Player-Leiste per Mausbewegung einblenden; bleibt die Folge 3 s später am Ende stehen, zweiter Versuch mit echten
// Mausereignissen, dann der Link. Findet sich nichts, steht unter „Letzte Fehler“, welche Merkmale die Seite hat.
// Abspann: wird wie Intro über den Knopf des Players übersprungen; was danach noch kommt (Teaser, Szene nach dem
// Abspann), läuft ganz normal bis zur letzten Sekunde. Bleibt der Player nach dem Abspann-Sprung stehen (Zeit 2,5 s
// still), wird er einmal angestoßen (minimal weiterspringen + abspielen); steht er weitere 3 s oder hält von selbst an
// (ohne eigenen Klick), geht es zur nächsten Folge (Nutzerwunsch).
// Was am Folgenende passiert, steht zum Nachvollziehen im Popup unter „Letzte Fehler“ (Ort „Folgenende“).
(() => {
  const WHAT = /intro|opening|vorspann|recap|rückblick|zusammenfassung|credits|abspann|outro|ending/i;
  const VERB = /skip|überspring/i;
  const STABLE_MS = 500, CHECK_MS = 2000, TRIES = 3;
  const END_S = 3, STALL_MS = 1500, OUTRO_NUDGE_MS = 2500, OUTRO_STALL_MS = 3000;
  const NEXT_RE = /^(nächste folge|nächste episode|next episode|up next|als nächstes|siguiente episodio|épisode suivante|prossimo episodio|próximo episódio)$/i;
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
      // Ende: ended, Pause in der letzten Sekunde oder Pause von selbst (ohne eigenen Klick) nach dem Abspann-Sprung
      const pausedAtEnd = type === "pause" && isFinite(v.duration) && v.duration > 60
        && (v.duration - v.currentTime < 1.5 || (outro && Date.now() - userAt > 1500));
      if (type === "ended" || pausedAtEnd) finished(v);
    }, true);
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
  // Je Folge einmal: erst den Knopf „Nächste Folge“ dieses Rahmens drücken; gibt es keinen, übernimmt die Seite
  // (Knopf dort, sonst Link „Nächste Folge“ unter dem Player)
  let doneEp = "", planned = "", userAt = 0;
  for (const t of ["pointerdown", "keydown"]) addEventListener(t, (e) => { if (e.isTrusted) userAt = Date.now(); }, true);
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
    advance(v, 0, `Ende bei ${mmss(v.currentTime)}/${mmss(v.duration)}`);
  }
  // Seit 31.10.2026 blendet der Player seine Leiste (mit „Nächste Folge“) nur bei Mausbewegung ein, und ein Klick wirkt
  // nicht immer. Darum: Leiste wecken, Knopf drücken; ist nach 3 s noch dieselbe Folge am Ende, nochmal mit echten
  // Mausereignissen, dann über den Link. Wer selbst eingreift (Maus/Taste), bekommt keinen weiteren Versuch.
  const TRY_MS = 3000, WAKE_MS = 350;
  function advance(v, n, why) {
    const href = location.href, ep = episode, started = Date.now();
    wake(v);
    setTimeout(() => {
      if (location.href !== href || episode !== ep || !on) return; // schon weiter
      const pre = n ? `${n + 1}. Versuch` : why;
      const btn = n < 2 ? nextButton() : null;
      if (btn) { note(`${pre}: Knopf „Nächste Folge“ gedrückt (${desc(btn)})`); press(btn, n > 0); }
      else if (window.top !== window) { try { window.top.postMessage({ crlfEnded: 1 }, "https://www.crunchyroll.com"); } catch (e) { /* fremde Seite */ } return; }
      else {
        const a = nextLink();
        if (a) { note(`${pre}: Link „Nächste Folge“ geöffnet`); return location.assign(a); }
        if (n >= 1) return note(`${pre}: kein Knopf und kein Link „Nächste Folge“ gefunden (${scan()})`);
      }
      setTimeout(() => {
        if (location.href !== href || episode !== ep || userAt > started || !atEndNow(v)) return;
        advance(v, n + 1, why);
      }, TRY_MS);
    }, WAKE_MS);
  }
  const atEndNow = (v) => v.isConnected && (v.ended || v.paused || v.duration - v.currentTime < 2);
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
  // Zum Nachvollziehen, falls nichts passt: was gibt es auf der Seite an „next“-Elementen und Folgen-Links?
  function scan() {
    const ids = [...new Set([...document.querySelectorAll("[data-testid], [data-t]")]
      .map((el) => el.getAttribute("data-testid") || el.getAttribute("data-t"))
      .filter((x) => /next|up-?next|episode|nächste/i.test(x)))].slice(0, 6);
    return `Merkmale: ${ids.join(", ") || "keine"}; Folgen-Links: ${document.querySelectorAll('a[href*="/watch/"]').length}`;
  }
  if (window.top === window) addEventListener("message", (e) => {
    if ((e.origin === "https://static.crunchyroll.com" || e.origin === location.origin) && e.data && e.data.crlfEnded) goNext();
  });
  function goNext() {
    if (!on || !/\/watch\//.test(location.pathname) || planned === location.href) return;
    planned = location.href;
    const v = playing() || [...document.querySelectorAll("video")].find((x) => !own(x)) || document.body;
    advance(v.tagName === "VIDEO" ? v : { getBoundingClientRect: () => document.body.getBoundingClientRect(), isConnected: true, ended: true }, 0, "Seite");
  }
  // Link zur nächsten Folge: Überschrift „Nächste Folge“ o. Ä., darüber der kleinste Kasten mit einem /watch/-Link zu
  // einer anderen Folge
  function nextLink() {
    const cur = (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1] || "";
    const direct = document.querySelector('[data-t="next-episode"] a[href*="/watch/"]'); // Kasten „Nächste Episode“ unter dem Player
    if (direct) return direct.href;
    // Link mit Kennzeichen „next“ (data-t, data-testid, aria-label, title) zu einer anderen Folge
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
    const now = Date.now(), t = video.currentTime;
    atEnd(video, now, t);
    if (!on) return;
    const d = video.duration;
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
    if (!isFinite(d) || d < 60 || (d - t > END_S && !dry && !outro) || stuck.step >= 2) { stuck.at = -1; return; }
    if (Math.abs(t - stuck.at) > 0.01) { stuck.at = t; stuck.since = now; return; } // läuft noch
    // nach dem Abspann-Sprung erst laden lassen, dann anstoßen, dann aufgeben
    const wait = outro && d - t > END_S ? (stuck.step ? OUTRO_STALL_MS : OUTRO_NUDGE_MS) : d - t > END_S ? 2 * STALL_MS : STALL_MS;
    if (now - stuck.since < wait || now - stuck.when < STALL_MS) return;
    stuck.when = now; stuck.step++;
    const b2 = video.buffered, buf = b2.length ? mmss(b2.end(b2.length - 1)) : "–";
    note(`Hänger bei ${mmss(t)}/${mmss(d)} (Zustand ${video.readyState}, ${video.seeking ? "springt noch, " : ""}geladen bis ${buf}${outro ? ", nach Abspann-Sprung" : ""})`);
    if (on && outro) {
      // Rest nach dem Abspann (Teaser) möglichst zeigen: erst minimal weiterspringen und abspielen, das löst den Player
      // oft; steht er danach wieder, zur nächsten Folge
      if (stuck.step === 1 && d - t > END_S) { try { video.currentTime = t + 0.05; video.play().catch(() => {}); } catch (e) { /* lässt nicht spulen */ } return; }
      stuck.step = 2; return finished(video);
    }
    if (stuck.step === 1) { try { video.currentTime = d; } catch (e) { /* Player lässt nicht spulen */ } }
    else if (!video.ended) video.dispatchEvent(new Event("ended")); // kommt auch bei finished() an
  }

  // eigentlicher Knopf zum Treffer: umgebender Knopf, sonst ein Knopf darin, sonst der Treffer selbst
  const target = (el) => el.closest("button, [role=button], a") || el.querySelector("button, [role=button]") || el;

  // Klick auslösen. Der Treffer kann ein SVG o. Ä. ohne .click() sein (data-testid am Symbol): dann den umgebenden
  // Knopf nehmen bzw. die Mausereignisse selbst schicken, wie ein echter Klick sie liefert
  function press(el, real) {
    const btn = target(el);
    if (!real && typeof btn.click === "function") { btn.click(); return; }
    const r = btn.getBoundingClientRect(), at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ["pointerover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) btn.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, at));
  }
})();
