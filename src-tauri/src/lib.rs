use std::collections::HashMap;

mod layout_detection;
mod reader_store;
mod writer;
mod writer_store;
use base64::Engine;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use wait_timeout::ChildExt;

static ACTIVE_AGENT_PID: AtomicI32 = AtomicI32::new(0);
static ACTIVE_AGENT_SESSION: OnceLock<Mutex<Option<String>>> = OnceLock::new();
const PAPER_CHECK_SKILL: &str = include_str!("../resources/skills/whalepaper-paper-check/SKILL.md");

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiHttpRequest {
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
struct AiHttpResponse {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

#[derive(serde::Serialize)]
struct BinaryHttpResponse {
    status: u16,
    body: String,
    content_type: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriterAgentRequest {
    root_path: String,
    #[serde(default)]
    session_id: Option<String>,
    runtime: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    permission_mode: Option<String>,
    #[serde(default)]
    access_mode: Option<String>,
    #[serde(default)]
    third_party: Option<AgentThirdPartyConfig>,
    #[serde(default)]
    cli_path: Option<String>,
    #[serde(default)]
    skill: Option<String>,
    prompt: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentThirdPartyConfig {
    base_url: String,
    api_key: String,
    model: String,
    #[serde(default)]
    models: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelListRequest {
    runtime: String,
    #[serde(default)]
    access_mode: Option<String>,
    #[serde(default)]
    third_party: Option<AgentThirdPartyConfig>,
    #[serde(default)]
    cli_path: Option<String>,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeStatusRequest {
    #[serde(default)]
    paths: HashMap<String, String>,
    #[serde(default)]
    refresh: bool,
}

fn dream_worker(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        // Match Claude Code's scan throttle: checking is cheap; the actual
        // Dream still requires the 24-hour and five-session gates below.
        std::thread::sleep(Duration::from_secs(600));
        if ACTIVE_AGENT_PID.load(Ordering::SeqCst) != 0 {
            continue;
        }
        let Some((root_path, runtime, model, context)) = writer_store::dream_target(&app) else {
            continue;
        };
        let request = WriterAgentRequest {
            root_path,
            session_id: Some(format!("dream-{}", std::process::id())),
            runtime,
            model,
            permission_mode: Some("plan".to_string()),
            access_mode: Some("direct".to_string()),
            third_party: None,
            cli_path: None,
            skill: None,
            prompt: format!("请根据以下近期会话信号，整理一份简洁的长期用户画像。只保留对未来协作有帮助且不敏感的信息，不要修改项目文件。\n\n{}", context),
        };
        let result = tauri::async_runtime::block_on(run_writer_agent(app.clone(), request));
        if let Ok(content) = result {
            let _ = writer_store::save_user_memory(
                app.clone(),
                writer_store::SaveUserMemoryRequest {
                    id: format!("dream-memory-{}", chrono_like_timestamp()),
                    memory_type: "profile".to_string(),
                    title: "长期用户画像".to_string(),
                    content,
                    source: Some("auto_dream".to_string()),
                },
            );
            writer_store::mark_dream_run(&app);
        }
    });
}

fn chrono_like_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

/// Extract the actionable error emitted by a non-interactive Agent process.
/// Codex writes plugin/auth diagnostics to stderr, while the actual provider
/// failure is normally a structured JSONL event on stdout. Prefer that event
/// so a warning cannot hide the reason the turn failed.
fn structured_agent_error(stdout: &str) -> Option<String> {
    structured_agent_error_impl(stdout, false)
}

// A successful process may still contain transient `error` events emitted
// while Codex reconnects. Only terminal events are actionable in that case.
fn structured_terminal_agent_error(stdout: &str) -> Option<String> {
    structured_agent_error_impl(stdout, true)
}

fn structured_agent_error_impl(stdout: &str, terminal_only: bool) -> Option<String> {
    fn non_empty_text(value: Option<&serde_json::Value>) -> Option<String> {
        let value = value?;
        match value {
            serde_json::Value::String(text) if !text.trim().is_empty() => {
                Some(text.trim().to_string())
            }
            serde_json::Value::Object(object) => object
                .get("message")
                .and_then(|message| non_empty_text(Some(message)))
                .or_else(|| {
                    object
                        .get("error")
                        .and_then(|error| non_empty_text(Some(error)))
                })
                .or_else(|| {
                    object
                        .get("detail")
                        .and_then(|detail| non_empty_text(Some(detail)))
                }),
            _ => None,
        }
    }

    fn value_error(value: &serde_json::Value, terminal_only: bool) -> Option<String> {
        let object = value.as_object()?;
        let event_type = object.get("type").and_then(serde_json::Value::as_str);
        if event_type == Some("turn.failed") {
            return non_empty_text(object.get("error"))
                .or_else(|| non_empty_text(object.get("message")));
        }
        if !terminal_only && event_type == Some("error") {
            return non_empty_text(object.get("message"))
                .or_else(|| non_empty_text(object.get("error")));
        }
        if !terminal_only
            && (event_type == Some("item.completed") || event_type == Some("item.started"))
        {
            if let Some(item) = object.get("item") {
                if item.get("type").and_then(serde_json::Value::as_str) == Some("error") {
                    return non_empty_text(item.get("message"))
                        .or_else(|| non_empty_text(item.get("error")));
                }
            }
        }
        // Claude Code can return a result with either an error subtype or
        // `is_error: true` (including `subtype: "success"` after retries).
        // In both cases the provider detail may live in errors[],
        // error_message, result, or a nested error object.
        if event_type == Some("result") {
            let is_error = object
                .get("is_error")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let subtype = object.get("subtype").and_then(serde_json::Value::as_str);
            if is_error || subtype.is_some_and(|value| value.contains("error")) {
                if let Some(message) = object
                    .get("errors")
                    .and_then(serde_json::Value::as_array)
                    .and_then(|errors| errors.iter().find_map(|error| non_empty_text(Some(error))))
                {
                    return Some(message);
                }
                for key in [
                    "error_message",
                    "result",
                    "error",
                    "message",
                    "stop_reason",
                    "terminal_reason",
                ] {
                    if let Some(message) = non_empty_text(object.get(key)) {
                        return Some(message);
                    }
                }
                if let Some(subtype) =
                    subtype.filter(|value| !value.trim().is_empty() && *value != "success")
                {
                    return Some(subtype.trim().to_string());
                }
                return Some("Runtime 返回错误".to_string());
            }
        }
        None
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        if let Some(error) = value_error(&value, terminal_only) {
            return Some(error);
        }
    }
    stdout
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
        .find_map(|value| value_error(&value, terminal_only))
}

fn filtered_agent_stderr(stderr: &str) -> String {
    stderr
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter(|line| !line.contains("Reading additional input from stdin"))
        .filter(|line| !line.contains("remote installed plugin bundle sync failed"))
        .filter(|line| !line.contains("failed to warm featured plugin ids cache"))
        .filter(|line| !line.contains("codex_core_plugins::manifest"))
        .filter(|line| !line.contains("codex_skills::interface"))
        .filter(|line| !line.contains("codex_rollout::list"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    let start = chars.len().saturating_sub(max_chars);
    chars[start..].iter().collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeInfo {
    id: String,
    label: String,
    available: bool,
    authenticated: Option<bool>,
    version: Option<String>,
    path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelInfo {
    id: String,
    label: String,
    is_default: bool,
    context_window: Option<u32>,
}

static AGENT_BINARY_CACHE: OnceLock<Mutex<HashMap<String, Option<PathBuf>>>> = OnceLock::new();

fn agent_command(path: &Path) -> Command {
    #[cfg(windows)]
    if matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("cmd") | Some("bat")
    ) {
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/C"]).arg(path);
        return command;
    }
    Command::new(path)
}

fn push_unique(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|item| item == &candidate) {
        candidates.push(candidate);
    }
}

fn executable_variants(path: PathBuf) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut variants = vec![path.clone()];
        if path.extension().is_none() {
            variants.extend([
                path.with_extension("exe"),
                path.with_extension("cmd"),
                path.with_extension("bat"),
            ]);
        }
        return variants;
    }
    vec![path]
}

fn executable_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let add = |candidates: &mut Vec<PathBuf>, path: PathBuf| {
        for variant in executable_variants(path) {
            push_unique(candidates, variant);
        }
    };

    #[cfg(target_os = "macos")]
    if name == "codex" {
        // ChatGPT.app is the primary Codex Runtime on macOS. Prefer its
        // bundled binary over PATH entries such as a stale Homebrew shim.
        add(
            &mut candidates,
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex"),
        );
        add(
            &mut candidates,
            PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
        );
    }

    // split_paths handles ':' on Unix and ';' on Windows, including quoted
    // or platform-specific path syntax.
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            add(&mut candidates, directory.join(name));
        }
    }

    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    if let Some(home) = home.as_ref() {
        for directory in [".local/bin", ".claude/bin", ".bun/bin"] {
            add(&mut candidates, home.join(directory).join(name));
        }
        #[cfg(windows)]
        if name == "codex" {
            add(
                &mut candidates,
                home.join("AppData/Local/OpenAI/Codex/bin/codex"),
            );
        }
    }

    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            let codex_bin = local_app_data.join("OpenAI/Codex/bin");
            add(&mut candidates, codex_bin.join("codex"));
            // Codex Desktop keeps the executable in a versioned child folder.
            // Sort the folders so the newest-looking install is tried first.
            if let Ok(entries) = fs::read_dir(&codex_bin) {
                let mut directories = entries
                    .flatten()
                    .filter_map(|entry| {
                        entry
                            .file_type()
                            .ok()
                            .filter(|kind| kind.is_dir())
                            .map(|_| entry.path())
                    })
                    .collect::<Vec<_>>();
                directories.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
                for directory in directories {
                    add(&mut candidates, directory.join(name));
                }
            }
            for directory in ["Programs/Claude Code", "Programs/Claude", "Programs"] {
                add(&mut candidates, local_app_data.join(directory).join(name));
            }
        }
        let roaming_app_data = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|value| value.join("AppData/Roaming")));
        if let Some(roaming_app_data) = roaming_app_data {
            add(&mut candidates, roaming_app_data.join("npm").join(name));
        }
        // `where.exe` also sees PATH entries inherited by the desktop app,
        // which may differ from the shell used to launch it.
        if let Ok(output) = Command::new("where.exe").arg(name).output() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let path = PathBuf::from(line.trim());
                if !path.as_os_str().is_empty() {
                    add(&mut candidates, path);
                }
            }
        }
    }

    #[cfg(unix)]
    for directory in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        add(&mut candidates, Path::new(directory).join(name));
    }
    candidates
}

