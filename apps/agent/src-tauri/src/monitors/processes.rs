use serde::Serialize;
use sysinfo::System;

// Known AI tool process names — expand this list over time
const FLAGGED_PROCESSES: &[&str] = &[
    "chatgpt", "claude", "copilot", "cursor", "windsurf",
    "interview-coder", "interviewcoder",
    "codeium", "tabnine", "cody",
    "openai", "anthropic", "gemini",
    "obs64", "obs32", "obs",           // virtual camera
    "snap camera", "snapcamera",       // virtual camera
    "manycam",                          // virtual camera
];

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub is_flagged: bool,
    pub flag_reason: Option<String>,
}

#[derive(Debug, Serialize, serde::Deserialize, Clone)]
pub struct FlaggedProcess {
    pub pid: u32,
    pub name: String,
    pub parent_pid: Option<u32>,
    pub parent_name: Option<String>,
}

pub fn scan_processes() -> Vec<ProcessInfo> {
    let mut sys = System::new_all();
    sys.refresh_all();

    sys.processes()
        .iter()
        .map(|(pid, process)| {
            let name = process.name().to_string_lossy().to_lowercase();
            let flagged = FLAGGED_PROCESSES.iter().find(|&&f| name.contains(f));

            ProcessInfo {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                is_flagged: flagged.is_some(),
                flag_reason: flagged.map(|f| format!("Matches known AI tool: {}", f)),
            }
        })
        .collect()
}

/// Like scan_processes but returns only flagged entries, enriched with parent PID/name.
/// Used by run_preflight so the UI can target the parent IDE instead of the child subprocess.
pub fn scan_flagged_with_parents() -> Vec<FlaggedProcess> {
    let mut sys = System::new_all();
    sys.refresh_all();

    sys.processes()
        .iter()
        .filter_map(|(pid, process)| {
            let name = process.name().to_string_lossy().to_lowercase();
            let flagged = FLAGGED_PROCESSES.iter().any(|&f| name.contains(f));
            if !flagged {
                return None;
            }

            let parent_pid = process.parent().map(|p| p.as_u32());
            let parent_name = parent_pid.and_then(|ppid| {
                sys.process(sysinfo::Pid::from_u32(ppid))
                    .map(|p| p.name().to_string_lossy().to_string())
            });

            // Treat PID 1 (launchd / init / systemd) as no meaningful parent
            let (effective_parent_pid, effective_parent_name) = match parent_pid {
                Some(1) | None => (None, None),
                Some(ppid) => (Some(ppid), parent_name),
            };

            Some(FlaggedProcess {
                pid: pid.as_u32(),
                name: process.name().to_string_lossy().to_string(),
                parent_pid: effective_parent_pid,
                parent_name: effective_parent_name,
            })
        })
        .collect()
}
