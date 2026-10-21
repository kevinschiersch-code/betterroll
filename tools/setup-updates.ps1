# setup-updates.ps1 – richtet Updates für ein schon entpackt geladenes BetterRoll ein
# (für alle, die BetterRoll ohne den Installer per „Entpackte Erweiterung laden“ benutzen).
# Gestartet über „Updates einrichten.cmd“ bzw. mit -Remove über „Updates ausschalten.cmd“.
#
# Was passiert (nur für den angemeldeten Windows-Benutzer, keine Administratorrechte nötig):
#   1. Den BetterRoll-Ordner finden (Downloads, Desktop, Dokumente; sonst Ordnerauswahl).
#   2. updater.ps1, updater.vbs und den Update-Helfer (host.ps1/host.cmd) nach %LOCALAPPDATA%\BetterRoll kopieren,
#      Ordner in config.json merken.
#   3. Helfer für den Knopf ↻ im Add-on anmelden (Native Messaging, nur HKCU) und den Updater bei jeder Anmeldung
#      unsichtbar starten (stille Rückfallprüfung). Kein Zeitplan mehr; eine alte stündliche Aufgabe wird entfernt.
#   4. Einmal sofort prüfen und das Ergebnis anzeigen.
# Es werden keine Daten gesendet und keine Zugangsdaten gespeichert.
param([switch]$Remove, [string]$Extension)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Join-Path $env:LOCALAPPDATA 'BetterRoll'
$TaskName = 'BetterRoll-Update'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$de = (Get-UICulture).TwoLetterISOLanguageName -eq 'de'

# ===== 1. Hilfen =====

function Say([string]$deText, [string]$enText, [string]$icon = 'Information') {
  [void][Windows.Forms.MessageBox]::Show($(if ($de) { $deText } else { $enText }), 'BetterRoll', 'OK', $icon)
}

