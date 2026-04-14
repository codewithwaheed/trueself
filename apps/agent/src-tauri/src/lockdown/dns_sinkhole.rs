use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use tokio::sync::oneshot;
use hickory_server::authority::MessageResponseBuilder;
use hickory_server::proto::op::{Header, ResponseCode};
use hickory_server::proto::rr::{DNSClass, Name, RData, Record, RecordType};
use hickory_server::server::{Request, RequestHandler, ResponseHandler, ResponseInfo};
use hickory_server::ServerFuture;

const SINKHOLED_DOMAINS: &[&str] = &[
    "openai.com",
    "chatgpt.com",
    "claude.ai",
    "anthropic.com",
    "api.github.com",
    "copilot.github.com",
    "cursor.sh",
    "codeium.com",
    "tabnine.com",
    "sourcegraph.com",
    "api.together.xyz",
    "api.groq.com",
    "api.mistral.ai",
    "api.cohere.ai",
    "generativelanguage.googleapis.com",
];

/// DNS sinkhole state. Holds the shutdown sender so `stop()` can signal the server task.
pub struct DnsSinkhole {
    shutdown_tx: Option<oneshot::Sender<()>>,
    pub original_dns: Vec<String>,
    pub original_interface: String,
}

// ---- Handler ----

struct SinkholeHandler;

impl SinkholeHandler {
    fn matches(domain: &str) -> bool {
        let domain = domain.trim_end_matches('.');
        let domain_lower = domain.to_lowercase();
        SINKHOLED_DOMAINS.iter().any(|&blocked| {
            domain_lower == blocked || domain_lower.ends_with(&format!(".{}", blocked))
        })
    }
}

#[async_trait::async_trait]
impl RequestHandler for SinkholeHandler {
    async fn handle_request<R: ResponseHandler>(
        &self,
        request: &Request,
        mut response_handle: R,
    ) -> ResponseInfo {
        let query = request.query();
        let name = query.name();
        let domain = name.to_string();

        let response_builder = MessageResponseBuilder::from_message_request(request);
        let mut header = Header::response_from_request(request.header());

        if query.query_type() == RecordType::A && Self::matches(&domain) {
            // Sinkhole: respond with 127.0.0.1
            header.set_response_code(ResponseCode::NoError);
            header.set_authoritative(true);

            let mut record = Record::new();
            record.set_name(Name::from(name));
            record.set_ttl(0); // No caching
            record.set_rr_type(RecordType::A);
            record.set_dns_class(DNSClass::IN);
            record.set_data(Some(RData::A(hickory_server::proto::rr::rdata::A(
                Ipv4Addr::LOCALHOST,
            ))));

            let response = response_builder.build(header, vec![&record], &[], &[], &[]);
            response_handle.send_response(response).await.unwrap_or_else(|e| {
                eprintln!("[dns_sinkhole] send_response error: {}", e);
                ResponseInfo::from(header)
            })
        } else {
            // Non-sinkholed: forward to upstream DNS
            match forward_query(request).await {
                Ok(answers) => {
                    header.set_response_code(ResponseCode::NoError);
                    let refs: Vec<&Record> = answers.iter().collect();
                    let response = response_builder.build(header, refs, &[], &[], &[]);
                    response_handle.send_response(response).await.unwrap_or_else(|e| {
                        eprintln!("[dns_sinkhole] send_response error: {}", e);
                        ResponseInfo::from(header)
                    })
                }
                Err(e) => {
                    eprintln!("[dns_sinkhole] upstream forward failed: {}", e);
                    header.set_response_code(ResponseCode::ServFail);
                    let response = response_builder.build(header, &[], &[], &[], &[]);
                    response_handle.send_response(response).await.unwrap_or_else(|_| {
                        ResponseInfo::from(header)
                    })
                }
            }
        }
    }
}

