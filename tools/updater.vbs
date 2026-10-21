' updater.vbs – startet updater.ps1 unsichtbar (ohne aufblitzendes Fenster); wird bei der Windows-Anmeldung ausgeführt
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & dir & "\updater.ps1""", 0, False
