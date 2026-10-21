; installer.nsi – Windows-Installer für BetterRoll (wird von build.py mit makensis gebaut)
; Fragt zuerst die Sprache (Deutsch/English), dann den Browser. Installiert nur für den aktuellen Benutzer
; (keine Admin-Rechte), lädt nichts aus dem Internet und sendet keine Daten.
;   Chrome/Edge/Brave: Add-on-Ordner nach %LOCALAPPDATA%\BetterRoll\extension, danach öffnet sich die
;                      Erweiterungsseite des Browsers zum einmaligen Laden („Entpackte Erweiterung laden“).
;   Firefox:           signierte .xpi wird an Firefox übergeben, Firefox fragt „Hinzufügen?“.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Name "BetterRoll ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\BetterRoll"
BrandingText "BetterRoll ${VERSION}"
!define MUI_ICON "${DIST}\installer.ico"
!define MUI_UNICON "${DIST}\installer.ico"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BetterRoll"
!define CALENDAR "https://www.crunchyroll.com/de/simulcastcalendar"

Var Browser      ; chrome | edge | brave | firefox
Var BrowserExe
Var LangCode     ; de | en
Var RadChrome
Var RadEdge
Var RadBrave
Var RadFirefox
Var FinishMsg   ; Text der Abschlussseite (je nach Browser)

; ===== Seiten =====
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
Page custom BrowserPage BrowserPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "$(FinishTitle)"
!define MUI_FINISHPAGE_TEXT "$FinishMsg"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "$(FinishRun)"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenBrowser
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Sprachen: Deutsch ist Standard
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "English"

; ===== Texte =====
LangString BrowserTitle ${LANG_GERMAN} "Browser wählen"
LangString BrowserTitle ${LANG_ENGLISH} "Choose your browser"
LangString BrowserSub ${LANG_GERMAN} "In welchem Browser soll BetterRoll laufen?"
LangString BrowserSub ${LANG_ENGLISH} "Which browser should BetterRoll run in?"
LangString NotFound ${LANG_GERMAN} " (nicht gefunden)"
LangString NotFound ${LANG_ENGLISH} " (not found)"
LangString FirefoxMissing ${LANG_GERMAN} "Firefox (diese Version enthält noch kein signiertes Firefox-Paket)"
LangString FirefoxMissing ${LANG_ENGLISH} "Firefox (this build does not contain a signed Firefox package yet)"
LangString PickOne ${LANG_GERMAN} "Bitte einen Browser auswählen."
LangString PickOne ${LANG_ENGLISH} "Please choose a browser."
LangString Privacy ${LANG_GERMAN} "Sicherheit: Der Installer lädt nichts aus dem Internet und sendet keine Daten. Deine Crunchyroll-Anmeldung bleibt im Browser auf diesem PC."
LangString Privacy ${LANG_ENGLISH} "Security: the installer downloads nothing and sends no data. Your Crunchyroll login stays in the browser on this PC."
LangString FinishTitle ${LANG_GERMAN} "Fast fertig"
LangString FinishTitle ${LANG_ENGLISH} "Almost done"
LangString FinishRun ${LANG_GERMAN} "Jetzt den Browser öffnen"
LangString FinishRun ${LANG_ENGLISH} "Open the browser now"
LangString FinishChromium ${LANG_GERMAN} "Einmalig im Browser (die Erweiterungsseite öffnet sich gleich):$\r$\n$\r$\n1. Oben rechts den Entwicklermodus einschalten.$\r$\n2. Auf „Entpackte Erweiterung laden“ klicken.$\r$\n3. Diesen Ordner wählen (der Pfad ist schon in der Zwischenablage):$\r$\n$INSTDIR\extension$\r$\n$\r$\nNeue Versionen zeigt BetterRoll danach im Add-on an: oben auf ↻ klicken lädt sie."
LangString FinishChromium ${LANG_ENGLISH} "One time in the browser (the extensions page opens next):$\r$\n$\r$\n1. Turn on Developer mode (top right).$\r$\n2. Click “Load unpacked”.$\r$\n3. Select this folder (the path is already on your clipboard):$\r$\n$INSTDIR\extension$\r$\n$\r$\nBetterRoll then shows new versions in the add-on: click ↻ at the top to get them."
LangString FinishFirefox ${LANG_GERMAN} "Firefox öffnet sich gleich und fragt, ob BetterRoll hinzugefügt werden soll: auf „Hinzufügen“ klicken.$\r$\n$\r$\nDanach den Crunchyroll-Kalender öffnen:$\r$\n${CALENDAR}$\r$\n$\r$\nUpdates installiert Firefox danach automatisch."
LangString FinishFirefox ${LANG_ENGLISH} "Firefox opens next and asks whether to add BetterRoll: click “Add”.$\r$\n$\r$\nThen open the Crunchyroll calendar:$\r$\n${CALENDAR}$\r$\n$\r$\nFirefox installs updates automatically from then on."

