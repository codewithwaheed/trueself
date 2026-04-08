use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ScreenInfo {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f64,
}

// Uses Tauri's built-in monitor API (called from commands)
// This is a placeholder — actual implementation uses tauri::Monitor
pub fn get_screens(app: &tauri::AppHandle) -> Vec<ScreenInfo> {
    let monitors = app.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let size = m.size();
            ScreenInfo {
                id: i as u32,
                width: size.width,
                height: size.height,
                is_primary: i == 0, // primary is typically first
                scale_factor: m.scale_factor(),
            }
        })
        .collect()
}
