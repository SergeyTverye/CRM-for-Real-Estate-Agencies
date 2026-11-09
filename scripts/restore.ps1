
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "restore" @args
exit $LASTEXITCODE