; ===== Hilfsfunktionen =====
; Pfad einer Browser-EXE aus den „App Paths“ der Registry (Benutzer, dann System); leer, wenn nicht installiert
!macro FindExe NAME OUT
  ReadRegStr ${OUT} HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${NAME}" ""
  ${If} ${OUT} == ""
    ReadRegStr ${OUT} HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${NAME}" ""
  ${EndIf}
!macroend

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
  StrCpy $Browser "chrome"
FunctionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

; Browserauswahl: gefundene Browser sind auswählbar, die erste gefundene ist vorgewählt
Function BrowserPage
  !insertmacro MUI_HEADER_TEXT "$(BrowserTitle)" "$(BrowserSub)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro FindExe "chrome.exe" $1
  ${If} $1 == ""
    ${NSD_CreateRadioButton} 10u 6u 280u 14u "Google Chrome$(NotFound)"
  ${Else}
    ${NSD_CreateRadioButton} 10u 6u 280u 14u "Google Chrome"
  ${EndIf}
  Pop $RadChrome
  !insertmacro FindExe "msedge.exe" $2
  ${If} $2 == ""
    ${NSD_CreateRadioButton} 10u 24u 280u 14u "Microsoft Edge$(NotFound)"
  ${Else}
    ${NSD_CreateRadioButton} 10u 24u 280u 14u "Microsoft Edge"
  ${EndIf}
  Pop $RadEdge
  !insertmacro FindExe "brave.exe" $3
  ${If} $3 == ""
    ${NSD_CreateRadioButton} 10u 42u 280u 14u "Brave$(NotFound)"
  ${Else}
    ${NSD_CreateRadioButton} 10u 42u 280u 14u "Brave"
  ${EndIf}
  Pop $RadBrave
  !insertmacro FindExe "firefox.exe" $4
!ifdef FIREFOX_XPI
  ${If} $4 == ""
    ${NSD_CreateRadioButton} 10u 60u 280u 14u "Mozilla Firefox$(NotFound)"
  ${Else}
    ${NSD_CreateRadioButton} 10u 60u 280u 14u "Mozilla Firefox"
  ${EndIf}
  Pop $RadFirefox
!else
  ${NSD_CreateRadioButton} 10u 60u 280u 14u "$(FirefoxMissing)"
  Pop $RadFirefox
  EnableWindow $RadFirefox 0
!endif

  ; Vorauswahl: zuletzt gewählter bzw. erster gefundener Browser
  ${If} $Browser == "firefox"
    ${NSD_Check} $RadFirefox
  ${ElseIf} $Browser == "brave"
    ${NSD_Check} $RadBrave
  ${ElseIf} $Browser == "edge"
    ${NSD_Check} $RadEdge
  ${ElseIf} $1 != ""
    ${NSD_Check} $RadChrome
  ${ElseIf} $2 != ""
    ${NSD_Check} $RadEdge
  ${ElseIf} $3 != ""
    ${NSD_Check} $RadBrave
  ${Else}
    ${NSD_Check} $RadChrome
  ${EndIf}

  ${NSD_CreateLabel} 10u 90u 280u 36u "$(Privacy)"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function BrowserPageLeave
  ${NSD_GetState} $RadChrome $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Browser "chrome"
    !insertmacro FindExe "chrome.exe" $BrowserExe
    Return
  ${EndIf}
  ${NSD_GetState} $RadEdge $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Browser "edge"
    !insertmacro FindExe "msedge.exe" $BrowserExe
    Return
  ${EndIf}
  ${NSD_GetState} $RadBrave $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Browser "brave"
    !insertmacro FindExe "brave.exe" $BrowserExe
    Return
  ${EndIf}
  ${NSD_GetState} $RadFirefox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Browser "firefox"
    !insertmacro FindExe "firefox.exe" $BrowserExe
    Return
  ${EndIf}
  MessageBox MB_ICONEXCLAMATION "$(PickOne)"
  Abort
