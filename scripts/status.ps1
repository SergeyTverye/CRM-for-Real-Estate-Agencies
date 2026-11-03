# Windows-обёртка: status.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "status" @args
exit $LASTEXITCODE
