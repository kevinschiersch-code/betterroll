# host.ps1 – Update-Helfer für den Knopf ↻ im Add-on (Native Messaging von Chrome/Edge/Brave, gestartet über host.cmd).
# Nimmt genau eine Nachricht an – {"cmd":"check"} oder {"cmd":"update"} –, führt updater.ps1 im selben Ordner aus und
# antwortet mit dessen Ergebnis. Der Browser lässt nur das eigene Add-on zu (allowed_origins). Nichts wird gesendet.
$ErrorActionPreference = 'Stop'
$stdin = [Console]::OpenStandardInput()
$stdout = [Console]::OpenStandardOutput()

# genau n Bytes lesen (Nachrichten kommen als 4 Byte Länge + UTF-8-JSON)
function Read-Bytes([int]$n) {
  $buf = New-Object byte[] $n; $got = 0
  while ($got -lt $n) { $r = $stdin.Read($buf, $got, $n - $got); if ($r -le 0) { return $null }; $got += $r }
  return , $buf
}
function Send-Message($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $stdout.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

try {
  $len = Read-Bytes 4
  if (-not $len) { exit 0 }
  $size = [BitConverter]::ToInt32($len, 0)
  if ($size -le 0 -or $size -gt 4096) { throw 'ungültige Nachricht' }
  $msg = [Text.Encoding]::UTF8.GetString((Read-Bytes $size)) | ConvertFrom-Json
  $mode = if ($msg.cmd -eq 'update') { 'update' } else { 'check' }
  # Ausgabe des Updaters abfangen (sie darf nicht in den Nachrichtenkanal geraten); die letzte Zeile ist das Ergebnis
  $out = @(& (Join-Path $PSScriptRoot 'updater.ps1') -Mode $mode 2>$null)
  $line = $out | Where-Object { $_ -is [string] -and $_.StartsWith('{') } | Select-Object -Last 1
  if (-not $line) { throw 'keine Antwort vom Updater' }
  Send-Message ($line | ConvertFrom-Json)
} catch {
  Send-Message @{ ok = $false; msg = $_.Exception.Message }
}
