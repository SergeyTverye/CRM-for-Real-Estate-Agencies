
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "update" @args
exit $LASTEXITCODE