fn configured_executable_candidates(name: &str, configured_path: Option<&str>) -> Vec<PathBuf> {
    let Some(value) = configured_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };
    let path = PathBuf::from(value);
    let mut candidates = executable_variants(path.clone());
    if path.extension().is_none() || path.is_dir() {
        for variant in executable_variants(path.join(name)) {
            push_unique(&mut candidates, variant);
        }
    }
    candidates
}

const AGENT_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Run a probe subprocess with bounded execution time. Probe commands such as
/// `claude --version` or `codex login status` can block on first-run
/// migrations or network authentication, so a timeout keeps a slow or hung CLI
/// from occupying its thread indefinitely.
fn command_output_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Option<std::process::Output> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().ok()?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_reader = stdout_pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
            bytes
        })
    });
    let stderr_reader = stderr_pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
            bytes
        })
    });
    let status = match child.wait_timeout(timeout).ok()? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let stdout = stdout_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    Some(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

fn probe_version(path: &Path) -> Option<String> {
    let output =
        command_output_with_timeout(agent_command(path).arg("--version"), AGENT_PROBE_TIMEOUT)?;
    if !output.status.success() {
        return None;
    }
    let value = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    let value = String::from_utf8_lossy(value).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn resolve_agent_binary(
    name: &str,
    configured_path: Option<&str>,
    refresh: bool,
) -> Option<PathBuf> {
    let configured = configured_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    let key = format!("{name}\0{configured}");
    let cache = AGENT_BINARY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache.lock().ok()?;
    if refresh {
        cache.clear();
    }
    if let Some(result) = cache.get(&key) {
        return result.clone();
    }
    // A configured path is authoritative for the first attempt. Only when it
    // is absent or unusable do we construct and scan the platform candidates.
    let configured_candidates = configured_executable_candidates(name, Some(configured));
    let result = configured_candidates
        .into_iter()
        .find(|path| path.is_file() && probe_version(path).is_some())
        .or_else(|| {
            executable_candidates(name)
                .into_iter()
                .find(|path| path.is_file() && probe_version(path).is_some())
        });
    cache.insert(key, result.clone());
    result
}

fn probe_agent(
    name: &str,
    id: &str,
    label: &str,
    configured_path: Option<&str>,
    refresh: bool,
) -> AgentRuntimeInfo {
    let path = resolve_agent_binary(name, configured_path, refresh);
    let version = path.as_ref().and_then(|binary| probe_version(binary));
    let available = path.is_some() && version.is_some();
    let authenticated = path.as_ref().and_then(|binary| {
        let ambient_key_present = if name == "claude" {
            ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]
        } else {
            ["OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"]
        }
        .into_iter()
        .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty()));
        if ambient_key_present {
            return Some(true);
        }
        if name == "codex" {
            // ChatGPT.app's bundled Codex persists account/API-key auth in
            // CODEX_HOME (normally ~/.codex). The GUI launch environment can
            // occasionally make `login status` output unavailable even while
            // that credential is valid, so use the non-empty auth file as a
            // conservative local fallback.
            if std::env::var("CODEX_HOME")
                .ok()
                .map(|home| Path::new(&home).join("auth.json"))
                .or_else(|| {
                    std::env::var_os("HOME")
                        .or_else(|| std::env::var_os("USERPROFILE"))
                        .map(|home| PathBuf::from(home).join(".codex/auth.json"))
                })
                .is_some_and(|auth| {
                    auth.is_file() && fs::metadata(auth).is_ok_and(|meta| meta.len() > 0)
                })
            {
                return Some(true);
            }
        }
        let output = if name == "claude" {
            command_output_with_timeout(
                agent_command(binary).args(["auth", "status", "--json"]),
                AGENT_PROBE_TIMEOUT,
            )?
        } else {
            command_output_with_timeout(
                agent_command(binary).args(["login", "status"]),
                AGENT_PROBE_TIMEOUT,
            )?
        };
        if !output.status.success() {
            return Some(false);
        }
        if name == "claude" {
            serde_json::from_slice::<serde_json::Value>(&output.stdout)
                .ok()
                .and_then(|value| value.get("loggedIn").and_then(serde_json::Value::as_bool))
        } else {
            Some(String::from_utf8_lossy(&output.stdout).contains("Logged in"))
        }
    });
    AgentRuntimeInfo {
        id: id.to_string(),
        label: label.to_string(),
        available,
        authenticated,
        version,
        path: path.map(|value| value.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
async fn agent_runtime_status(request: Option<AgentRuntimeStatusRequest>) -> Vec<AgentRuntimeInfo> {
    let request = request.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        vec![
            probe_agent(
                "claude",
                "claude_code",
                "Claude Code",
                request.paths.get("claude_code").map(String::as_str),
                request.refresh,
            ),
            probe_agent(
                "codex",
                "codex_runtime",
                "Codex",
                request.paths.get("codex_runtime").map(String::as_str),
                false,
            ),
        ]
    })
    .await
    .unwrap_or_default()
}

