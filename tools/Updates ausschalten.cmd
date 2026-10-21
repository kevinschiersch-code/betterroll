@echo off
rem Schaltet die automatischen Updates fuer BetterRoll wieder aus.
if not exist "%~dp0setup-updates.ps1" (
  echo Bitte die Zip-Datei zuerst entpacken und dann diese Datei im entpackten Ordner starten.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-updates.ps1" -Remove
