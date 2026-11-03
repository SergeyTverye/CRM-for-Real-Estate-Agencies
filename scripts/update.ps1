# Windows-обёртка: update.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "update" @args
exit $LASTEXITCODE
