use serde::Serialize;

const FLAGGED_DOMAINS: &[&str] = &[
    "api.openai.com",
    "claude.ai",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",  // Gemini
    "api.together.xyz",
    "api.groq.com",
    "api.mistral.ai",
    "api.cohere.ai",
    "copilot.github.com",
    "codeium.com",
];

#[derive(Debug, Serialize, Clone)]
pub struct NetworkFlag {
    pub destination: String,
    pub port: u16,
    pub protocol: String,
    pub detected_at: u64,
}

// Check active network connections against flagged domains
// Uses netstat-like approach via sysinfo or platform APIs
pub fn scan_connections() -> Vec<NetworkFlag> {
    // TODO: implement with:
    // - Windows: GetTcpTable2 / GetExtendedTcpTable
    // - macOS: libproc
    // - Linux: read /proc/net/tcp + resolve IPs
    // Then DNS-reverse-lookup or match IP ranges of known AI services
    vec![]
}