fn claude_model_options() -> Vec<AgentModelInfo> {
    vec![
        AgentModelInfo {
            id: "sonnet".into(),
            label: "Sonnet".into(),
            is_default: true,
            context_window: Some(200_000),
        },
        AgentModelInfo {
            id: "opus".into(),
            label: "Opus".into(),
            is_default: false,
            context_window: Some(200_000),
        },
        AgentModelInfo {
            id: "haiku".into(),
            label: "Haiku".into(),
            is_default: false,
            context_window: Some(200_000),
        },
    ]
}

#[derive(serde::Deserialize)]
struct CodexModelRow {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "isDefault")]
    is_default: bool,
    hidden: bool,
}

#[derive(serde::Deserialize)]
struct CodexModelListResult {
    data: Vec<CodexModelRow>,
}

fn agent_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn cached_codex_context_window(model_id: &str) -> Option<u32> {
    let home = agent_home_dir()?;
    let contents = std::fs::read_to_string(home.join(".codex/models_cache.json")).ok()?;
    let payload = serde_json::from_str::<serde_json::Value>(&contents).ok()?;
    payload
        .get("models")
        .and_then(serde_json::Value::as_array)
        .and_then(|models| {
            models.iter().find(|model| {
                model
                    .get("slug")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|slug| slug == model_id)
            })
        })
        .and_then(|model| {
            model
                .get("context_window")
                .or_else(|| model.get("max_context_window"))
                .and_then(serde_json::Value::as_u64)
                .and_then(|value| u32::try_from(value).ok())
        })
}

