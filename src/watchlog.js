// watchlog.js – eigener Fortschritt je Folge, nur lokal. Crunchyroll lieferte den Balken bisher im (abgeschalteten)
// Kalender für angemeldete Besucher; BetterRoll misst ihn jetzt selbst beim Ansehen: auf /watch/<ID> der Anteil
// currentTime / duration des Videos, gemerkt in storage.local „epProg“ ({ ID: { p: 0..1, t } }, höchstens 3000 Folgen).
// Keine Anmeldung, keine Abfragen. Der Player steckt teils in einem iframe von static.crunchyroll.com: dort wird nur
// gemessen und der Wert ans Hauptfenster geschickt, das die Folgen-ID aus seiner Adresse kennt.
(() => {
  const KEEP = 3000, EVERY = 15e3;
  const vid = () => [...document.querySelectorAll("video")].find((v) => !v.closest(".crlf-video-layer, #crlf-video") && v.duration > 60);
  const frac = (v) => (v && isFinite(v.duration) && v.duration > 0 ? Math.min(1, v.currentTime / v.duration) : null);

  // im Player-iframe: nur messen und melden
  if (window.top !== window) {
    let last = 0;
    const send = () => { const p = frac(vid()); if (p !== null) window.top.postMessage({ crlfProg: p }, "https://www.crunchyroll.com"); };
    document.addEventListener("timeupdate", () => { if (Date.now() - last > EVERY) { last = Date.now(); send(); } }, true);
    for (const ev of ["pause", "ended", "seeked"]) document.addEventListener(ev, send, true);
    return;
  }

  // Hauptfenster: nur auf Folgenseiten
  const epId = () => (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
  let pending = null, timer = 0, lastSave = 0;
  const save = async () => {
    timer = 0;
    const id = epId();
    if (!id || pending === null) return;
    const p = Math.round(pending * 1000) / 1000;
    pending = null;
    lastSave = Date.now();
    const key = id.toUpperCase();
    const { epProg = {} } = await chrome.storage.local.get("epProg");
    const old = epProg[key];
    if (old && Math.abs(old.p - p) < 0.005) return;
    epProg[key] = { p: old && old.p >= 0.9 ? Math.max(old.p, p) : p, t: Date.now() }; // gesehen bleibt gesehen
    const keys = Object.keys(epProg);
    if (keys.length > KEEP) keys.sort((a, b) => epProg[a].t - epProg[b].t).slice(0, keys.length - KEEP).forEach((k) => delete epProg[k]);
    chrome.storage.local.set({ epProg }).catch(() => {});
  };
  const note = (p, now) => {
    if (typeof p !== "number" || !(p >= 0 && p <= 1) || !epId()) return;
    pending = p;
    if (now || Date.now() - lastSave > EVERY) { clearTimeout(timer); save(); }
    else if (!timer) timer = setTimeout(save, EVERY);
  };
  addEventListener("message", (e) => {
    if (e.origin !== "https://static.crunchyroll.com" && e.origin !== location.origin) return;
    if (e.data && typeof e.data.crlfProg === "number") note(e.data.crlfProg, false);
  });
  document.addEventListener("timeupdate", (e) => { if (e.target === vid()) note(frac(e.target), false); }, true);
  for (const ev of ["pause", "ended", "seeked"]) document.addEventListener(ev, (e) => { if (e.target === vid()) note(frac(e.target), true); }, true);
  addEventListener("pagehide", () => { if (pending !== null) save(); });
})();
