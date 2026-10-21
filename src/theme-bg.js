// theme-bg.js – eigenes Hintergrundbild (Design „Bild“) und animierter Hintergrund (Design „Video“)
// Teil des Kalender-Designs; Reihenfolge der Dateien im Manifest: theme.js, theme-rating.js, theme-peek.js, theme-bg.js, theme-start.js.
// Alle teilen sich einen Bereich (gleiche Variablen und Funktionen wie früher in einer Datei).

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
// „Wechselnd“ (pageVideo "auto"): alle 60 s ein anderes Motiv, sanft überblendet; gleiche Motive nie direkt nacheinander.
const CRLF_VIDEO_SECS = 60, CRLF_VIDEO_FADE = 2500;
const crlfCalm = matchMedia("(prefers-reduced-motion: reduce)");
let crlfVidFront = 0, crlfVidTimer = 0, crlfVidQueue = [], crlfVidBusy = false;
// nächstes Motiv für „Wechselnd“: Runde reihum nach Motiv (Teil vor „_“: haus, baum, altstadt, leuchtturm …), zufällig gemischt
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