fn fetch_codex_models(configured_path: Option<&str>) -> Result<Vec<AgentModelInfo>, String> {
    let path = resolve_agent_binary("codex", configured_path, false)
        .ok_or_else(|| "未检测到 ChatGPT/Codex 的可用二进制。".to_string())?;
    let mut child = agent_command(&path)
        .args(["app-server"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 Codex app-server 失败：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin 不可用".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout 不可用".to_string())?;
    let (tx, rx) = mpsc::channel::<Result<Vec<AgentModelInfo>, String>>();
    std::thread::spawn(move || {
        let initialize = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "whalepaper", "title": "WhalePaper", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "experimentalApi": true }
            }
        });
        if let Err(error) = writeln!(stdin, "{}", initialize).and_then(|_| stdin.flush()) {
            let _ = tx.send(Err(format!("发送 Codex 初始化请求失败：{error}")));
            return;
        }
        let model_list = serde_json::json!({
            "jsonrpc": "2.0", "id": 2, "method": "model/list", "params": { "includeHidden": false }
        });
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut initialized = false;
        loop {
            line.clear();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue;
            };
            if value.get("id") == Some(&serde_json::Value::from(1)) && !initialized {
                if writeln!(
                    stdin,
                    "{}",
                    serde_json::json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
                )
                .is_err()
                    || writeln!(stdin, "{}", model_list).is_err()
                {
                    break;
                }
                let _ = stdin.flush();
                initialized = true;
            } else if value.get("id") == Some(&serde_json::Value::from(2)) {
                let result = value.get("result").cloned().unwrap_or_default();
                match serde_json::from_value::<CodexModelListResult>(result) {
                    Ok(payload) => {
                        let models = payload
                            .data
                            .into_iter()
                            .filter(|model| !model.hidden)
                            .map(|model| AgentModelInfo {
                                context_window: cached_codex_context_window(&model.id),
                                id: model.id,
                                label: model.display_name,
                                is_default: model.is_default,
                            })
                            .collect();
                        let _ = tx.send(Ok(models));
                    }
                    Err(error) => {
                        let _ = tx.send(Err(format!("解析 Codex 模型列表失败：{error}")));
                    }
                }
                break;
            }
        }
    });
    let result = match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(result) => result,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Codex 模型列表获取超时".to_string());
        }
    };
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn third_party_models_url(runtime: &str, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/models") {
        return base.to_string();
    }
    if base.ends_with("/v1") {
        return format!("{base}/models");
    }
    // Both Anthropic's current API and OpenAI-compatible gateways expose the
    // model catalogue below /v1. Keeping this normalization here means users
    // can paste either the provider root or an already versioned endpoint.
    let _ = runtime;
    format!("{base}/v1/models")
}

