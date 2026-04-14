pub mod dns_sinkhole;
pub mod privilege;
pub mod suspend;

use suspend::SuspendedProcesses;
use dns_sinkhole::DnsSinkhole;

/// Lifecycle phase of the lockdown.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LockdownPhase {
    Inactive,
    ProcessesSuspended,
    DnsActive,
    FullyLocked,
    CleaningUp,
}

/// Full result of activating the lockdown, returned to the frontend.
#[derive(Debug, serde::Serialize)]
pub struct LockdownResult {
    pub phase: LockdownPhase,
    pub suspended_pids: Vec<u32>,
    pub dns_active: bool,
    pub dns_error: Option<String>,
}

/// Runtime state of an active lockdown session.
pub struct LockdownState {
    pub phase: LockdownPhase,
    pub suspended: SuspendedProcesses,
    pub sinkhole: Option<DnsSinkhole>,
}

impl Default for LockdownState {
    fn default() -> Self {
        Self {
            phase: LockdownPhase::Inactive,
            suspended: SuspendedProcesses::default(),
            sinkhole: None,
        }
    }
}

impl Drop for LockdownState {
    fn drop(&mut self) {
        // Crash-safe cleanup: this runs even on panic/unexpected exit.
        // Use sync paths only — we cannot .await here.
        if let Err(e) = self.suspended.resume_all() {
            eprintln!("[lockdown] drop resume_all error: {}", e);
        }
        if let Some(ref mut sinkhole) = self.sinkhole {
            sinkhole.stop_sync();
        }
    }
}

impl LockdownState {
    /// Suspend the given PIDs and start the DNS sinkhole.
    pub async fn start(
        &mut self,
        pids: &[u32],
    ) -> LockdownResult {
        // Step 1: Suspend processes
        let mut dns_active = false;
        let mut dns_error: Option<String> = None;

        let suspended_pids = match self.suspended.suspend_all(pids) {
            Ok(pids) => {
                if !pids.is_empty() {
                    self.phase = LockdownPhase::ProcessesSuspended;
                }
                pids
            }
            Err(e) => {
                eprintln!("[lockdown] suspend error: {}", e);
                vec![]
            }
        };

        // Step 2: Start DNS sinkhole
        match DnsSinkhole::start().await {
            Ok(sinkhole) => {
                self.sinkhole = Some(sinkhole);
                dns_active = true;
                self.phase = if suspended_pids.is_empty() {
                    LockdownPhase::DnsActive
                } else {
                    LockdownPhase::FullyLocked
                };
            }
            Err(e) => {
                eprintln!("[lockdown] DNS sinkhole failed: {}", e);
                dns_error = Some(e);
                // Phase stays at ProcessesSuspended if processes were suspended
            }
        }

        LockdownResult {
            phase: self.phase.clone(),
            suspended_pids,
            dns_active,
            dns_error,
        }
    }

    /// Stop the lockdown: restore DNS and resume all suspended processes.
    pub async fn stop(&mut self) {
        self.phase = LockdownPhase::CleaningUp;

        // Restore DNS first
        if let Some(ref mut sinkhole) = self.sinkhole {
            if let Err(e) = sinkhole.stop().await {
                eprintln!("[lockdown] sinkhole stop error: {}", e);
            }
        }
        self.sinkhole = None;

        // Resume processes
        if let Err(e) = self.suspended.resume_all() {
            eprintln!("[lockdown] resume_all error: {}", e);
        }

        self.phase = LockdownPhase::Inactive;
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self.phase,
            LockdownPhase::ProcessesSuspended
                | LockdownPhase::DnsActive
                | LockdownPhase::FullyLocked
        )
    }

    pub fn suspended_pids(&self) -> Vec<u32> {
        self.suspended.suspended_pids()
    }

    pub fn dns_active(&self) -> bool {
        self.sinkhole.is_some()
    }
}
