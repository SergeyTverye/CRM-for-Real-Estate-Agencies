# Native startup: Node verbatim Windows paths

## Defect and fix

Normal startup uses Tauri `resource_dir()`, which may contain the Windows
verbatim prefix `\\?\`. Smoke startup instead derives resources from
`current_exe().parent()`. With the installed Node 24.15.0, both a verbatim
JS entrypoint and a verbatim working directory cause `EISDIR: lstat 'C:'`
before the supervisor can announce READY. No WebView is created. This is
an actual application startup failure, not evidence that CI cannot show GUI.

`supervisor.rs` now converts verbatim drive/UNC resource paths to ordinary
Windows paths before constructing both Node's command and working directory.
Conversion preserves UTF-16, spaces and non-ASCII names; unsupported verbatim
device namespaces are rejected. It does not change the data root or read data.
Smoke and GUI share the same conversion. Rust unit coverage is colocated.

Native startup emits fixed stage codes only (SERVER_READY, WINDOW_BUILD_STARTED,
WINDOW_CREATED, WINDOW_BUILD_FAILED, WINDOW_DISPATCH_FAILED). Window dispatch
failure exits; window build failure exits after the error dialog is dismissed.
Loopback navigation filtering, disabled devtools, zero remote IPC capabilities,
RBAC and ACL behavior are unchanged.

## Actual checks

- Installed public EXE 3.2.1 normal launch, new synthetic LOCALAPPDATA/APPDATA,
  PATH limited to Windows/System32/WindowsPowerShell, no host Node: **failure
  reproduced**. After 30 seconds parent remained alive but no child remained;
  synthetic supervisor log contained the Node EISDIR failure. Only the owned
  process handle was terminated. No pre-existing CRM instance was present.
- Synthetic profile:
  `D:/TEMP/UserTEMP/opencode/native-startup-a28948d6c19042079df4c534381e0699`.
  No existing customer/default profile was read.
- Installed bundled Node `--check` on public supervisor: ordinary path exit 0,
  verbatim path exit 1/EISDIR. Relative entrypoint with verbatim cwd: exit 1/EISDIR.
- `scripts/desktop/test-native-node-path.ps1 -Node <installed app/node/node.exe>`:
  **PASS**, independent synthetic JS fixture, entrypoint/cwd reproduction and
  normal-path success. No application scripts are executed by this test.
- Installer script parsed successfully as UTF-8. Windows PowerShell 5's default
  ANSI file parser misreads the existing BOM-less Cyrillic fixture; UTF-8
  ParseInput succeeds. This task does not change that unrelated fixture.
- PowerShell 7 native ParseFile on updated installer script: **PASS**.

## Windows proof still required

**Native UI after fix: NOT VERIFIED.** No local Rust toolchain; no dependency
install, native/full build, installer execution, CI dispatch, or Git mutation.
Run the updated installer test with a newly built EXE in a disposable profile.
It must observe WINDOW_CREATED plus a nonzero native HWND, API readiness,
owned WebView directory and successful second-launch focus/same supervisor.
It no longer infers success solely from direct Chromium parentage and does not
skip UI checks on server runners. Confirm visible UI and rendered setup/login
with coordinator CUA. WINDOW_CREATED/HWND alone do not prove rendered content.

Control mutex/event, single-instance plugin, smoke shutdown wait and Job Object
were reviewed. The observed Node error occurs before WebView construction and
does not justify changing their safety boundaries or wait limits.

## Diagnostic normal-window proof, 2026-11-07

Clean installation of artifact `41c39b8` on the current PC completed with exit 0
after the user removed the previous installation. No project TZ/AGENTS/CLAUDE,
source, tests or internal docs were present at the installed application root.
Its unmodified resources still failed startup: the Next hashed dependency aliases
were missing. This is a different defect from the verbatim Node path above.

For diagnosis, the coordinator materialized ten aliases from those same installed
production packages, without copying project sources or changing the launcher.
The original launcher SHA-256 remained
`1553873c574f6fe60141c0a26c19f08b0ccab18154c134b42a1056cbe4a00653`.
A new synthetic LOCALAPPDATA/APPDATA profile with Windows-only PATH opened the
ordinary Tauri window. CUA confirmed the document at loopback `/setup`, heading
“Первый запуск CRM”, manager setup fields, empty database choice and local storage
confirmation. No account/password was entered. Only the retained owned launcher
tree was stopped afterwards; no shared shutdown event was sent.

Evidence metadata is retained under `data/qa-v32-native-proof/`; this is explicitly
a **locally patched resource diagnostic**, not a PASS for an unmodified installer.
The published EXE still requires rebuilding and installed workflow/normal-window
retesting. Windows CI `41c39b8` Rust/path tests passed; subsequent `5a6f1ab` CI
stopped at one final-runtime fixture init test (1602 pass, 5 skip, 1 fail).