async fn fetch_third_party_models(
    runtime: &str,
    config: AgentThirdPartyConfig,
) -> Result<Vec<AgentModelInfo>, String> {
    let url = third_party_models_url(runtime, &config.base_url);
    let client = http_client()?;
    let mut request = client.get(url);
    if !config.api_key.trim().is_empty() {
        if runtime == "claude_code" {
            request = request
                .header("x-api-key", config.api_key.trim())
                .header("anthropic-version", "2023-06-01");
        } else {
            request = request.header("authorization", format!("Bearer {}", config.api_key.trim()));
        }
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("获取第三方模型失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取第三方模型列表失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "第三方模型接口返回 {status}: {}",
            body.chars().take(300).collect::<String>()
        ));
    }
    let payload = serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|error| format!("第三方模型列表不是有效 JSON：{error}"))?;
    let rows = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .or_else(|| payload.get("models").and_then(serde_json::Value::as_array))
        .cloned()
        .unwrap_or_default();
    let mut models = rows
        .into_iter()
        .filter_map(|row| {
            let id = row
                .get("id")
                .or_else(|| row.get("model"))
                .and_then(serde_json::Value::as_str)?
                .trim()
                .to_string();
            if id.is_empty() {
                return None;
            }
            let label = row
                .get("display_name")
                .or_else(|| row.get("displayName"))
                .or_else(|| row.get("name"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&id)
                .to_string();
            let context_window = row
                .get("context_window")
                .or_else(|| row.get("contextWindow"))
                .or_else(|| row.get("context_length"))
                .or_else(|| row.get("contextLength"))
                .and_then(serde_json::Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            Some(AgentModelInfo {
                id,
                label,
                is_default: false,
                context_window,
            })
        })
        .collect::<Vec<_>>();
    // Some gateways intentionally disable /models. Preserve the model the
    // user entered so a configured endpoint remains selectable and usable.
    for id in config.models.into_iter().chain([config.model]) {
        let id = id.trim().to_string();
        if !id.is_empty() && !models.iter().any(|item| item.id == id) {
            models.push(AgentModelInfo {
                label: id.clone(),
                id,
                is_default: models.is_empty(),
                context_window: None,
            });
        }
    }
    if !models.iter().any(|item| item.is_default) {
        if let Some(first) = models.first_mut() {
            first.is_default = true;
        }
    }
    Ok(models)
}

#[tauri::command]
async fn agent_model_list(request: AgentModelListRequest) -> Result<Vec<AgentModelInfo>, String> {
    if request.access_mode.as_deref() == Some("thirdparty") {
        let config = request
            .third_party
            .ok_or_else(|| "请先配置第三方 API 地址和模型。".to_string())?;
        if config.base_url.trim().is_empty() {
            return Err("请先填写第三方 API 地址。".to_string());
        }
        return fetch_third_party_models(&request.runtime, config).await;
    }
    tauri::async_runtime::spawn_blocking(move || match request.runtime.as_str() {
        "claude_code" => resolve_agent_binary("claude", request.cli_path.as_deref(), false)
            .map(|_| claude_model_options())
            .ok_or_else(|| "未检测到 Claude Code 的可用二进制。".to_string()),
        "codex_runtime" => fetch_codex_models(request.cli_path.as_deref()),
        _ => Err("未知 Agent runtime".to_string()),
    })
    .await
    .map_err(|error| format!("获取 Agent 模型失败：{error}"))?
}

#[tauri::command]
async fn run_writer_agent(
    app: tauri::AppHandle,
    request: WriterAgentRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stop_writer_agent_process(&app);
        if let Some(skill) = request.skill.as_deref() {
            match skill {
                "paper_check" => install_paper_check_skill(&request.runtime)?,
                _ => return Err("未知 Agent skill".to_string()),
            }
        }
        let root = std::fs::canonicalize(&request.root_path)
            .map_err(|error| format!("无法打开论文项目：{error}"))?;
        if !root.is_dir() {
            return Err("论文项目目录无效".to_string());
        }
        let requested_access_mode = request.access_mode.clone();
        let third_party = request.third_party;
        let requested_model = request
            .model
            .clone()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| third_party.as_ref().map(|config| config.model.clone()));
        let (binary, args): (PathBuf, Vec<String>) = match request.runtime.as_str() {
            "claude_code" => {
                let path = resolve_agent_binary("claude", request.cli_path.as_deref(), false)
                    .ok_or_else(|| {
                        "未检测到 Claude Code，请先安装并登录 claude CLI。".to_string()
                    })?;
                let mut args = vec![
                    "-p".into(),
                    request.prompt,
                    "--output-format".into(),
                    "json".into(),
                    "--permission-mode".into(),
                    if request.permission_mode.as_deref() == Some("full") {
                        "acceptEdits"
                    } else {
                        "plan"
                    }
                    .into(),
                    "--add-dir".into(),
                    root.to_string_lossy().into_owned(),
                ];
                if let Some(model) = requested_model.as_deref() {
                    args.splice(2..2, ["--model".into(), model.to_string()]);
                }
                (path, args)
            }
            "codex_runtime" => {
                let path = resolve_agent_binary("codex", request.cli_path.as_deref(), false)
                    .ok_or_else(|| {
                        "未检测到 Codex，请安装 Codex CLI 或 ChatGPT 桌面版。".to_string()
                    })?;
                let prompt = request.prompt;
                let is_third_party = requested_access_mode.as_deref() == Some("thirdparty");
                let mut args = vec!["exec".into(), "--json".into()];
                if is_third_party {
                    // Third-party mode is isolated from the user's default
                    // provider and receives a transient model_providers entry
                    // below. Direct mode intentionally keeps the local Codex
                    // config so ChatGPT/Codex login and provider settings work.
                    args.push("--ignore-user-config".into());
                }
                args.extend([
                    "--sandbox".into(),
                    if request.permission_mode.as_deref() == Some("full") {
                        "workspace-write"
                    } else {
                        "read-only"
                    }
                    .into(),
                    "--skip-git-repo-check".into(),
                    "--cd".into(),
                    root.to_string_lossy().into_owned(),
                ]);
                if is_third_party {
                    if let Some(config) = third_party.as_ref() {
                        let escaped_url = config
                            .base_url
                            .trim()
                            .replace('\\', "\\\\")
                            .replace('"', "\\\"");
                        // Codex's app-server/exec does not consume
                        // ANTHROPIC-style provider variables. A third-party
                        // Codex connector must therefore be materialized as
                        // a transient model_providers entry, matching the
                        // provider shape used by ChatGPT's Codex runtime.
                        args.extend([
                            "-c".into(),
                            "model_provider=\"whalepaper_thirdparty\"".into(),
                            "-c".into(),
                            "model_providers.whalepaper_thirdparty.name=\"WhalePaper Third-party\""
                                .into(),
                            "-c".into(),
                            format!(
                                "model_providers.whalepaper_thirdparty.base_url=\"{escaped_url}\""
                            ),
                            "-c".into(),
                            "model_providers.whalepaper_thirdparty.wire_api=\"responses\"".into(),
                            "-c".into(),
                            format!(
                                "model_providers.whalepaper_thirdparty.requires_openai_auth={}",
                                !config.api_key.trim().is_empty()
                            ),
                        ]);
                    }
                }
                if let Some(model) = requested_model.as_deref() {
                    args.splice(2..2, ["--model".into(), model.to_string()]);
                }
                args.push(prompt);
                (path, args)
            }
            _ => return Err("未知 Agent runtime".to_string()),
        };
        let mut command = agent_command(&binary);
        command
            .args(args)
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if requested_access_mode.as_deref() == Some("thirdparty") {
            // Do not leak credentials or endpoint overrides from the parent
            // desktop process into a user-selected third-party provider.
            command
                .env_remove("OPENAI_BASE_URL")
                .env_remove("OPENAI_API_KEY")
                .env_remove("ANTHROPIC_BASE_URL")
                .env_remove("ANTHROPIC_API_KEY")
                .env_remove("ANTHROPIC_AUTH_TOKEN");
            if let Some(config) = third_party.as_ref() {
                if !config.base_url.trim().is_empty() {
                    let key_name = if request.runtime == "codex_runtime" {
                        "OPENAI_BASE_URL"
                    } else {
                        "ANTHROPIC_BASE_URL"
                    };
                    command.env(key_name, config.base_url.trim());
                }
                if !config.api_key.trim().is_empty() {
                    let key_name = if request.runtime == "codex_runtime" {
                        "OPENAI_API_KEY"
                    } else {
                        "ANTHROPIC_API_KEY"
                    };
                    command.env(key_name, config.api_key.trim());
                }
            }
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动 Agent 失败：{error}"))?;
        let child_pid = child.id() as i32;
        ACTIVE_AGENT_PID.store(child_pid, Ordering::SeqCst);
        let session_id = request
            .session_id
            .clone()
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| format!("agent-{}-{}", std::process::id(), child.id()));
        let _ = writer_store::start_agent_session(
            &app,
            &session_id,
            &root,
            &request.runtime,
            requested_model.as_deref(),
            child.id() as i64,
        );
        *ACTIVE_AGENT_SESSION
            .get_or_init(|| Mutex::new(None))
            .lock()
            .unwrap() = Some(session_id.clone());
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        let stdout_reader = std::thread::spawn(move || {
            stdout_pipe
                .map(|mut pipe| {
                    let mut bytes = Vec::new();
                    let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
                    bytes
                })
                .unwrap_or_default()
        });
        let stderr_reader = std::thread::spawn(move || {
            stderr_pipe
                .map(|mut pipe| {
                    let mut bytes = Vec::new();
                    let _ = std::io::Read::read_to_end(&mut pipe, &mut bytes);
                    bytes
                })
                .unwrap_or_default()
        });
        // Match kingcode's long-running agent behavior: a request remains
        // active until the Runtime exits or the user closes/cancels it.
        let status = child
            .wait()
            .map_err(|error| format!("读取 Agent 输出失败：{error}"))?;
        let _ = ACTIVE_AGENT_PID.compare_exchange(child_pid, 0, Ordering::SeqCst, Ordering::SeqCst);
        writer_store::finish_agent_session(
            &app,
            &session_id,
            if status.success() {
                "completed"
            } else {
                "failed"
            },
            None,
        );
        if let Ok(mut active) = ACTIVE_AGENT_SESSION.get_or_init(|| Mutex::new(None)).lock() {
            if active.as_deref() == Some(session_id.as_str()) {
                *active = None;
            }
        }
        let stdout_bytes = stdout_reader.join().unwrap_or_default();
        let stderr_bytes = stderr_reader.join().unwrap_or_default();
        let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
        let structured_error = if status.success() {
            structured_terminal_agent_error(&stdout)
        } else {
            structured_agent_error(&stdout)
        };
        if !status.success() || structured_error.is_some() {
            let stderr = filtered_agent_stderr(&String::from_utf8_lossy(&stderr_bytes));
            let detail = structured_error.or_else(|| {
                if stderr.is_empty() {
                    None
                } else {
                    Some(tail_chars(&stderr, 1200))
                }
            });
            return Err(match detail {
                Some(detail) => format!("Agent 执行失败：{detail}"),
                None => format!("Agent 退出失败：{status}"),
            });
        }
        if stdout.is_empty() {
            return Err("Agent 没有返回内容".to_string());
        }
        Ok(stdout)
    })
    .await
    .map_err(|error| format!("Agent 任务异常退出：{error}"))?
}

