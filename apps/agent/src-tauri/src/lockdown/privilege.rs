/// Returns true if the current process needs elevated privileges to bind to port 53.
/// On Windows, port 53 does not require elevation.
pub fn needs_elevation() -> bool {
    cfg!(not(target_os = "windows"))
}

/// Request elevation on macOS by running a command with osascript admin privileges.
/// `cmd` is the shell command to run with admin rights.
#[cfg(target_os = "macos")]
pub fn request_elevation(cmd: &str) -> Result<(), String> {
    let script = format!(
        r#"do shell script "{}" with administrator privileges"#,
        cmd.replace('"', "\\\"")
    );
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript failed: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Elevation denied or failed: {}", stderr.trim()))
    }
}

/// On Linux, attempt to run command with sudo (non-interactive — will fail if no NOPASSWD).
/// Production use should rely on a pre-installed helper with setuid or polkit.
#[cfg(target_os = "linux")]
pub fn request_elevation(cmd: &str) -> Result<(), String> {
    let output = std::process::Command::new("sudo")
        .arg("-n") // non-interactive
        .arg("sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| format!("sudo failed: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("sudo failed: {}", stderr.trim()))
    }
}

/// On Windows, netsh requires admin. UAC elevation should be declared in the manifest.
/// For commands that need elevation at runtime, use ShellExecuteEx with "runas".
#[cfg(target_os = "windows")]
pub fn request_elevation(_cmd: &str) -> Result<(), String> {
    // DNS redirect via netsh on Windows does not need runtime elevation if the app
    // was launched with the admin manifest. The manifest declares requireAdministrator.
    Ok(())
}
