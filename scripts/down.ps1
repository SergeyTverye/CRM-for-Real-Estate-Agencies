
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "down" @args
exit $LASTEXITCODE