/// Install the built-in paper audit skill through the Runtime's normal skill
/// discovery path. The prompt stays a normal user turn; no skill text is
/// concatenated into it by WhalePaper.
fn install_paper_check_skill(runtime: &str) -> Result<(), String> {
    let home = agent_home_dir().ok_or_else(|| "无法确定本地 Agent skill 目录。".to_string())?;
    let skill_dir = match runtime {
        "claude_code" => home.join(".claude/skills/whalepaper-paper-check"),
        "codex_runtime" => home.join(".codex/skills/whalepaper-paper-check"),
        _ => return Err("未知 Agent runtime".to_string()),
    };
    fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("无法创建论文查错 skill 目录：{error}"))?;
    fs::write(skill_dir.join("SKILL.md"), PAPER_CHECK_SKILL)
        .map_err(|error| format!("无法安装论文查错 skill：{error}"))
}

fn stop_writer_agent_process(app: &tauri::AppHandle) {
    let pid = ACTIVE_AGENT_PID.swap(0, Ordering::SeqCst);
    if pid > 0 {
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill.exe")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status();
        }
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
            // Claude/Codex can spawn helper processes; terminate direct children
            // as well so a stopped request cannot keep consuming provider tokens.
            let _ = std::process::Command::new("pkill")
                .args(["-TERM", "-P", &pid.to_string()])
                .status();
        }
    }
    if let Some(session) = ACTIVE_AGENT_SESSION
        .get()
        .and_then(|value| value.lock().ok().and_then(|mut id| id.take()))
    {
        writer_store::finish_agent_session(app, &session, "stopped", Some("user_or_new_request"));
    }
}

#[tauri::command]
fn stop_writer_agent(app: tauri::AppHandle) {
    stop_writer_agent_process(&app);
}

fn build_http_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("WhalePaper/0.1");

    #[cfg(target_os = "macos")]
    if !environment_proxy_configured() {
        if let Some(proxy_url) = macos_system_proxy() {
            let no_proxy = reqwest::NoProxy::from_string(
                "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
            );
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|error| error.to_string())?
                .no_proxy(no_proxy);
            builder = builder.proxy(proxy);
        }
    }

    builder.build().map_err(|error| error.to_string())
}

pub(crate) fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = build_http_client()?;
    let _ = CLIENT.set(client);
    CLIENT
        .get()
        .ok_or_else(|| "无法初始化网络客户端".to_string())
}

#[cfg(target_os = "macos")]
fn environment_proxy_configured() -> bool {
    [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ]
    .iter()
    .any(|name| std::env::var(name).is_ok_and(|value| !value.trim().is_empty()))
}

#[cfg(target_os = "macos")]
fn macos_system_proxy() -> Option<String> {
    let output = command_output_with_timeout(
        std::process::Command::new("/usr/sbin/scutil").arg("--proxy"),
        Duration::from_secs(2),
    )?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let values = text
        .lines()
        .filter_map(|line| line.trim().split_once(" : "))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect::<HashMap<_, _>>();

    for prefix in ["HTTPS", "HTTP"] {
        let enable_key = format!("{prefix}Enable");
        let proxy_key = format!("{prefix}Proxy");
        let port_key = format!("{prefix}Port");
        if values.get(enable_key.as_str()) != Some(&"1") {
            continue;
        }
        let host = values.get(proxy_key.as_str())?;
        let port = values.get(port_key.as_str())?;
        let scheme = if host.contains("://") { "" } else { "http://" };
        return Some(format!("{scheme}{host}:{port}"));
    }
    None
}

