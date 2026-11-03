# Windows-обёртка: promote-instance.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "promote-instance" @args
exit $LASTEXITCODE
