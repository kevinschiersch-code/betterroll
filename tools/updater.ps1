# updater.ps1 – Updates für Chrome/Edge/Brave (entpackt installiertes Add-on)
# Wird gestartet
#   - vom Update-Knopf ↻ im Add-on über den Helfer host.ps1 (Native Messaging): -Mode check bzw. -Mode update
#   - unsichtbar bei jeder Windows-Anmeldung (über updater.vbs) als stille Rückfallprüfung: -Mode auto
#   - vom Installer bzw. „Updates einrichten“ nur zum Anmelden des Helfers: -Mode register
# Fragt nur die öffentliche Datei latest.json ab, lädt bei neuerer Version das Paket herunter, prüft dessen SHA-256
# und tauscht die Dateien im Add-on-Ordner aus. Es werden keine Daten gesendet, es braucht keine Anmeldung und keine
# Zugangsdaten. Ergebnis als eine JSON-Zeile auf der Standardausgabe (für den Helfer).
#
# Add-on-Ordner: aus config.json ({"extension": "<Pfad>"}, angelegt von setup-updates.ps1), sonst der Ordner
# des Installers (%LOCALAPPDATA%\BetterRoll\extension). Ausgetauscht wird nur ein Ordner, dessen manifest.json
# wirklich zu BetterRoll gehört.
#
# Das Chrome-Paket enthält unter native\ die aktuelle Fassung dieses Updaters und des Helfers: Sie werden nach
# %LOCALAPPDATA%\BetterRoll kopiert und der Helfer für Chrome, Edge und Brave angemeldet (nur HKCU, nur für das
# eigene Add-on). Eine alte stündliche Aufgabe „BetterRoll-Update“ wird dabei entfernt (keine Zeitpläne mehr).
param([ValidateSet('auto', 'check', 'update', 'register')][string]$Mode = 'auto')
$ErrorActionPreference = 'Stop'
$Base = '__BASE_URL__'
$Root = Join-Path $env:LOCALAPPDATA 'BetterRoll'
$Log  = Join-Path $Root 'update.log'
$Last = Join-Path $Root 'last-check.txt'
$HostName = 'com.betterroll.updater'
$script:Result = @{ ok = $true }

# ===== 1. Hilfen =====

function Write-Log($msg) {
  $line = "{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $msg
  Add-Content -Path $Log -Value $line -Encoding UTF8
  # Protokoll klein halten
  $lines = @(Get-Content $Log -Encoding UTF8)
  if ($lines.Count -gt 200) { $lines | Select-Object -Last 100 | Set-Content $Log -Encoding UTF8 }
}

# letzte Prüfung festhalten (eine Zeile, wird jedes Mal überschrieben), zusätzlich als updater-status.txt im
# Add-on-Ordner: dort lässt sie sich ohne Zugriff auf AppData nachsehen (Chrome ignoriert die Datei)
$script:Ext = $null
function Write-Last($msg) {
  $line = "{0:yyyy-MM-dd HH:mm}  {1}" -f (Get-Date), $msg
  Set-Content -Path $Last -Value $line -Encoding UTF8
  if ($script:Ext -and (Test-Path (Join-Path $script:Ext 'manifest.json'))) {
    try { Set-Content -Path (Join-Path $script:Ext 'updater-status.txt') -Value $line -Encoding UTF8 } catch {}
  }
}

function Test-Newer([string]$a, [string]$b) {
  try { return ([version]$a) -gt ([version]$b) } catch { return $false }
}

# Add-on-Ordner bestimmen
function Get-ExtensionDir {
  $cfg = Join-Path $Root 'config.json'
  if (Test-Path $cfg) {
    $c = Get-Content $cfg -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($c.extension) { return [string]$c.extension }
  }
  return (Join-Path $Root 'extension')
}