#[tauri::command]
async fn ai_http_request(request: AiHttpRequest) -> Result<AiHttpResponse, String> {
    if !request.url.starts_with("https://") && !request.url.starts_with("http://") {
        return Err("模型接口地址必须使用 HTTP 或 HTTPS".into());
    }

    let client = http_client()?;
    let method = request.method.as_deref().unwrap_or("POST").to_uppercase();
    let mut outbound = match method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url).timeout(Duration::from_secs(180)),
        _ => return Err("网络请求只支持 GET 或 POST".into()),
    };
    if let Some(body) = request.body {
        outbound = outbound.json(&body);
    }
    for (name, value) in request.headers {
        outbound = outbound.header(&name, &value);
    }
    #[cfg(debug_assertions)]
    eprintln!("[http] {method} {}", request.url);
    let response = outbound.send().await.map_err(|error| {
        #[cfg(debug_assertions)]
        eprintln!("[http] request failed: {error}");
        error.to_string()
    })?;
    let status = response.status().as_u16();
    #[cfg(debug_assertions)]
    eprintln!("[http] {status} {}", request.url);
    let headers = ["retry-after", "x-ratelimit-reset", "content-type"]
        .into_iter()
        .filter_map(|name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let body = response.text().await.map_err(|error| error.to_string())?;
    Ok(AiHttpResponse {
        status,
        body,
        headers,
    })
}

#[tauri::command]
async fn ai_http_binary_request(request: AiHttpRequest) -> Result<BinaryHttpResponse, String> {
    if !request.url.starts_with("https://") && !request.url.starts_with("http://") {
        return Err("模型接口地址必须使用 HTTP 或 HTTPS".into());
    }
    let client = http_client()?;
    let method = request.method.as_deref().unwrap_or("POST").to_uppercase();
    if method != "POST" {
        return Err("二进制网络请求只支持 POST".into());
    }
    let mut outbound = client.post(&request.url).timeout(Duration::from_secs(180));
    if let Some(body) = request.body {
        outbound = outbound.body(body.to_string());
    }
    for (name, value) in request.headers {
        outbound = outbound.header(&name, &value);
    }
    let response = outbound.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = base64::engine::general_purpose::STANDARD
        .encode(response.bytes().await.map_err(|error| error.to_string())?);
    Ok(BinaryHttpResponse {
        status,
        body,
        content_type,
    })
}

