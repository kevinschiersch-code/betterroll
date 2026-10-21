# BetterRoll

- `release/` – fertige Pakete, die der BetterRoll-Updater auf Windows abholt
- `src/` – Quellcode des Add-ons (Stand der zuletzt gebauten Version; kann neuer sein als `release/`)
- `tools/` – Build-Skript, Installer und Updater (Kopie der Bauumgebung)

## Updates

In `release/` liegen die fertigen Pakete, die der BetterRoll-Updater auf Windows abholt (`release/latest.json` + Zip mit SHA-256-Prüfsumme).
Der Updater fragt nur diese Dateien ab, sendet keine Daten und braucht keine Anmeldung.

Einrichten für ein schon geladenes BetterRoll: `release/BetterRoll-Updates-einrichten.zip` herunterladen, entpacken, „Updates einrichten.cmd“ doppelklicken.

---

Source code (`src/`), build tools (`tools/`) and update files (`release/`) for the BetterRoll browser add-on. The Windows updater only downloads `release/latest.json` and the package it names (checked by SHA-256); it sends no data and needs no login.
