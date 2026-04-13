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

#[derive(Debug, Serialize, Clone)]
pub struct FlaggedProcess {
    pub pid: u32,
    pub name: String,
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
