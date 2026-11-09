
& (Join-Path $PSScriptRoot "ps\invoke-crm-script.ps1") -Script "instance-status" @args
exit $LASTEXITCODE
