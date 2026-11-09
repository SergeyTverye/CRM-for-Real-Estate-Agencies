#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod job;
mod control;
mod supervisor;
use std::{sync::{Arc, Mutex}, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{Menu, MenuItem}, tray::TrayIconBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
fn open(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
    }
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|s| s == "--shutdown") { std::process::exit(if control::request_stop().is_ok() {0} else {1}); }
    if args.iter().any(|s| s == "--smoke") {
        let code = smoke(&args).unwrap_or(1);
        std::process::exit(code);
    }
    let _job = std::mem::ManuallyDrop::new(job::ProcessJob::create().expect("WINDOWS_JOB_FAILED"));
    let shared: supervisor::Shared = Arc::new(Mutex::new(None));
    let startup = shared.clone();
    let exiting = shared.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| open(app)))
        .plugin(tauri_plugin_dialog::init())
        .manage(shared.clone())
        .setup(move |app| {
            let control = Arc::new(control::Control::acquire()?);
            let stop_app = app.handle().clone();
            std::thread::spawn(move || { while !control.stopped(250) {} stop_app.exit(0); });
            let show = MenuItem::with_id(app,"open","Открыть",true,None::<&str>)?;
            let backup = MenuItem::with_id(app,"backup","Создать резервную копию",true,None::<&str>)?;
            let quit = MenuItem::with_id(app,"quit","Выйти",true,None::<&str>)?;
            let menu = Menu::with_items(app,&[&show,&backup,&quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("RealEstateCRM");
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.on_menu_event(|app,event| match event.id.as_ref() {
                "open" => open(app),
                "backup" => {
                    let state = app.state::<supervisor::Shared>();
                    if let Ok(mut guard) = state.lock() { if let Some(process) = guard.as_mut() { process.backup(); } };
                },
                "quit" => app.exit(0),
                _ => {}
            }).build(app)?;
            let handle = app.handle().clone();
            let fail = app.handle().clone();
            let notice = app.handle().clone();
            let resources = app.path().resource_dir()?.join("app");
            let webview_data = supervisor::data_root()?.join("data/webview");
            let result = supervisor::Supervisor::start(&resources, move |url| {
                supervisor::startup_event("SERVER_READY");
                let callback_handle = handle.clone();
                if handle.run_on_main_thread(move || {
                    supervisor::startup_event("WINDOW_BUILD_STARTED");
                    let allowed = url.clone();
                    let start_url = format!("{}/setup",url);
                    let builder = WebviewWindowBuilder::new(&callback_handle,"main",WebviewUrl::External(start_url.parse().expect("loopback URL")))
                        .title("CRM — Магазин недвижимости").inner_size(1360.0,900.0).min_inner_size(1000.0,650.0)
                        .data_directory(webview_data)
                        .on_navigation(move |target| target.origin().ascii_serialization() == allowed)
                        .devtools(false);
                    match builder.build() {
                        Ok(window) => {
                            supervisor::startup_event("WINDOW_CREATED");
                            let app = callback_handle.clone();
                            window.on_window_event(move |event| {
                                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                                    api.prevent_close();
                                    let app2 = app.clone();
                                    app.dialog().message("Задания и копирование продолжаются в трее. Что сделать?")
                                        .title("Закрыть CRM")
                                        .buttons(MessageDialogButtons::OkCancelCustom("Свернуть в трей".into(),"Завершить".into()))
                                        .show(move |minimize| { if minimize { if let Some(w) = app2.get_webview_window("main") { let _ = w.hide(); } } else { app2.exit(0); } });
                                }
                            });
                        },
                        Err(_) => {
                            supervisor::startup_event("WINDOW_BUILD_FAILED");
                            let app = callback_handle.clone();
                            callback_handle.dialog().message("Не удалось открыть окно CRM. Проверьте WebView2 и журнал в LOCALAPPDATA\\RealEstateCRM\\logs.").show(move |_| app.exit(1));
                        },
                    }
                }).is_err() {
                    supervisor::startup_event("WINDOW_DISPATCH_FAILED");
                    handle.exit(1);
                }
            }, move |message| {
                let app = fail.clone();
                fail.dialog().message(message).title("CRM: ошибка запуска").show(move |_| app.exit(1));
            }, move |code| {
                if let Some((kind,id)) = code.split_once(':') {
                    if (kind == "NATIVE_FOLDER" || kind == "NATIVE_EXPORT" || kind == "NATIVE_IMPORT") && id.len() == 36 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
                        if let Ok(root) = supervisor::data_root() {
                            let result = root.join("data/backup-settings/native-dialogs").join(format!("{}.path",id));
                            let callback = move |selected: Option<tauri_plugin_dialog::FilePath>| {
                                let text = selected.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
                                if let Ok(mut file) = std::fs::OpenOptions::new().write(true).create_new(true).open(result) { use std::io::Write; let _ = file.write_all(text.as_bytes()); }
                            };
                            if kind == "NATIVE_FOLDER" { notice.dialog().file().pick_folder(callback); }
                            else if kind == "NATIVE_IMPORT" { notice.dialog().file().add_filter("Резервная копия CRM", &["crmbackup"]).pick_file(callback); }
                            else { notice.dialog().file().set_file_name("CRM-backup.crmbackup").add_filter("CRM backup", &["crmbackup"]).save_file(callback); }
                        }
                        return;
                    }
                }
                let message = if code == "BACKUP_COMPLETE" { "Локальная защитная копия создана и проверена. Для переноса на другой ПК используйте переносимую резервную копию с ключом восстановления." } else { "Защитная копия не создана. Проверьте свободное место и журнал в LOCALAPPDATA\\RealEstateCRM\\logs." };
                notice.dialog().message(message).title("Резервная копия CRM").show(|_| {});
            });
            match result { Ok(process) => { *startup.lock().map_err(|_| "SUPERVISOR_LOCK")? = Some(process); }, Err(error) => {
                let app = app.handle().clone();
                app.clone().dialog().message(format!("Запуск не выполнен: {}. Журналы: LOCALAPPDATA\\RealEstateCRM\\logs",error)).show(move |_| app.exit(1));
            }}
            Ok(())
        })
        .build(tauri::generate_context!()).expect("TAURI_START_FAILED")
        .run(move |_app,event| {
            if let tauri::RunEvent::Exit = event { supervisor::stop(&exiting); }
        });
}
fn smoke(args: &[String]) -> std::io::Result<i32> {
    let _control = control::Control::acquire()?;
    let _job = std::mem::ManuallyDrop::new(job::ProcessJob::create()?);
    let seconds = args.iter().find_map(|s| s.strip_prefix("--smoke-seconds=")).and_then(|s|s.parse::<u64>().ok()).unwrap_or(3).clamp(1,300);
    let resource = std::env::current_exe()?.parent().ok_or_else(||std::io::Error::other("EXE_PARENT"))?.join("app");
    let (tx,rx) = std::sync::mpsc::channel();
    let failed = tx.clone();
    let mut process = supervisor::Supervisor::start(&resource,move |_| { let _=tx.send(true); },move |_| { let _=failed.send(false); }, |_| {})?;
    if rx.recv_timeout(Duration::from_secs(180)) != Ok(true) { process.stop(); return Ok(1); }
    let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
    while std::time::Instant::now() < deadline { if _control.stopped(100) { break; } }
    process.stop();
    Ok(0)
}
