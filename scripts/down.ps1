# Windows-обёртка: down.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "down" @args
exit $LASTEXITCODE
