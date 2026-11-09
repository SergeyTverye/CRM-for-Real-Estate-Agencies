
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "promote-instance" @args
exit $LASTEXITCODE