FunctionEnd

; ===== Installation =====
Section "Install"
  ${If} $LANGUAGE == ${LANG_ENGLISH}
    StrCpy $LangCode "en"
  ${Else}
    StrCpy $LangCode "de"
  ${EndIf}

  ${If} $Browser == "firefox"
!ifdef FIREFOX_XPI
    SetOutPath "$INSTDIR"
    File "/oname=betterroll.xpi" "${FIREFOX_XPI}"
!endif
  ${Else}
    ; alten Stand ersetzen, damit keine veralteten Dateien liegen bleiben
    RMDir /r "$INSTDIR\extension"
    SetOutPath "$INSTDIR\extension"
    File /r "${DIST}\chrome\*.*"
    ; Sprache für den ersten Start (liest background.js bei der Installation)
    FileOpen $0 "$INSTDIR\extension\lang.json" w
    FileWrite $0 '{ "lang": "$LangCode" }'
    FileClose $0
    ; Ordnerpfad in die Zwischenablage (für „Entpackte Erweiterung laden“)
    nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Value '$INSTDIR\extension'"`
    Pop $0
    ; Updates: Helfer für den Knopf ↻ im Add-on anmelden (Native Messaging, nur HKCU) und den Updater bei jeder
    ; Windows-Anmeldung still prüfen lassen (nur Download, sendet nichts). Kein stündlicher Zeitplan mehr.
    SetOutPath "$INSTDIR"
    File "${DIST}\updater.ps1"
    File "${DIST}\updater.vbs"
    File "${DIST}\host.ps1"
    File "${DIST}\host.cmd"
    ; ein früher per „Updates einrichten“ gemerkter anderer Ordner gilt nicht mehr: der Installer-Ordner ist maßgeblich
    Delete "$INSTDIR\config.json"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BetterRoll-Update" '"$SYSDIR\wscript.exe" "$INSTDIR\updater.vbs"'
    nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\updater.ps1" -Mode register`
    Pop $0
  ${EndIf}

  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "BetterRoll"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "BetterRoll"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ; Text der Abschlussseite passend zum Browser
  ${If} $Browser == "firefox"
    StrCpy $FinishMsg "$(FinishFirefox)"
  ${Else}
    StrCpy $FinishMsg "$(FinishChromium)"
  ${EndIf}
SectionEnd

Function OpenBrowser
  ${If} $Browser == "firefox"
    ${If} $BrowserExe == ""
      ExecShell "open" "$INSTDIR\betterroll.xpi"
    ${Else}
      Exec `"$BrowserExe" "$INSTDIR\betterroll.xpi"`
    ${EndIf}
    Return
  ${EndIf}
  ${If} $BrowserExe == ""
    ExecShell "open" "$INSTDIR\extension"
    Return
  ${EndIf}
  ${If} $Browser == "edge"
    Exec `"$BrowserExe" "edge://extensions/"`
  ${ElseIf} $Browser == "brave"
    Exec `"$BrowserExe" "brave://extensions/"`
  ${Else}
    Exec `"$BrowserExe" "chrome://extensions/"`
  ${EndIf}
FunctionEnd

; ===== Deinstallation =====
Section "Uninstall"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BetterRoll-Update"
  nsExec::Exec `schtasks /Delete /F /TN BetterRoll-Update`
  Pop $0
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\last-check.txt"
  Delete "$INSTDIR\updater.ps1"
  Delete "$INSTDIR\updater.vbs"
  Delete "$INSTDIR\host.ps1"
  Delete "$INSTDIR\host.cmd"
  Delete "$INSTDIR\com.betterroll.updater.json"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.betterroll.updater"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.betterroll.updater"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.betterroll.updater"
  Delete "$INSTDIR\update.log"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\betterroll.xpi"
  Delete "$INSTDIR\Deinstallieren.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
