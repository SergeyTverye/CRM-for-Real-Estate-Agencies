use std::{io, ptr};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, ERROR_ALREADY_EXISTS};
use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE};
const LOCK: &str = "Local\\RealEstateCRM.Desktop.Writer";
const STOP: &str = "Local\\RealEstateCRM.Desktop.Stop";
fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
pub struct Control { lock: HANDLE, event: HANDLE }
unsafe impl Send for Control {}
unsafe impl Sync for Control {}
impl Control {
    pub fn acquire() -> io::Result<Self> {
        unsafe {
            let lock = CreateMutexW(ptr::null(), 0, wide(LOCK).as_ptr());
            if lock.is_null() { return Err(io::Error::last_os_error()); }
            if GetLastError() == ERROR_ALREADY_EXISTS { CloseHandle(lock); return Err(io::Error::other("INSTANCE_ALREADY_RUNNING")); }
            let event = CreateEventW(ptr::null(), 1, 0, wide(STOP).as_ptr());
            if event.is_null() { CloseHandle(lock); return Err(io::Error::last_os_error()); }
            Ok(Self {lock,event})
        }
    }
    pub fn stopped(&self, timeout_ms: u32) -> bool { unsafe { WaitForSingleObject(self.event,timeout_ms) == 0 } }
}
impl Drop for Control { fn drop(&mut self) { unsafe { CloseHandle(self.event); CloseHandle(self.lock); } } }
pub fn request_stop() -> io::Result<()> {
    unsafe {
        let event = OpenEventW(EVENT_MODIFY_STATE,0,wide(STOP).as_ptr());
        if event.is_null() { return Ok(()); } // No instance is already stopped.
        let result = SetEvent(event); CloseHandle(event);
        if result == 0 { return Err(io::Error::last_os_error()); }
    }
    Ok(())
}
