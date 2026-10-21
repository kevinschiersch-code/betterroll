@echo off
rem host.cmd - startet den Update-Helfer von BetterRoll (Native Messaging); siehe host.ps1
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0host.ps1"
