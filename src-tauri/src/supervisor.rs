use std::{fs::{self, OpenOptions}, io::{self, BufRead, BufReader, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex}, thread, time::{Duration, Instant}};
use std::os::windows::process::CommandExt;
pub struct Supervisor { child: Child, input: ChildStdin }
pub type Shared = Arc<Mutex<Option<Supervisor>>>;
// Tauri's resource_dir may be a canonical Windows verbatim path. Node 24
// cannot resolve its JS entrypoint (or cwd) with that prefix: EISDIR lstat C:.
// Do not canonicalize this result again before passing it to Node.
fn node_resource_path(path: &Path) -> io::Result<PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let units: Vec<u16> = path.as_os_str().encode_wide().collect();
    let prefix: Vec<u16> = r"\\?\".encode_utf16().collect();
    if !units.starts_with(&prefix) { return Ok(path.to_path_buf()); }
    let tail = &units[prefix.len()..];
    let unc: Vec<u16> = r"UNC\".encode_utf16().collect();
    let normal = if tail.starts_with(&unc) {
        let mut result: Vec<u16> = r"\\".encode_utf16().collect();
        result.extend_from_slice(&tail[unc.len()..]);
        result
    } else if tail.len() >= 3 && (tail[0] as u8).is_ascii_alphabetic()
        && tail[0] <= 127 && tail[1] == b':' as u16 && tail[2] == b'\\' as u16 {
        tail.to_vec()
    } else {
        return Err(io::Error::other("UNSUPPORTED_NODE_RESOURCE_PATH"));
    };
    Ok(PathBuf::from(std::ffi::OsString::from_wide(&normal)))
}
// Only fixed stage codes, never URLs, arbitrary errors or user data.
pub fn startup_event(code: &'static str) {
    if let Ok(root) = data_root() {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(root.join("logs/native-startup.log")) {
            let _ = writeln!(file, "{}", code);
        }
    }
}
pub fn data_root() -> io::Result<PathBuf> {
    Ok(PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or_else(|| io::Error::other("LOCALAPPDATA_MISSING"))?).join("RealEstateCRM"))
}
pub fn protect_data(root: &Path) -> io::Result<()> {
    // Reject junctions/reparse points in every existing ancestor before changing ACLs.
    use std::os::windows::fs::MetadataExt;
    for part in root.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(part) {
            if meta.file_attributes() & 0x400 != 0 { return Err(io::Error::other("DATA_REPARSE_POINT")); }
        }
    }
    fs::create_dir_all(root)?;
    let system = PathBuf::from(std::env::var_os("SystemRoot").ok_or_else(|| io::Error::other("SYSTEM_ROOT_MISSING"))?).join("System32");
    let who = Command::new(system.join("whoami.exe")).args(["/user", "/fo", "csv", "/nh"]).creation_flags(0x08000000).output()?;
    let output = String::from_utf8_lossy(&who.stdout);
    let sid = output.split(',').nth(1).map(|s| s.trim().trim_matches('"')).filter(|s| s.starts_with("S-1-")).ok_or_else(|| io::Error::other("SID_UNAVAILABLE"))?;
    let acl = Command::new(system.join("icacls.exe")).arg(root).args(["/inheritance:r", "/grant:r"])
        .arg(format!("*{}:(OI)(CI)F",sid)).arg("*S-1-5-18:(OI)(CI)F")
        .stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000).status()?;
    if !acl.success() { return Err(io::Error::other("DATA_ACL_FAILED")); }
    Ok(())
}
impl Supervisor {
    pub fn start(resources: &Path, on_ready: impl FnOnce(String) + Send + 'static, on_failure: impl FnOnce(String) + Send + 'static, on_notice: impl Fn(&str) + Send + 'static) -> io::Result<Self> {
        let resources = node_resource_path(resources)?;
        let root = data_root()?;
        protect_data(&root)?;
        fs::create_dir_all(root.join("logs"))?;
        let log_path = root.join("logs/supervisor.log");
        let log = OpenOptions::new().create(true).append(true).open(&log_path)?;
        let mut child = Command::new(resources.join("node/node.exe"))
            .arg(resources.join("supervisor.mjs")).current_dir(&resources)
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH").env_remove("PSModulePath")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log))
            .creation_flags(0x08000000).spawn()?;
        let input = child.stdin.take().ok_or_else(|| io::Error::other("STDIN_UNAVAILABLE"))?;
        let stdout = child.stdout.take().ok_or_else(|| io::Error::other("STDOUT_UNAVAILABLE"))?;
        thread::spawn(move || {
            let mut on_ready = Some(on_ready);
            let mut failure = Some(on_failure);
            let mut reached_ready = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) { let _ = writeln!(file,"{}",line); }
                if line == "BACKUP_COMPLETE" || line == "BACKUP_FAILED" || line.starts_with("NATIVE_FOLDER:") || line.starts_with("NATIVE_EXPORT:") || line.starts_with("NATIVE_IMPORT:") { on_notice(&line); }
                if let Some(url) = line.strip_prefix("READY ") {
                    if let Ok(parsed) = url.parse::<tauri::Url>() {
                        if parsed.scheme() == "http" && parsed.host_str() == Some("127.0.0.1") && parsed.port().is_some() {
                            reached_ready = true;
                            if let Some(callback) = on_ready.take() { callback(url.to_owned()); }
                        }
                    }
                } else if line == "STOPPED" && reached_ready { failure = None; }
                else if line.starts_with("DESKTOP_START_FAILED") || line.starts_with("CHILD_EXIT:") || line.starts_with("CHILD_START_FAILED:") {
                    if let Some(callback) = failure.take() { callback(format!("{}\nЖурнал: {}",line,log_path.display())); }
                }
            }
            if let Some(callback) = failure { callback(format!("Сервер завершился (ready={}). Журнал: {}",reached_ready,log_path.display())); }
        });
        Ok(Self { child, input })
    }
    pub fn backup(&mut self) { let _ = self.input.write_all(b"BACKUP\n"); }
    pub fn stop(&mut self) {
        let _ = self.input.write_all(b"STOP\n");
        let deadline = Instant::now() + Duration::from_secs(180);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) { return; }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for Supervisor { fn drop(&mut self) { self.stop(); } }
pub fn stop(shared: &Shared) { if let Ok(mut guard) = shared.lock() { if let Some(mut process) = guard.take() { process.stop(); } } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn node_paths_remove_only_supported_verbatim_prefixes() {
        for (input, expected) in [
            (r"\\?\C:\Program Files\CRM\app", r"C:\Program Files\CRM\app"),
            (r"\\?\UNC\server\share\CRM\app", r"\\server\share\CRM\app"),
            (r"C:\CRM\app", r"C:\CRM\app"),
            (r"\\?\D:\CRM\недвижимость", r"D:\CRM\недвижимость"),
        ] {
            assert_eq!(node_resource_path(Path::new(input)).unwrap(), PathBuf::from(expected));
        }
        assert!(node_resource_path(Path::new(r"\\?\GLOBALROOT\Device\app")).is_err());
    }
}