# Sicherheitsnetz: nur einen BetterRoll-Ordner anfassen, nie Laufwerk, Benutzerordner, Downloads, Desktop usw.
function Test-OurFolder([string]$dir) {
  $full = [IO.Path]::GetFullPath($dir).TrimEnd('\', '/')
  $forbidden = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:SystemRoot, $env:ProgramFiles, ${env:ProgramFiles(x86)},
    [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments')) |
    Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\', '/') }
  if ($env:USERPROFILE) { $forbidden += [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Downloads')).TrimEnd('\', '/') }
  if ($full.Length -le 3 -or $forbidden -contains $full) { return $false }
  $mf = Join-Path $full 'manifest.json'
  if (-not (Test-Path $mf)) { return $false }
  $m = Get-Content $mf -Raw -Encoding UTF8 | ConvertFrom-Json
  return ($m.manifest_version -eq 3 -and [string]$m.name -match '^(BetterRoll|Crunchyroll|Kalender)')
}

# ID des entpackt geladenen Add-ons: Chrome bildet sie aus dem Ordnerpfad (SHA-256 des Pfads als UTF-16, Laufwerks-
# buchstabe groß, erste 16 Bytes, Ziffern 0-f als Buchstaben a-p). Zusätzlich die IDs, unter denen Chrome/Edge/Brave
# diesen Ordner in den Profil-Einstellungen führen (wird nur gelesen, nichts verlässt den PC).
function Get-ExtensionIds([string]$dir) {
  $p = [IO.Path]::GetFullPath($dir).TrimEnd('\', '/')
  if ($p -match '^[a-zA-Z]:') { $p = $p.Substring(0, 1).ToUpper() + $p.Substring(1) }
  $sha = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($p))
  $ids = @(-join ($sha[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) }))
  $esc = [regex]::Escape(($p -replace '\\', '\\'))
  $profiles = @('Google\Chrome\User Data', 'Microsoft\Edge\User Data', 'BraveSoftware\Brave-Browser\User Data') | ForEach-Object { Join-Path $env:LOCALAPPDATA $_ }
  foreach ($d in $profiles) {
    if (-not (Test-Path $d)) { continue }
    foreach ($prof in Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }) {
      foreach ($f in 'Secure Preferences', 'Preferences') {
        $file = Join-Path $prof.FullName $f
        if (-not (Test-Path $file)) { continue }
        try { $text = [IO.File]::ReadAllText($file) } catch { continue }
        foreach ($m in [regex]::Matches($text, '"path"\s*:\s*"' + $esc + '\\?"', 'IgnoreCase')) {
          $before = [regex]::Matches($text.Substring(0, $m.Index), '"([a-p]{32})"\s*:\s*\{')
          if ($before.Count) { $ids += $before[$before.Count - 1].Groups[1].Value }
        }
      }
    }
  }
  return @($ids | Select-Object -Unique)
}

# Helfer und Updater aus dem Paket (native\) übernehmen, Helfer anmelden, alte stündliche Aufgabe entfernen
function Register-Host([string]$ext) {
  $src = Join-Path $ext 'native'
  if (Test-Path $src) {
    # host.cmd nicht, während sie selbst läuft (cmd liest Stapeldateien zeilenweise nach)
    foreach ($f in @('host.ps1', 'updater.ps1', 'updater.vbs') + @(if ($Mode -ne 'update') { 'host.cmd' })) {
      $from = Join-Path $src $f; $to = Join-Path $Root $f
      if ((Test-Path $from) -and (-not (Test-Path $to) -or (Get-FileHash $from).Hash -ne (Get-FileHash $to).Hash)) { Copy-Item $from $to -Force }
    }
  }
  $cmd = Join-Path $Root 'host.cmd'
  if (-not (Test-Path $cmd)) { return }
  $origins = @(Get-ExtensionIds $ext | ForEach-Object { "chrome-extension://$_/" })
  $json = Join-Path $Root "$HostName.json"
  $manifest = [ordered]@{ name = $HostName; description = 'BetterRoll Updates'; path = $cmd; type = 'stdio'; allowed_origins = $origins }
  [IO.File]::WriteAllText($json, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  foreach ($k in 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser') {
    $key = "HKCU:\Software\$k\NativeMessagingHosts\$HostName"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $json
  }
  # keine Zeitpläne mehr: stündliche Aufgabe früherer Versionen entfernen (Anmeldung bleibt als stille Prüfung)
  try { if (Get-ScheduledTask -TaskName 'BetterRoll-Update' -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName 'BetterRoll-Update' -Confirm:$false } } catch {}
}

# ===== 2. Prüfen und austauschen =====

# nur ein Updater zur Zeit (Knopf und Anmeldung könnten gleichzeitig laufen)
$mutex = New-Object Threading.Mutex($false, 'Local\BetterRollUpdater')
try { $null = $mutex.WaitOne(120000) } catch [Threading.AbandonedMutexException] {}
try {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
  $Ext = Get-ExtensionDir
  if (-not (Test-Path (Join-Path $Ext 'manifest.json'))) { throw "kein Add-on-Ordner: $Ext" }
  if (-not (Test-OurFolder $Ext)) { throw "Ordner sieht nicht nach BetterRoll aus, wird nicht angefasst: $Ext" }
  $script:Ext = $Ext
  $current = (Get-Content (Join-Path $Ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $script:Result.current = $current
  if ($Mode -eq 'register') { Register-Host $Ext; $script:Result.msg = 'Helfer angemeldet' }
  else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # ?t=… umgeht Zwischenspeicher unterwegs, damit eine neue Version schnell ankommt. Bewusst Invoke-WebRequest +
    # ConvertFrom-Json: GitHub liefert .json als text/plain, Invoke-RestMethod gäbe in Windows PowerShell 5 dann nur Text zurück
    $res = Invoke-WebRequest -Uri ("$Base/latest.json?t=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -UseBasicParsing -TimeoutSec 30 -Headers @{ 'Cache-Control' = 'no-cache' }
    $latest = $res.Content | ConvertFrom-Json
    $script:Result.latest = [string]$latest.version
    $script:Result.newer = (Test-Newer $latest.version $current)
    if ($Mode -eq 'check') { }
    elseif (-not $script:Result.newer) { Write-Last "aktuell ($current)"; $script:Result.msg = "aktuell ($current)" }
    else {
      if ($latest.chrome -notmatch '^[A-Za-z0-9._-]+\.zip$' -or $latest.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'latest.json ungültig' }
      $tmp = Join-Path ([IO.Path]::GetTempPath()) ("betterroll-" + [guid]::NewGuid())
      New-Item -ItemType Directory -Path $tmp | Out-Null
      try {
        $zip = Join-Path $tmp 'update.zip'
        Invoke-WebRequest -Uri "$Base/$($latest.chrome)" -OutFile $zip -UseBasicParsing -TimeoutSec 120
        $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
        if ($hash -ne $latest.sha256.ToUpper()) { throw "Prüfsumme passt nicht ($hash)" }
        $new = Join-Path $tmp 'extension'
        Expand-Archive -Path $zip -DestinationPath $new
        $newVersion = (Get-Content (Join-Path $new 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
        if ($newVersion -ne $latest.version) { throw "Paket hat Version $newVersion statt $($latest.version)" }
        # Spracheinstellung des Installers behalten
        $lang = Join-Path $Ext 'lang.json'
        if (Test-Path $lang) { Copy-Item $lang (Join-Path $new 'lang.json') -Force }
        # erst alles Neue hineinkopieren (überschreibt), dann übrig gebliebene alte Dateien entfernen.
        # manifest.json kommt zuletzt, damit das Add-on die neue Version erst sieht, wenn alle Dateien da sind.
        Get-ChildItem $new -Force | Where-Object { $_.Name -ne 'manifest.json' } | Copy-Item -Destination $Ext -Recurse -Force
        $keep = @(Get-ChildItem $new -Force | ForEach-Object { $_.Name }) + 'updater-status.txt'
        Get-ChildItem $Ext -Force | Where-Object { $keep -notcontains $_.Name } | Remove-Item -Recurse -Force
        Copy-Item (Join-Path $new 'manifest.json') (Join-Path $Ext 'manifest.json') -Force
        Write-Log "aktualisiert: $current -> $newVersion ($Ext)"
        Write-Last "aktualisiert: $current -> $newVersion"
        $script:Result.updated = $true; $script:Result.version = $newVersion; $script:Result.msg = "aktualisiert: $current -> $newVersion"
      } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
    # Helfer aktuell halten (nach jedem Lauf außer der reinen Prüfung)
    if ($Mode -ne 'check') { try { Register-Host $Ext } catch { Write-Log "Helfer: $($_.Exception.Message)" } }
  }
} catch {
  $script:Result.ok = $false; $script:Result.msg = $_.Exception.Message
  Write-Log "Fehler: $($_.Exception.Message)"
  Write-Last "Fehler: $($_.Exception.Message)"
} finally {
  try { $mutex.ReleaseMutex() } catch {}
}
$script:Result | ConvertTo-Json -Compress