async fn forward_query(request: &Request) -> Result<Vec<Record>, String> {
    use hickory_resolver::TokioAsyncResolver;
    use hickory_resolver::config::{ResolverConfig, ResolverOpts};

    // Use 8.8.8.8 as fallback upstream for forwarding during sinkhole operation.
    // The original system DNS was saved before we redirected, but using a hardcoded
    // upstream avoids a circular dependency while our sinkhole intercepts port 53.
    let resolver = TokioAsyncResolver::tokio(ResolverConfig::google(), ResolverOpts::default());

    let query = request.query();
    let name = query.name().to_string();
    let name = name.trim_end_matches('.');

    let lookup = resolver
        .lookup_ip(name)
        .await
        .map_err(|e| format!("upstream lookup failed: {}", e))?;

    let records: Vec<Record> = lookup
        .iter()
        .map(|ip| {
            let mut r = Record::new();
            r.set_name(Name::from(query.name()));
            r.set_ttl(60);
            r.set_rr_type(RecordType::A);
            r.set_dns_class(DNSClass::IN);
            match ip {
                IpAddr::V4(v4) => {
                    r.set_data(Some(RData::A(hickory_server::proto::rr::rdata::A(v4))));
                }
                IpAddr::V6(_) => {
                    // Skip IPv6 for now — sinkhole is IPv4 focused
                }
            }
            r
        })
        .filter(|r| r.data().is_some())
        .collect();

    Ok(records)
}

// ---- DNS sinkhole main impl ----

impl DnsSinkhole {
    /// Start the DNS sinkhole: launches the DNS server on 127.0.0.1:5300,
    /// then redirects system DNS to 127.0.0.1.
    /// Using port 5300 (unprivileged) with a pfctl redirect for port 53 is the
    /// recommended approach, but for simplicity we redirect system DNS directly
    /// to 127.0.0.1 and run on port 53. The caller must ensure elevated privileges
    /// are available (see privilege.rs).
    ///
    /// If running on port 53 fails (permission denied), we fall back to port 5300
    /// with a best-effort pfctl redirect on macOS.
    pub async fn start() -> Result<Self, String> {
        // 1. Detect active interface and save original DNS
        let (interface, original_dns) = Self::get_original_dns()?;

        // 2. Persist DNS backup for crash recovery
        Self::persist_dns_backup(&interface, &original_dns)?;

        // 3. Try to bind DNS server — port 53 first, fall back to 5300
        let (port, server_task) = Self::start_server().await?;

        // 4. If using port 5300, add pfctl redirect rule on macOS
        if port == 5300 {
            #[cfg(target_os = "macos")]
            Self::add_pf_redirect().map_err(|e| {
                eprintln!("[dns_sinkhole] pfctl redirect failed: {}", e);
            }).ok();
        }

        // 5. Redirect system DNS to 127.0.0.1
        Self::apply_system_dns(&interface, "127.0.0.1")?;

        // 6. Flush DNS cache
        Self::flush_dns_cache();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // 7. Drive the server future, respecting the shutdown signal
        tokio::spawn(async move {
            tokio::select! {
                _ = server_task => {}
                _ = shutdown_rx => {}
            }
        });

        Ok(DnsSinkhole {
            shutdown_tx: Some(shutdown_tx),
            original_dns,
            original_interface: interface,
        })
    }

    async fn start_server() -> Result<(u16, tokio::task::JoinHandle<()>), String> {
        // Try port 53 first; if EACCES fall back to 5300
        for &port in &[53u16, 5300u16] {
            let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
            match tokio::net::UdpSocket::bind(addr).await {
                Ok(udp_socket) => {
                    let handler = SinkholeHandler;
                    let handle = tokio::spawn(async move {
                        let mut server = ServerFuture::new(handler);
                        server.register_socket(udp_socket);
                        if let Err(e) = server.block_until_done().await {
                            eprintln!("[dns_sinkhole] server error: {}", e);
                        }
                    });
                    return Ok((port, handle));
                }
                Err(e) => {
                    eprintln!("[dns_sinkhole] cannot bind port {}: {}", port, e);
                    continue;
                }
            }
        }
        Err("Could not bind DNS server on port 53 or 5300".to_string())
    }

