# Общая PowerShell-обёртка для Windows 11 (Docker Desktop + WSL2), ТЗ 41.8.
# Запускает тот же shell-скрипт из scripts/, поэтому Linux и Windows используют один Compose-контракт.
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker не найден. Установите Docker Desktop с поддержкой WSL2." }
docker compose version | Out-Null
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$path = Join-Path $root "scripts\$Script.sh"
if (-not (Test-Path $path)) { throw "Скрипт $Script.sh не найден" }
if (Get-Command wsl -ErrorAction SilentlyContinue) {
  $unix = (wsl wslpath -a ($path -replace '\\', '/')).Trim()
  wsl bash $unix @Rest
} elseif (Get-Command bash -ErrorAction SilentlyContinue) {
  bash $path @Rest
} else {
  throw "Для запуска нужен WSL2 или Git Bash"
}
exit $LASTEXITCODE
