
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "status" @args
exit $LASTEXITCODE
