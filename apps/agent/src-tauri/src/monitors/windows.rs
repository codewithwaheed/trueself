use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct WindowInfo {
    pub title: String,
    pub process_name: String,
    pub is_transparent: bool,
    pub is_topmost: bool,
    pub opacity: f32,
}

// Platform-specific window enumeration
// Windows: use windows-rs crate (EnumWindows API)
// macOS: use core-graphics + accessibility APIs
// Linux: use x11 or wayland protocols

#[cfg(target_os = "windows")]
pub fn scan_windows() -> Vec<WindowInfo> {
    // TODO: implement with windows-rs
    // EnumWindows -> GetWindowLong (check WS_EX_TRANSPARENT, WS_EX_TOPMOST)
    // GetLayeredWindowAttributes for opacity
    vec![]
}

#[cfg(target_os = "macos")]
pub fn scan_windows() -> Vec<WindowInfo> {
    // TODO: implement with core-graphics
    // CGWindowListCopyWindowInfo for window list
    // kCGWindowAlpha for opacity
    vec![]
}

#[cfg(target_os = "linux")]
pub fn scan_windows() -> Vec<WindowInfo> {
    // TODO: implement with x11rb or wayland-client
    vec![]
}
