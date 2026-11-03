# Windows-обёртка: backup.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "backup" @args
exit $LASTEXITCODE