    /// Stop the DNS sinkhole: restore system DNS and signal server shutdown.
    pub async fn stop(&mut self) -> Result<(), String> {
        // Restore DNS first (most critical)
        if let Err(e) = Self::restore_system_dns(&self.original_interface, &self.original_dns) {
            eprintln!("[dns_sinkhole] DNS restore failed: {}", e);
        }

        // Remove DNS backup since we restored successfully
        let _ = Self::remove_dns_backup();

        // Flush cache again after restoring
        Self::flush_dns_cache();

        // Signal server shutdown
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        // Remove pfctl redirect if it was added
        #[cfg(target_os = "macos")]
        Self::remove_pf_redirect().ok();

        Ok(())
    }

    /// Synchronous stop for use in Drop — runs the restore commands directly without tokio.
    pub fn stop_sync(&mut self) {
        // Restore DNS synchronously
        Self::restore_system_dns_sync(&self.original_interface, &self.original_dns);
        let _ = Self::remove_dns_backup();

        // Signal server shutdown
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        #[cfg(target_os = "macos")]
        Self::remove_pf_redirect().ok();
    }

    // ---- Platform-specific DNS management ----

    #[cfg(target_os = "macos")]
    fn get_original_dns() -> Result<(String, Vec<String>), String> {
        // Find the active network service via route
        let route_output = std::process::Command::new("route")
            .args(["get", "default"])
            .output()
            .map_err(|e| format!("route get default failed: {}", e))?;

        let route_str = String::from_utf8_lossy(&route_output.stdout);
        let iface = route_str
            .lines()
            .find(|l| l.trim_start().starts_with("interface:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .ok_or("Could not find default interface")?;

        // Map the interface name to a networksetup service name
        let service = Self::interface_to_service(&iface)?;

        // Get current DNS servers for this service
        let dns_output = std::process::Command::new("networksetup")
            .args(["-getdnsservers", &service])
            .output()
            .map_err(|e| format!("networksetup failed: {}", e))?;

        let dns_str = String::from_utf8_lossy(&dns_output.stdout);
        let servers: Vec<String> = if dns_str.contains("There aren't any DNS Servers") {
            vec!["empty".to_string()] // Special sentinel — means "no custom DNS"
        } else {
            dns_str
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        };

        Ok((service, servers))
    }

    #[cfg(target_os = "macos")]
    fn interface_to_service(iface: &str) -> Result<String, String> {
        let output = std::process::Command::new("networksetup")
            .arg("-listallnetworkservices")
            .output()
            .map_err(|e| format!("networksetup list failed: {}", e))?;

        let list = String::from_utf8_lossy(&output.stdout);

        // Check each service to find one that uses this interface
        for service in list.lines().skip(1) {
            // Skip the informational first line
            let service = service.trim().trim_start_matches('*'); // disabled services start with *
            let service = service.trim();
            if service.is_empty() {
                continue;
            }

            let info_output = std::process::Command::new("networksetup")
                .args(["-getinfo", service])
                .output();

            if let Ok(info) = info_output {
                let info_str = String::from_utf8_lossy(&info.stdout);
                // networksetup -getinfo includes the interface name somewhere
                // We check if the output mentions our iface
                if info_str.to_lowercase().contains(&iface.to_lowercase()) {
                    return Ok(service.to_string());
                }
            }
        }

        // Fallback heuristics: en0 -> Wi-Fi, en1 -> Ethernet
        let fallback = match iface {
            "en0" => "Wi-Fi",
            "en1" => "Ethernet",
            "en2" => "Ethernet 2",
            _ => "Wi-Fi",
        };
        Ok(fallback.to_string())
    }

    #[cfg(target_os = "macos")]
    fn apply_system_dns(service: &str, dns: &str) -> Result<(), String> {
        let output = std::process::Command::new("networksetup")
            .args(["-setdnsservers", service, dns])
            .output()
            .map_err(|e| format!("networksetup set dns failed: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            // Permission denied — try via osascript elevation
            let cmd = format!("networksetup -setdnsservers '{}' '{}'", service, dns);
            super::privilege::request_elevation(&cmd)
        }
    }

    #[cfg(target_os = "macos")]
    fn restore_system_dns(service: &str, original: &[String]) -> Result<(), String> {
        let dns_arg = if original == ["empty"] {
            "empty".to_string()
        } else {
            original.join(" ")
        };
        let output = std::process::Command::new("networksetup")
            .args(["-setdnsservers", service, &dns_arg])
            .output()
            .map_err(|e| format!("networksetup restore failed: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let cmd = format!("networksetup -setdnsservers '{}' '{}'", service, dns_arg);
            super::privilege::request_elevation(&cmd)
        }
    }

    #[cfg(target_os = "macos")]
    fn restore_system_dns_sync(service: &str, original: &[String]) {
        let dns_arg = if original == ["empty"] {
            "empty".to_string()
        } else {
            original.join(" ")
        };
        let _ = std::process::Command::new("networksetup")
            .args(["-setdnsservers", service, &dns_arg])
            .status();
    }

    #[cfg(target_os = "macos")]
    fn flush_dns_cache() {
        let _ = std::process::Command::new("dscacheutil")
            .arg("-flushcache")
            .status();
        let _ = std::process::Command::new("killall")
            .args(["-HUP", "mDNSResponder"])
            .status();
    }

    #[cfg(target_os = "macos")]
    fn add_pf_redirect() -> Result<(), String> {
        // Add a pf rule to redirect UDP port 53 to 5300 on lo0
        let rule = "rdr pass on lo0 proto udp from any to 127.0.0.1 port 53 -> 127.0.0.1 port 5300\n";
        let rule_file = "/tmp/trueself_pf.conf";
        std::fs::write(rule_file, rule)
            .map_err(|e| format!("write pf rules: {}", e))?;
        super::privilege::request_elevation(&format!("pfctl -f {} -e", rule_file))
    }

    #[cfg(target_os = "macos")]
    fn remove_pf_redirect() -> Result<(), String> {
        super::privilege::request_elevation("pfctl -d 2>/dev/null; pfctl -F rules 2>/dev/null || true")
    }

    // ---- Linux ----

    #[cfg(target_os = "linux")]
    fn get_original_dns() -> Result<(String, Vec<String>), String> {
        let content = std::fs::read_to_string("/etc/resolv.conf")
            .map_err(|e| format!("read resolv.conf: {}", e))?;
        let servers: Vec<String> = content
            .lines()
            .filter(|l| l.starts_with("nameserver"))
            .filter_map(|l| l.split_whitespace().nth(1))
            .map(|s| s.to_string())
            .collect();
        Ok(("resolv.conf".to_string(), servers))
    }

    #[cfg(target_os = "linux")]
    fn apply_system_dns(_service: &str, dns: &str) -> Result<(), String> {
        let content = format!("nameserver {}\n", dns);
        std::fs::write("/etc/resolv.conf", content)
            .map_err(|e| format!("write resolv.conf: {}", e))
    }

    #[cfg(target_os = "linux")]
    fn restore_system_dns(_service: &str, original: &[String]) -> Result<(), String> {
        let content: String = original
            .iter()
            .map(|s| format!("nameserver {}\n", s))
            .collect();
        std::fs::write("/etc/resolv.conf", content)
            .map_err(|e| format!("restore resolv.conf: {}", e))
    }

    #[cfg(target_os = "linux")]
    fn restore_system_dns_sync(_service: &str, original: &[String]) {
        let content: String = original
            .iter()
            .map(|s| format!("nameserver {}\n", s))
            .collect();
        let _ = std::fs::write("/etc/resolv.conf", content);
    }

    #[cfg(target_os = "linux")]
    fn flush_dns_cache() {
        // systemd-resolved
        let _ = std::process::Command::new("systemd-resolve")
            .arg("--flush-caches")
            .status();
    }

    // ---- Windows ----

    #[cfg(target_os = "windows")]
    fn get_original_dns() -> Result<(String, Vec<String>), String> {
        let output = std::process::Command::new("netsh")
            .args(["interface", "ip", "show", "config"])
            .output()
            .map_err(|e| format!("netsh failed: {}", e))?;
        let text = String::from_utf8_lossy(&output.stdout);

        // Parse the first interface with a DNS server
        let mut iface = String::from("Ethernet");
        let mut servers = Vec::new();

        let mut current_iface = String::new();
        for line in text.lines() {
            if line.starts_with("Configuration for interface") {
                current_iface = line
                    .trim_start_matches("Configuration for interface")
                    .trim_matches('"')
                    .trim()
                    .to_string();
            }
            if line.trim_start().starts_with("DNS Servers:") {
                if let Some(dns) = line.split(':').nth(1) {
                    let dns = dns.trim().to_string();
                    if !dns.is_empty() {
                        iface = current_iface.clone();
                        servers.push(dns);
                    }
                }
            }
        }

        Ok((iface, servers))
    }

    #[cfg(target_os = "windows")]
    fn apply_system_dns(service: &str, dns: &str) -> Result<(), String> {
        let output = std::process::Command::new("netsh")
            .args([
                "interface", "ip", "set", "dnsservers",
                service, "static", dns, "primary",
            ])
            .output()
            .map_err(|e| format!("netsh set dns: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "netsh failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    #[cfg(target_os = "windows")]
    fn restore_system_dns(service: &str, original: &[String]) -> Result<(), String> {
        if original.is_empty() {
            let _ = std::process::Command::new("netsh")
                .args(["interface", "ip", "set", "dnsservers", service, "dhcp"])
                .output();
            return Ok(());
        }
        let output = std::process::Command::new("netsh")
            .args([
                "interface", "ip", "set", "dnsservers",
                service, "static", &original[0], "primary",
            ])
            .output()
            .map_err(|e| format!("netsh restore: {}", e))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(target_os = "windows")]
    fn restore_system_dns_sync(service: &str, original: &[String]) {
        let _ = Self::restore_system_dns(service, original);
    }

    #[cfg(target_os = "windows")]
    fn flush_dns_cache() {
        let _ = std::process::Command::new("ipconfig")
            .arg("/flushdns")
            .status();
    }

    // ---- DNS backup file (crash recovery) ----

    fn backup_path() -> std::path::PathBuf {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| "/tmp".to_string());
        std::path::PathBuf::from(home)
            .join(".trueself")
            .join("dns_backup.json")
    }

    fn persist_dns_backup(interface: &str, servers: &[String]) -> Result<(), String> {
        let path = Self::backup_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create backup dir: {}", e))?;
        }
        let data = serde_json::json!({
            "interface": interface,
            "servers": servers,
        });
        std::fs::write(&path, data.to_string())
            .map_err(|e| format!("write dns backup: {}", e))
    }

    fn remove_dns_backup() -> Result<(), String> {
        let path = Self::backup_path();
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("remove dns backup: {}", e))?;
        }
        Ok(())
    }

    /// Check if a stale DNS backup exists (from a previous crash) and restore from it.
    pub fn recover_from_backup() -> bool {
        let path = Self::backup_path();
        if !path.exists() {
            return false;
        }
        eprintln!("[dns_sinkhole] stale DNS backup found — attempting recovery");
        let data = match std::fs::read_to_string(&path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[dns_sinkhole] read backup failed: {}", e);
                return false;
            }
        };
        let v: serde_json::Value = match serde_json::from_str(&data) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[dns_sinkhole] parse backup failed: {}", e);
                return false;
            }
        };

        let interface = match v["interface"].as_str() {
            Some(s) => s.to_string(),
            None => return false,
        };
        let servers: Vec<String> = match v["servers"].as_array() {
            Some(arr) => arr
                .iter()
                .filter_map(|s| s.as_str().map(|s| s.to_string()))
                .collect(),
            None => return false,
        };

        if let Err(e) = Self::restore_system_dns(&interface, &servers) {
            eprintln!("[dns_sinkhole] recovery restore failed: {}", e);
            return false;
        }

        let _ = Self::remove_dns_backup();
        Self::flush_dns_cache();
        eprintln!("[dns_sinkhole] DNS recovery successful");
        true
    }

    /// Check whether the current system DNS appears to be pointing to our sinkhole.
    pub fn is_dns_redirected() -> bool {
        #[cfg(target_os = "macos")]
        {
            // Quick check: see if the backup file exists
            Self::backup_path().exists()
        }
        #[cfg(not(target_os = "macos"))]
        {
            Self::backup_path().exists()
        }
    }
}
