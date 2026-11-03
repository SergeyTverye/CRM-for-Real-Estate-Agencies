# Windows-обёртка: instance-status.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "instance-status" @args
exit $LASTEXITCODE
