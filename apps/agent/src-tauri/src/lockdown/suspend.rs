use std::collections::HashSet;

/// Tracks which PIDs have been suspended so they can all be resumed on cleanup.
#[derive(Debug, Default)]
pub struct SuspendedProcesses {
    pids: HashSet<u32>,
}

impl SuspendedProcesses {
    /// Suspend the given PIDs. Returns the list of PIDs actually suspended.
    pub fn suspend_all(&mut self, pids: &[u32]) -> Result<Vec<u32>, String> {
        let mut suspended = Vec::new();
        for &pid in pids {
            self.suspend_one(pid)?;
            self.pids.insert(pid);
            suspended.push(pid);
        }
        Ok(suspended)
    }

    /// Resume all previously suspended processes. Best-effort: logs errors but continues.
    pub fn resume_all(&mut self) -> Result<(), String> {
        let pids: Vec<u32> = self.pids.drain().collect();
        for pid in pids {
            if let Err(e) = self.resume_one(pid) {
                // ESRCH means the process already exited — not an error from our perspective.
                eprintln!("[lockdown] resume PID {}: {}", pid, e);
            }
        }
        Ok(())
    }

    pub fn suspended_pids(&self) -> Vec<u32> {
        self.pids.iter().copied().collect()
    }

    #[cfg(target_os = "macos")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGSTOP)
            .map_err(|e| format!("SIGSTOP failed for PID {}: {}", pid, e))
    }

    #[cfg(target_os = "macos")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGCONT)
            .map_err(|e| format!("SIGCONT failed for PID {}: {}", pid, e))
    }

    #[cfg(target_os = "linux")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGSTOP)
            .map_err(|e| format!("SIGSTOP failed for PID {}: {}", pid, e))
    }

    #[cfg(target_os = "linux")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid as NixPid;
        kill(NixPid::from_raw(pid as i32), Signal::SIGCONT)
            .map_err(|e| format!("SIGCONT failed for PID {}: {}", pid, e))
    }

    #[cfg(target_os = "windows")]
    fn suspend_one(&self, pid: u32) -> Result<(), String> {
        use ntapi::ntpsapi::NtSuspendProcess;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::winnt::PROCESS_SUSPEND_RESUME;
        unsafe {
            let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
            if handle.is_null() {
                return Err(format!("OpenProcess failed for PID {}", pid));
            }
            let status = NtSuspendProcess(handle);
            CloseHandle(handle);
            if status != 0 {
                return Err(format!("NtSuspendProcess failed: 0x{:x}", status));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn resume_one(&self, pid: u32) -> Result<(), String> {
        use ntapi::ntpsapi::NtResumeProcess;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::winnt::PROCESS_SUSPEND_RESUME;
        unsafe {
            let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
            if handle.is_null() {
                return Err(format!("OpenProcess failed for PID {}", pid));
            }
            let status = NtResumeProcess(handle);
            CloseHandle(handle);
            if status != 0 {
                return Err(format!("NtResumeProcess failed: 0x{:x}", status));
            }
        }
        Ok(())
    }
}
