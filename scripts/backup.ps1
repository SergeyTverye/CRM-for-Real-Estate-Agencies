
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "backup" @args
exit $LASTEXITCODE
