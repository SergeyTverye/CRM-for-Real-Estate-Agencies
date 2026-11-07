; Use Tauri's existing uninstall-page checkbox and registration, not a second registry entry.
!include LogicLib.nsh
!include WinVer.nsh
!include FileFunc.nsh
Var CRMFullPurge
!define CRM_HOOK_DIR "${__FILEDIR__}"
!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Требуется Windows x64." /SD IDOK
    Abort
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmp $0 19045 crm_os_supported crm_os_unsupported crm_os_supported
crm_os_unsupported:
  MessageBox MB_OK|MB_ICONSTOP "Требуется Windows 10 22H2 (19045) или Windows 11 x64." /SD IDOK
  Abort
crm_os_supported:
  ; Embedded new helper, never an old installed script. Clean only proven app
  ; resources after graceful shutdown, before Tauri copies the new resources.
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File /oname=crm-upgrade-cleanup.ps1 "${CRM_HOOK_DIR}\upgrade-resource-cleanup.ps1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\crm-upgrade-cleanup.ps1" -InstallDirectory "$INSTDIR" -InstallerPath "$EXEPATH"'
    Pop $0
    ${If} $0 != 0
      SetErrorLevel 1
      Abort
    ${EndIf}
    SetOutPath "$INSTDIR"
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ; The shipped, fixed helper survives removal of installed resources.
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\uninstall-cleanup.ps1" "$PLUGINSDIR\crm-cleanup.ps1"
  StrCpy $CRMFullPurge "0"
  ${If} $UpdateMode <> 1
    ${GetOptions} $CMDLINE "/PURGE-DATA" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/CONFIRM-PURGE" $R0
      ${IfNot} ${Errors}
        StrCpy $CRMFullPurge "1"
      ${EndIf}
    ${EndIf}
    ${IfNot} ${Silent}
      ${If} $DeleteAppDataCheckboxState = 1
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Удалить БЕЗВОЗВРАТНО локальную базу, документы и резервные копии? Сначала создайте и проверьте зашифрованную копию на внешнем носителе. Облачные архивы сохранятся." IDNO crm_keep_data
        StrCpy $CRMFullPurge "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
crm_keep_data:
  StrCpy $DeleteAppDataCheckboxState 0
  ExecWait '"$INSTDIR\RealEstateCRM.exe" --shutdown' $0
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\crm-cleanup.ps1" -Phase Stop -InstallDirectory "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Не удалось остановить процессы CRM. Удаление остановлено; данные сохранены." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\RealEstateCRM\RealEstateCRM"
    DeleteRegKey /ifempty HKCU "Software\RealEstateCRM"
  ${EndIf}
  ${If} $CRMFullPurge = "1"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\crm-cleanup.ps1" -Phase Purge -InstallDirectory "$INSTDIR"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Часть локальных каталогов не удалена. Проверьте %LOCALAPPDATA%\RealEstateCRM. Общие runtime и облака не затронуты." /SD IDOK
      SetErrorLevel 1
    ${EndIf}
  ${Else}
    DetailPrint "Данные сохранены: %LOCALAPPDATA%\RealEstateCRM\data, files, backups. Повторная установка откроет прежнюю базу."
  ${EndIf}
!macroend
