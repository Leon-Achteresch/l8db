Var L8dbTaskDisabled
Var L8dbExitCode

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'schtasks /Change /TN "l8db\Automatisierung" /DISABLE'
  Pop $L8dbTaskDisabled
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'l8db.exe' -and $$_.CommandLine -match '--(mcp|automation-tick|run-task|list-tasks|ai-mcp-relay)' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $$_.ProcessId -Timeout 5 -ErrorAction SilentlyContinue }"`
  Pop $L8dbExitCode
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCmp $L8dbTaskDisabled "0" 0 l8db_task_enabled
  nsExec::Exec 'schtasks /Change /TN "l8db\Automatisierung" /ENABLE'
  Pop $L8dbExitCode
  l8db_task_enabled:
!macroend