# gleicher Test wie im Updater: nur echte BetterRoll-Ordner, nie Laufwerk, Benutzerordner, Downloads usw.
function Test-OurFolder([string]$dir) {
  if (-not $dir) { return $false }
  $full = [IO.Path]::GetFullPath($dir).TrimEnd('\', '/')
  $forbidden = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)},
    [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments')) |
    Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\', '/') }
  if ($env:USERPROFILE) { $forbidden += [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Downloads')).TrimEnd('\', '/') }
  if ($full.Length -le 3 -or $forbidden -contains $full) { return $false }
  $mf = Join-Path $full 'manifest.json'
  if (-not (Test-Path $mf)) { return $false }
  try { $m = Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $false }
  return ($m.manifest_version -eq 3 -and [string]$m.name -match '^(BetterRoll|Crunchyroll|Kalender)')
}

# Ordner, die Chrome/Edge/Brave wirklich als entpackte Erweiterung geladen haben: steht in den Profil-Einstellungen
# des Browsers auf diesem PC (wird nur gelesen, nichts davon verlässt den PC)
function Find-FromBrowser {
  $dirs = @('Google\Chrome\User Data', 'Microsoft\Edge\User Data', 'BraveSoftware\Brave-Browser\User Data') | ForEach-Object { Join-Path $env:LOCALAPPDATA $_ }
  $found = @()
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    foreach ($prof in Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }) {
      foreach ($f in 'Secure Preferences', 'Preferences') {
        $file = Join-Path $prof.FullName $f
        if (-not (Test-Path $file)) { continue }
        $text = [IO.File]::ReadAllText($file)
        foreach ($m in [regex]::Matches($text, '"path"\s*:\s*"((?:[^"\\]|\\.)+)"')) {
          $path = [regex]::Unescape($m.Groups[1].Value)
          if ([IO.Path]::IsPathRooted($path) -and (Test-OurFolder $path)) { $found += [IO.Path]::GetFullPath($path).TrimEnd('\') }
        }
      }
    }
  }
  return @($found | Select-Object -Unique)
}

# BetterRoll-Ordner suchen: zuerst, was der Browser geladen hat, sonst übliche Orte bis zwei Ebenen tief;
# bei mehreren gewinnt der zuletzt geänderte
function Find-Extension {
  $loaded = @(Find-FromBrowser)
  if ($loaded.Count) {
    return ($loaded | Sort-Object { (Get-Item (Join-Path $_ 'manifest.json')).LastWriteTime } -Descending | Select-Object -First 1)
  }
  $places = @((Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments')) | Where-Object { $_ -and (Test-Path $_) }
  $hits = foreach ($p in $places) {
    Get-ChildItem $p -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $_
      Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue
    } | Where-Object { Test-OurFolder $_.FullName }
  }
  $hit = $hits | Sort-Object { (Get-Item (Join-Path $_.FullName 'manifest.json')).LastWriteTime } -Descending | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

# Ordner von Hand wählen lassen
function Pick-Extension {
  $dlg = New-Object Windows.Forms.FolderBrowserDialog
  $dlg.Description = $(if ($de) { 'Ordner wählen, den du in Chrome als „Entpackte Erweiterung“ geladen hast (darin liegt manifest.json).' } else { 'Choose the folder you loaded in Chrome as an "unpacked extension" (it contains manifest.json).' })
  $dlg.ShowNewFolderButton = $false
  if ($dlg.ShowDialog() -eq 'OK') { return $dlg.SelectedPath }
  return $null
}

# ===== 2. Ausschalten =====

if ($Remove) {
  Remove-ItemProperty -Path $RunKey -Name $TaskName -ErrorAction SilentlyContinue
  foreach ($k in 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser') { Remove-Item "HKCU:\Software\$k\NativeMessagingHosts\com.betterroll.updater" -ErrorAction SilentlyContinue }
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch {
    Start-Process schtasks.exe -ArgumentList "/Delete /F /TN $TaskName" -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
  }
  Remove-Item (Join-Path $Root 'config.json') -ErrorAction SilentlyContinue
  Say 'Automatische Updates sind ausgeschaltet. BetterRoll selbst bleibt installiert.' 'Automatic updates are turned off. BetterRoll itself stays installed.'
  exit 0
}

# ===== 3. Einrichten =====

try {
  $ext = $Extension
  if (-not (Test-OurFolder $ext)) { $ext = Find-Extension }
  if (-not $ext) {
    Say 'BetterRoll-Ordner nicht gefunden. Bitte im nächsten Fenster den Ordner wählen, den du in Chrome geladen hast.' 'BetterRoll folder not found. Please choose the folder you loaded in Chrome in the next window.'
    $ext = Pick-Extension
    if (-not $ext) { exit 1 }
  }
  if (-not (Test-OurFolder $ext)) {
    Say "In diesem Ordner liegt kein BetterRoll:`n$ext" "This folder does not contain BetterRoll:`n$ext" 'Warning'
    exit 1
  }
  $ext = [IO.Path]::GetFullPath($ext).TrimEnd('\')

  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  foreach ($f in 'updater.ps1', 'updater.vbs', 'host.ps1', 'host.cmd') {
    Copy-Item (Join-Path $Here $f) (Join-Path $Root $f) -Force
    Unblock-File (Join-Path $Root $f) -ErrorAction SilentlyContinue  # Download-Kennzeichen entfernen
  }
  # config.json ohne BOM schreiben (ConvertFrom-Json in PowerShell 5 verträgt beides, andere Werkzeuge nicht)
  [IO.File]::WriteAllText((Join-Path $Root 'config.json'), (@{ extension = $ext } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

  $vbs = Join-Path $Root 'updater.vbs'
  Set-ItemProperty -Path $RunKey -Name $TaskName -Value ('"' + (Join-Path $env:SystemRoot 'System32\wscript.exe') + '" "' + $vbs + '"')
  # Helfer für ↻ anmelden (entfernt auch die stündliche Aufgabe früherer Versionen), dann gleich einmal prüfen
  # (sichtbar warten, damit das Ergebnis feststeht)
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process $ps -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'updater.ps1') + '" -Mode register') -Wait -WindowStyle Hidden
  Start-Process $ps -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'updater.ps1') + '"') -Wait -WindowStyle Hidden
  $last = Get-Content (Join-Path $Root 'last-check.txt') -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if (-not $last) { $last = '-' }
  $last = $last.Trim()

  Say ("Updates sind eingerichtet.`n`nOrdner: $ext`nErgebnis gerade eben: $last`n`nNeue Versionen zeigt BetterRoll im Add-on an: oben auf ↻ klicken lädt sie. Zusätzlich wird bei jeder Windows-Anmeldung still geprüft.") `
      ("Updates are set up.`n`nFolder: $ext`nResult just now: $last`n`nBetterRoll shows new versions in the add-on: click ↻ at the top to get them. It also checks quietly at every Windows sign-in.")
} catch {
  Say ("Einrichten hat nicht geklappt:`n" + $_.Exception.Message) ("Setup failed:`n" + $_.Exception.Message) 'Error'
  exit 1
}
