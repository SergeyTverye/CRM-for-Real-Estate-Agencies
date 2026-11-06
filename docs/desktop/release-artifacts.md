# Windows EXE

Локальная папка: `releases/windows-x64/`. В ней находятся `CRM-Setup-Windows-x64.exe`, SHA-256, SBOM и сведения о встроенных runtime. Каталог исключён из Git и Docker context.

[Артефакт GitHub Actions — 7e7e47e](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42293184755/artifacts/13543160914). Размер EXE: 603 903 020 байт.

SHA-256:

```text
e0be489350033d2c81a8d942e7337564d2caa77905dfdc63499907defd5bf512
```

Это сборка коммита `7e7e47e`, а не последнего `main`. Установка на текущем Windows ПК завершилась с кодом 0. На Windows Server 2022/2025 подтверждены установка, регистрация, удаление с сохранением данных, повторная установка и обновление с защитной копией. Затем проверка обычного окна завершилась `WAIT_TIMEOUT`; полная приёмка EXE не пройдена. Чистые Windows 10/11 VM отсутствуют по решению пользователя. Актуальные ограничения: [приёмочная матрица](../acceptance/desktop-v32/README.md).
