use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ClipboardEvent {
    pub content_length: usize,  // NEVER store actual content
    pub source: String,
    pub timestamp: u64,
}

// Monitor clipboard changes
// Uses platform clipboard listeners, only records metadata
pub fn watch_clipboard() -> Option<ClipboardEvent> {
    // TODO: implement with arboard or clipboard-rs crate
    // Only track: length of content + which app is focused
    // NEVER store actual clipboard content (privacy)
    None
}
