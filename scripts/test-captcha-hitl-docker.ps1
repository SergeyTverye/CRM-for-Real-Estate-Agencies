param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $taskRoot
try {
  if (-not $SkipBuild) {
    docker compose build app
    if ($LASTEXITCODE -ne 0) { throw 'Сборка app не прошла' }
  }
  docker compose -f compose.test.yaml up -d --wait testdb
  if ($LASTEXITCODE -ne 0) { throw 'Тестовая PostgreSQL недоступна' }
  $exists = docker compose -f compose.test.yaml exec -T testdb psql -U crm -d crm_test -tAc "SELECT 1 FROM pg_database WHERE datname='crm_test_hitl_docker'"
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось проверить тестовую БД' }
  if (([string]$exists).Trim() -ne '1') {
    docker compose -f compose.test.yaml exec -T testdb createdb -U crm crm_test_hitl_docker
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать выделенную БД HITL' }
  }
  $image = if ($env:APP_IMAGE_TAG) { "crm-app:$($env:APP_IMAGE_TAG)" } else { 'crm-app:local' }
  $common = @('run','--rm','--user','1000:1000','--security-opt','seccomp=ops/chrome/seccomp.json','--memory','2g','--pids-limit','256','--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','-e','NODE_ENV=production','-e','DEPLOYMENT_ID=00000000-0000-4000-8000-000000000099','-e','INSTANCE_ID=hitl-proof','-e','DATABASE_URL=postgresql://crm:crm_test_password@host.docker.internal:55432/crm_test_hitl_docker','-e','AI_ENABLED=false','-e','LOG_LEVEL=silent')
  & docker @common $image node_modules/.bin/prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Миграции HITL test DB не прошли' }
  $mounts = @('--mount',"type=bind,source=$taskRoot\tests\fixtures\captcha-stand,target=/app/tests/fixtures/captcha-stand,readonly",'--mount',"type=bind,source=$taskRoot\scripts\captcha-hitl-smoke.ts,target=/app/scripts/captcha-hitl-smoke.ts,readonly")
  & docker @common @mounts $image node_modules/.bin/tsx scripts/captcha-hitl-smoke.ts
  if ($LASTEXITCODE -ne 0) { throw 'Контейнерная проверка HITL не прошла' }
} finally { Pop-Location }
