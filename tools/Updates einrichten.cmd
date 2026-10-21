@echo off
rem Richtet automatische Updates fuer BetterRoll ein (nur fuer diesen Windows-Benutzer, sendet keine Daten).
if not exist "%~dp0setup-updates.ps1" (
  echo Bitte die Zip-Datei zuerst entpacken ^(Rechtsklick - Alle extrahieren^) und dann "Updates einrichten.cmd" im entpackten Ordner starten.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-updates.ps1"
if errorlevel 1 pause
