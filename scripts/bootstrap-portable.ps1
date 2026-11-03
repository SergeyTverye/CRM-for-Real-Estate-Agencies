# Windows-обёртка: bootstrap-portable.sh (см. scripts/ps/invoke-crm-script.ps1)
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "bootstrap-portable" @args
exit $LASTEXITCODE
