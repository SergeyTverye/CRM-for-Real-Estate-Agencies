# Windows-обёртка: demote-instance.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "demote-instance" @args
exit $LASTEXITCODE
