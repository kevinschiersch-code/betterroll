// welcome.js – Willkommensseite: zeigt die Texte in der Sprache der Oberfläche (uiLang) und verlinkt den passenden Kalender.
chrome.storage.sync.get({ uiLang: "de" }, ({ uiLang }) => {
  const lang = uiLang === "en" ? "en" : "de";
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
  document.title = lang === "en" ? "Welcome to BetterRoll" : "Willkommen bei BetterRoll";
  document.getElementById("go").href = lang === "en" ? "https://www.crunchyroll.com/simulcastcalendar" : "https://www.crunchyroll.com/de/simulcastcalendar";
});