#[tauri::command]
async fn download_pdf(url: String) -> Result<tauri::ipc::Response, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("PDF 地址无效: {error}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("PDF 地址必须使用 HTTP 或 HTTPS".into());
    }

    let response = http_client()?
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/pdf")
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|error| format!("无法下载 PDF: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("无法下载 PDF（{}）", status.as_u16()));
    }

    const MAX_PDF_BYTES: u64 = 150 * 1024 * 1024;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PDF_BYTES)
    {
        return Err("PDF 超过 150 MB，无法直接打开".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("无法读取 PDF: {error}"))?;
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err("PDF 超过 150 MB，无法直接打开".into());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("该地址没有返回有效的 PDF 文件".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("资源链接无效: {error}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("只能打开 HTTP 或 HTTPS 资源链接".into());
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| format!("无法打开系统浏览器: {error}"))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Recover sessions left behind by a crash or forced quit before
            // the next window can start another Runtime.
            writer_store::cleanup_running_agent_sessions(app.handle());
            dream_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai_http_request,
            ai_http_binary_request,
            agent_runtime_status,
            agent_model_list,
            run_writer_agent,
            stop_writer_agent,
            download_pdf,
            open_external_url,
            layout_detection::detect_pdf_layout,
            quit_app,
            writer::get_latex_runtime_status,
            writer::install_managed_latex_runtime,
            writer::uninstall_managed_latex_runtime,
            writer::resolve_writer_file,
            writer::open_writer_project,
            writer::read_writer_file,
            writer::write_writer_file,
            writer::compile_writer_project,
            writer::read_writer_pdf,
            writer::writer_synctex_edit,
            writer::writer_synctex_view,
            writer_store::list_writer_library,
            writer_store::remove_writer_library_project,
            writer_store::create_writer_version,
            writer_store::list_writer_versions,
            writer_store::get_writer_version,
            writer_store::restore_writer_version,
            writer_store::list_writer_threads,
            writer_store::create_writer_thread,
            writer_store::add_writer_thread_message,
            writer_store::update_writer_thread_message,
            writer_store::set_writer_thread_resolved,
            writer_store::delete_writer_thread,
            writer_store::save_writer_revision,
            writer_store::apply_writer_revision,
            writer_store::list_writer_revisions,
            writer_store::set_writer_revision_status,
            writer_store::save_agent_message,
            writer_store::list_agent_messages,
            writer_store::save_agent_handoff,
            writer_store::save_user_memory,
            writer_store::list_user_memories,
            reader_store::load_reader_state,
            reader_store::save_reader_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building WhalePaper")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_writer_agent_process(app_handle);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_chatgpt_codex_bundle_before_path_candidates() {
        let candidates = executable_candidates("codex");
        assert_eq!(
            candidates.first().map(PathBuf::as_path),
            Some(Path::new(
                "/Applications/ChatGPT.app/Contents/Resources/codex"
            ))
        );
        assert_eq!(
            candidates.get(1).map(PathBuf::as_path),
            Some(Path::new(
                "/Applications/Codex.app/Contents/Resources/codex"
            ))
        );
    }

    #[test]
    fn command_output_with_timeout_returns_output_of_fast_command() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("printf hello");
        let output = command_output_with_timeout(&mut command, Duration::from_secs(5))
            .expect("fast command should finish within the timeout");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "hello");
    }

    #[test]
    fn command_output_with_timeout_kills_a_hung_child() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("sleep 30");
        let started = std::time::Instant::now();
        let output = command_output_with_timeout(&mut command, Duration::from_millis(300));
        let elapsed = started.elapsed();
        assert!(output.is_none(), "a timed-out probe must report no output");
        assert!(
            elapsed < Duration::from_secs(5),
            "the helper must return promptly instead of waiting for the child, took {elapsed:?}"
        );
    }

    #[test]
    fn command_output_with_timeout_does_not_deadlock_on_large_piped_output() {
        // More than a pipe buffer held in both stdout and stderr: if the pipes
        // were drained only after the child exits, this would block forever.
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(
            "head -c 200000 /dev/zero | tr '\\0' 'a'; head -c 200000 /dev/zero | tr '\\0' 'b' 1>&2",
        );
        let output = command_output_with_timeout(&mut command, Duration::from_secs(10))
            .expect("a command with large piped output must not deadlock");
        assert_eq!(output.stdout.len(), 200000);
        assert_eq!(output.stderr.len(), 200000);
    }

    #[test]
    fn a_hanging_configured_cli_is_rejected_within_the_probe_timeout() {
        // Reproduces the original freeze shape: a `claude` binary that blocks
        // forever. `resolve_agent_binary` screens the configured path with
        // `probe_version`, which is where the hang used to strand the caller.
        //
        // The decisive property is that the screen gives up at
        // AGENT_PROBE_TIMEOUT instead of waiting on the child forever; that is
        // what keeps `agent_runtime_status` from freezing its thread. Whether a
        // working CLI also exists on PATH is a separate concern and is not what
        // this test pins down.
        let dir = std::env::temp_dir().join(format!("whalepaper-probe-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let hang = dir.join("claude");
        fs::write(&hang, "#!/bin/sh\nsleep 60\n").expect("write fake claude");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hang, fs::Permissions::from_mode(0o755)).expect("chmod");
        }

        let started = std::time::Instant::now();
        let version = probe_version(&hang);
        let elapsed = started.elapsed();

        assert!(
            version.is_none(),
            "a CLI that only hangs reports no version"
        );
        assert!(
            elapsed < AGENT_PROBE_TIMEOUT + Duration::from_secs(15),
            "screening a hung CLI must stop at the timeout, took {elapsed:?}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn blocking_work_runs_off_the_calling_thread() {
        // The freeze came from blocking work executing on the caller. This
        // pins the structural fix: `spawn_blocking` hands the closure to a
        // pool thread, so the future can make progress while it runs. We use
        // the same construction `agent_runtime_status` relies on.
        use std::sync::mpsc;

        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let watcher = std::thread::spawn(move || {
            // The pool thread parks until this test releases it.
            tauri::async_runtime::block_on(async move {
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = started_tx.send(());
                    let _ = release_rx.recv();
                    "probe done"
                })
                .await
                .expect("blocking task should join")
            })
        });

        // If the work really moved off the calling thread, it starts even
        // though this test thread has not run anything yet.
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("blocking work must start on the pool without the caller driving it");

        let _ = release_tx.send(());
        assert_eq!(watcher.join().expect("watcher thread"), "probe done");
    }

    #[test]
    fn prefers_structured_codex_turn_error_over_plugin_warnings() {
        let stdout = r#"
{"type":"turn.started"}
{"type":"error","message":"unexpected status 401 Unauthorized"}
{"type":"turn.failed","error":{"message":"provider authentication failed"}}
"#;
        assert_eq!(
            structured_agent_error(stdout).as_deref(),
            Some("provider authentication failed")
        );
    }

    #[test]
    fn reads_claude_result_error() {
        let stdout = r#"{"type":"result","subtype":"error_during_execution","errors":["request timed out"]}"#;
        assert_eq!(
            structured_agent_error(stdout).as_deref(),
            Some("request timed out")
        );
    }

    #[test]
    fn reads_claude_is_error_result_even_with_success_subtype() {
        let stdout = r#"{"type":"result","subtype":"success","is_error":true,"error_message":"provider rejected the request","result":"generic failure"}"#;
        assert_eq!(
            structured_agent_error(stdout).as_deref(),
            Some("provider rejected the request")
        );
    }

    #[test]
    fn reads_nested_runtime_error_messages() {
        let stdout = r#"{"type":"error","error":{"message":"upstream returned 401"}}"#;
        assert_eq!(
            structured_agent_error(stdout).as_deref(),
            Some("upstream returned 401")
        );
    }

    #[test]
    fn ignores_transient_codex_error_when_turn_completes() {
        let stdout = r#"
{"type":"error","message":"temporary disconnect; retrying"}
{"type":"turn.completed","usage":{"output_tokens":1}}
"#;
        assert_eq!(structured_terminal_agent_error(stdout), None);
        assert_eq!(
            structured_agent_error(stdout).as_deref(),
            Some("temporary disconnect; retrying")
        );
    }

    #[test]
    fn removes_known_non_fatal_codex_diagnostics() {
        let stderr = "Reading additional input from stdin...\n2026 WARN remote installed plugin bundle sync failed\n2026 WARN codex_skills::interface: ignoring interface.icon_small\n2026 WARN codex_rollout::list: state db discrepancy\nreal provider error";
        assert_eq!(filtered_agent_stderr(stderr), "real provider error");
    }

    #[test]
    fn truncates_stderr_from_the_tail() {
        let value = format!("{}actual error", "x".repeat(1200));
        assert_eq!(tail_chars(&value, 12), "actual error");
    }

    #[test]
    #[ignore = "requires the live Moonlight metadata service"]
    fn moonlight_metadata_is_reachable_with_the_desktop_client() {
        tauri::async_runtime::block_on(async {
            let response = build_http_client()
                .expect("desktop HTTP client should initialize")
                .get("https://api.themoonlight.io/api/scholar/anonymous/search-with-ref?query=Solar%20Open%202%20Technical%20Report")
                .send()
                .await
                .expect("Moonlight request should complete");

            assert!(
                response.status().is_success(),
                "status was {}",
                response.status()
            );
            let payload = response
                .json::<serde_json::Value>()
                .await
                .expect("Moonlight response should be JSON");
            assert_eq!(
                payload["semanticScholarPaper"]["title"],
                "Solar Open 2 Technical Report"
            );
        });
    }
}
