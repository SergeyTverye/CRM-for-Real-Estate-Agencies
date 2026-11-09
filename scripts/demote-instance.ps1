
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "demote-instance" @args
exit $LASTEXITCODE
