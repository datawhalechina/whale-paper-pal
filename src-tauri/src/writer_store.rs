use crate::writer::{
    canonical_root, checked_relative_path, checked_relative_path_for_write, related_project_files,
};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path, time::SystemTime};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterLibraryProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub main_file: Option<String>,
    pub created_at: i64,
    pub last_opened_at: i64,
    pub version_count: i64,
    pub open_thread_count: i64,
    pub pending_revision_count: i64,
    pub path_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterVersion {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub note: String,
    pub created_at: i64,
    pub file_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterVersionDetail {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub note: String,
    pub created_at: i64,
    pub files: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterThreadMessage {
    pub id: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterThread {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub from_offset: i64,
    pub to_offset: i64,
    pub quoted_text: String,
    pub resolved: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<WriterThreadMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterRevision {
    pub id: String,
    pub project_id: String,
    pub file_path: String,
    pub before_content: String,
    pub after_content: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVersionRequest {
    root_path: String,
    main_file: String,
    label: String,
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadRequest {
    id: String,
    project_id: String,
    file_path: String,
    from_offset: i64,
    to_offset: i64,
    quoted_text: String,
    message_id: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddThreadMessageRequest {
    id: String,
    thread_id: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRevisionRequest {
    id: String,
    project_id: String,
    file_path: String,
    before_content: String,
    after_content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRevisionRequest {
    revision_id: String,
    status: String,
}

fn timestamp() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

const BINARY_SNAPSHOT_PREFIX: &str = "__WHALEPAPER_BINARY_BASE64__:";
const MAX_VERSION_COUNT: i64 = 50;
const MAX_SETTLED_REVISION_COUNT: i64 = 500;

fn encode_snapshot_file(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(content) => content,
        Err(_) => format!(
            "{}{}",
            BINARY_SNAPSHOT_PREFIX,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
    }
}

fn decode_snapshot_file(content: &str) -> Result<Vec<u8>, String> {
    if let Some(encoded) = content.strip_prefix(BINARY_SNAPSHOT_PREFIX) {
        return base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("历史版本中的二进制文件损坏：{error}"));
    }
    Ok(content.as_bytes().to_vec())
}

#[derive(Serialize, Deserialize)]
struct VersionSnapshot {
    format: u8,
    files: BTreeMap<String, String>,
}

fn parse_version_snapshot(value: &str) -> Result<(BTreeMap<String, String>, bool), String> {
    let raw =
        serde_json::from_str::<serde_json::Value>(value).map_err(|error| error.to_string())?;
    if raw.get("format").is_some() && raw.get("files").is_some() {
        let snapshot = serde_json::from_value::<VersionSnapshot>(raw)
            .map_err(|error| format!("历史版本格式无效：{error}"))?;
        return Ok((snapshot.files, snapshot.format >= 2));
    }
    // Versions created before the complete snapshot format contain the file
    // map directly. They remain restorable, but must not trigger deletion of
    // assets that were never captured by the old implementation.
    Ok((
        serde_json::from_value(raw).map_err(|error| error.to_string())?,
        false,
    ))
}

pub(crate) fn project_id(root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())[..24].to_string()
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(directory.join("writer.sqlite3")).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS writer_projects (
               id TEXT PRIMARY KEY, root_path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
               main_file TEXT, created_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL,
               archived INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS writer_versions (
               id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writer_projects(id) ON DELETE CASCADE,
               label TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
               files_json TEXT NOT NULL, file_count INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS writer_versions_project_idx ON writer_versions(project_id, created_at DESC);
             CREATE TABLE IF NOT EXISTS writer_threads (
               id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writer_projects(id) ON DELETE CASCADE,
               file_path TEXT NOT NULL, from_offset INTEGER NOT NULL, to_offset INTEGER NOT NULL,
               quoted_text TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS writer_threads_project_idx ON writer_threads(project_id, updated_at DESC);
             CREATE TABLE IF NOT EXISTS writer_thread_messages (
               id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES writer_threads(id) ON DELETE CASCADE,
               body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS writer_revisions (
               id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writer_projects(id) ON DELETE CASCADE,
               file_path TEXT NOT NULL, before_content TEXT NOT NULL, after_content TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS writer_revisions_project_idx ON writer_revisions(project_id, updated_at DESC);
             CREATE TABLE IF NOT EXISTS agent_sessions (
               id TEXT PRIMARY KEY, project_id TEXT, root_path TEXT NOT NULL,
               runtime TEXT NOT NULL, model TEXT, process_id INTEGER,
               status TEXT NOT NULL, started_at INTEGER NOT NULL,
               finished_at INTEGER, stop_reason TEXT
             );
             CREATE INDEX IF NOT EXISTS agent_sessions_project_idx ON agent_sessions(project_id, started_at DESC);
             CREATE TABLE IF NOT EXISTS agent_messages (
               id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
               role TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS agent_messages_session_idx ON agent_messages(session_id, created_at);
             CREATE TABLE IF NOT EXISTS agent_handoffs (
               id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
               from_runtime TEXT NOT NULL, to_runtime TEXT NOT NULL,
               summary TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS agent_handoffs_session_idx ON agent_handoffs(session_id, created_at);
             CREATE TABLE IF NOT EXISTS user_memories (
               id TEXT PRIMARY KEY, memory_type TEXT NOT NULL, title TEXT NOT NULL,
               content TEXT NOT NULL, source TEXT, confidence REAL NOT NULL DEFAULT 1,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS user_memories_type_idx ON user_memories(memory_type, updated_at DESC);
             CREATE TABLE IF NOT EXISTS agent_dream_state (
               id INTEGER PRIMARY KEY CHECK (id = 1), last_run_at INTEGER NOT NULL DEFAULT 0
             );
             INSERT OR IGNORE INTO agent_dream_state (id, last_run_at) VALUES (1, 0);",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

pub(crate) fn start_agent_session(
    app: &AppHandle,
    id: &str,
    root: &Path,
    runtime: &str,
    model: Option<&str>,
    process_id: i64,
) -> Result<(), String> {
    connection(app)?.execute(
        "INSERT INTO agent_sessions (id, project_id, root_path, runtime, model, process_id, status, started_at, finished_at, stop_reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, NULL, NULL) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, root_path = excluded.root_path, runtime = excluded.runtime, model = excluded.model, process_id = excluded.process_id, status = 'running', started_at = excluded.started_at, finished_at = NULL, stop_reason = NULL",
        params![id, project_id(root), root.to_string_lossy(), runtime, model, process_id, timestamp()],
    ).map(|_| ()).map_err(|error| error.to_string())
}

pub(crate) fn finish_agent_session(app: &AppHandle, id: &str, status: &str, reason: Option<&str>) {
    if let Ok(db) = connection(app) {
        let _ = db.execute(
            "UPDATE agent_sessions SET status = ?2, finished_at = ?3, stop_reason = ?4 WHERE id = ?1 AND status = 'running'",
            params![id, status, timestamp(), reason],
        );
    }
}

pub(crate) fn cleanup_running_agent_sessions(app: &AppHandle) {
    let Ok(db) = connection(app) else {
        return;
    };
    let mut statement =
        match db.prepare("SELECT id, process_id FROM agent_sessions WHERE status = 'running'") {
            Ok(value) => value,
            Err(_) => return,
        };
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
    });
    let Ok(rows) = rows else {
        return;
    };
    for row in rows.flatten() {
        if let Some(pid) = row.1.filter(|value| *value > 0) {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
            let _ = std::process::Command::new("pkill")
                .args(["-TERM", "-P", &pid.to_string()])
                .status();
        }
        let _ = db.execute(
            "UPDATE agent_sessions SET status = 'stopped', finished_at = ?2, stop_reason = 'application_restart' WHERE id = ?1 AND status = 'running'",
            params![row.0, timestamp()],
        );
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentMessageRequest {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRecord {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn save_agent_message(app: AppHandle, request: SaveAgentMessageRequest) -> Result<(), String> {
    connection(&app)?.execute(
        "INSERT OR REPLACE INTO agent_messages (id, session_id, role, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![request.id, request.session_id, request.role, request.body, timestamp()],
    ).map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_agent_messages(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<AgentMessageRecord>, String> {
    let db = connection(&app)?;
    let mut statement = db.prepare("SELECT id, role, body, created_at FROM agent_messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(AgentMessageRecord {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveUserMemoryRequest {
    pub id: String,
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub source: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoryRecord {
    pub id: String,
    pub memory_type: String,
    pub title: String,
    pub content: String,
    pub confidence: f64,
    pub updated_at: i64,
}

#[tauri::command]
pub fn save_user_memory(app: AppHandle, request: SaveUserMemoryRequest) -> Result<(), String> {
    connection(&app)?.execute(
        "INSERT INTO user_memories (id, memory_type, title, content, source, confidence, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6) ON CONFLICT(id) DO UPDATE SET memory_type = excluded.memory_type, title = excluded.title, content = excluded.content, source = excluded.source, updated_at = excluded.updated_at",
        params![request.id, request.memory_type, request.title, request.content, request.source, timestamp()],
    ).map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_user_memories(app: AppHandle) -> Result<Vec<UserMemoryRecord>, String> {
    let db = connection(&app)?;
    let mut statement = db.prepare("SELECT id, memory_type, title, content, confidence, updated_at FROM user_memories ORDER BY updated_at DESC LIMIT 100")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(UserMemoryRecord {
                id: row.get(0)?,
                memory_type: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                confidence: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn dream_context(app: &AppHandle) -> Option<String> {
    let db = connection(app).ok()?;
    let last_run: i64 = db
        .query_row(
            "SELECT last_run_at FROM agent_dream_state WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .ok()?;
    let completed: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE status = 'completed' AND finished_at > ?1",
            params![last_run],
            |row| row.get(0),
        )
        .ok()?;
    if completed < 5 || timestamp() - last_run < 86_400_000 {
        return None;
    }
    let mut statement = db.prepare("SELECT m.role, m.body FROM agent_messages m JOIN agent_sessions s ON s.id = m.session_id WHERE s.status = 'completed' AND m.created_at > ?1 ORDER BY m.created_at ASC LIMIT 80").ok()?;
    let rows = statement
        .query_map(params![last_run], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()?;
    let mut text = String::new();
    for row in rows.flatten() {
        let line = format!("{}: {}\n", row.0, row.1);
        if text.len() + line.len() > 100_000 {
            break;
        }
        text.push_str(&line);
    }
    (!text.is_empty()).then_some(text)
}

pub(crate) fn mark_dream_run(app: &AppHandle) {
    if let Ok(db) = connection(app) {
        let _ = db.execute(
            "UPDATE agent_dream_state SET last_run_at = ?1 WHERE id = 1",
            params![timestamp()],
        );
    }
}

pub(crate) fn dream_target(app: &AppHandle) -> Option<(String, String, Option<String>, String)> {
    let db = connection(app).ok()?;
    let row = db.query_row("SELECT root_path, runtime, model FROM agent_sessions WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1", [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))).ok()?;
    let context = dream_context(app)?;
    Some((row.0, row.1, row.2, context))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentHandoffRequest {
    pub id: String,
    pub session_id: String,
    pub from_runtime: String,
    pub to_runtime: String,
    pub summary: String,
}

#[tauri::command]
pub fn save_agent_handoff(app: AppHandle, request: SaveAgentHandoffRequest) -> Result<(), String> {
    connection(&app)?.execute(
        "INSERT OR REPLACE INTO agent_handoffs (id, session_id, from_runtime, to_runtime, summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![request.id, request.session_id, request.from_runtime, request.to_runtime, request.summary, timestamp()],
    ).map(|_| ()).map_err(|error| error.to_string())
}

pub(crate) fn remember_project(
    app: &AppHandle,
    root: &Path,
    name: &str,
    main_file: Option<&str>,
) -> Result<String, String> {
    let id = project_id(root);
    let now = timestamp();
    connection(app)?
        .execute(
            "INSERT INTO writer_projects (id, root_path, name, main_file, created_at, last_opened_at, archived)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, main_file = excluded.main_file,
               last_opened_at = excluded.last_opened_at, archived = 0",
            params![id, root.to_string_lossy(), name, main_file, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn list_writer_library(app: AppHandle) -> Result<Vec<WriterLibraryProject>, String> {
    let connection = connection(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT p.id, p.name, p.root_path, p.main_file, p.created_at, p.last_opened_at,
              (SELECT COUNT(*) FROM writer_versions v WHERE v.project_id = p.id),
              (SELECT COUNT(*) FROM writer_threads t WHERE t.project_id = p.id AND t.resolved = 0),
              (SELECT COUNT(*) FROM writer_revisions r WHERE r.project_id = p.id AND r.status = 'pending')
             FROM writer_projects p WHERE p.archived = 0 ORDER BY p.last_opened_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let root_path: String = row.get(2)?;
            Ok(WriterLibraryProject {
                id: row.get(0)?,
                name: row.get(1)?,
                path_available: Path::new(&root_path).is_dir(),
                root_path,
                main_file: row.get(3)?,
                created_at: row.get(4)?,
                last_opened_at: row.get(5)?,
                version_count: row.get(6)?,
                open_thread_count: row.get(7)?,
                pending_revision_count: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_writer_library_project(app: AppHandle, project_id: String) -> Result<(), String> {
    connection(&app)?
        .execute(
            "UPDATE writer_projects SET archived = 1 WHERE id = ?1",
            params![project_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_writer_version(
    app: AppHandle,
    request: CreateVersionRequest,
) -> Result<WriterVersion, String> {
    let root = canonical_root(&request.root_path)?;
    let id = project_id(&root);
    // Keep every discovered dependency, including graphics and other binary
    // assets, so a version can restore the project state it represents.
    let files = related_project_files(&root, &request.main_file)?
        .into_iter()
        .map(|(path, bytes)| (path, encode_snapshot_file(&bytes)))
        .collect::<BTreeMap<_, _>>();
    let file_count = files.len() as i64;
    let version_id = format!("version-{}-{}", timestamp(), id);
    let created_at = timestamp();
    let label = request.label.trim().to_string();
    let note = request.note.unwrap_or_default().trim().to_string();
    let files_json = serde_json::to_string(&VersionSnapshot { format: 2, files })
        .map_err(|error| error.to_string())?;
    connection(&app)?.execute(
        "INSERT INTO writer_versions (id, project_id, label, note, created_at, files_json, file_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![version_id, id, label, note, created_at, files_json, file_count],
    ).map_err(|error| error.to_string())?;
    connection(&app)?
        .execute(
            "DELETE FROM writer_versions WHERE project_id = ?1 AND id NOT IN
         (SELECT id FROM writer_versions WHERE project_id = ?1 ORDER BY created_at DESC LIMIT ?2)",
            params![id, MAX_VERSION_COUNT],
        )
        .map_err(|error| error.to_string())?;
    Ok(WriterVersion {
        id: version_id,
        project_id: id,
        label,
        note,
        created_at,
        file_count,
    })
}

#[tauri::command]
pub fn list_writer_versions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<WriterVersion>, String> {
    let connection = connection(&app)?;
    let mut statement = connection.prepare("SELECT id, project_id, label, note, created_at, file_count FROM writer_versions WHERE project_id = ?1 ORDER BY created_at DESC").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok(WriterVersion {
                id: row.get(0)?,
                project_id: row.get(1)?,
                label: row.get(2)?,
                note: row.get(3)?,
                created_at: row.get(4)?,
                file_count: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_writer_version(
    app: AppHandle,
    version_id: String,
) -> Result<WriterVersionDetail, String> {
    let connection = connection(&app)?;
    let row = connection.query_row(
        "SELECT id, project_id, label, note, created_at, files_json FROM writer_versions WHERE id = ?1", params![version_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get::<_, String>(5)?)),
    ).optional().map_err(|error| error.to_string())?.ok_or_else(|| "找不到这个历史版本。".to_string())?;
    Ok(WriterVersionDetail {
        id: row.0,
        project_id: row.1,
        label: row.2,
        note: row.3,
        created_at: row.4,
        files: parse_version_snapshot(&row.5)?.0,
    })
}

#[tauri::command]
pub fn restore_writer_version(app: AppHandle, version_id: String) -> Result<(), String> {
    let connection = connection(&app)?;
    let (project_id, root_path, main_file, files_json): (String, String, Option<String>, String) = connection.query_row(
        "SELECT v.project_id, p.root_path, p.main_file, v.files_json FROM writer_versions v JOIN writer_projects p ON p.id = v.project_id WHERE v.id = ?1",
        params![version_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(|error| error.to_string())?.ok_or_else(|| "找不到这个历史版本。".to_string())?;
    let root = canonical_root(&root_path)?;
    let (files, complete_snapshot) = parse_version_snapshot(&files_json)?;
    let decoded = files
        .iter()
        .map(|(relative, content)| {
            decode_snapshot_file(content).map(|bytes| (relative.clone(), bytes))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let snapshot_paths = decoded
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();

    // Discover the current dependency set so files added after this version
    // can be removed as part of a true project restore. If the current main
    // file is itself missing, skip deletion but still recreate snapshot files.
    let current_paths = if complete_snapshot {
        main_file
            .as_deref()
            .and_then(|main| related_project_files(&root, main).ok())
            .map(|files| files.into_keys().collect::<std::collections::BTreeSet<_>>())
            .unwrap_or_default()
    } else {
        std::collections::BTreeSet::new()
    };
    let mut affected = snapshot_paths.clone();
    affected.extend(current_paths.difference(&snapshot_paths).cloned());
    let mut backups = Vec::with_capacity(affected.len());
    for relative in &affected {
        let path = checked_relative_path_for_write(&root, relative)?;
        let previous = if path.is_file() {
            Some(
                fs::read(&path)
                    .map_err(|error| format!("无法读取恢复前文件 {relative}：{error}"))?,
            )
        } else if path.exists() {
            return Err(format!("项目路径不是文件：{relative}"));
        } else {
            None
        };
        backups.push((path, previous));
    }

    let write_result = (|| -> Result<(), String> {
        for (relative, content) in &decoded {
            let path = checked_relative_path_for_write(&root, relative)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建恢复目录 {relative}：{error}"))?;
            }
            fs::write(&path, content).map_err(|error| format!("无法恢复 {relative}：{error}"))?;
        }
        for relative in current_paths.difference(&snapshot_paths) {
            let path = checked_relative_path(&root, relative)?;
            fs::remove_file(&path)
                .map_err(|error| format!("无法移除版本之后新增的文件 {relative}：{error}"))?;
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        rollback_files(&backups);
        return Err(error);
    }

    // A restore invalidates pending diffs because their bases no longer
    // describe the current document state.
    if let Err(error) = connection.execute(
        "UPDATE writer_revisions SET status = 'rejected', updated_at = ?2 WHERE project_id = ?1 AND status = 'pending'",
        params![project_id, timestamp()],
    ) {
        rollback_files(&backups);
        return Err(format!("历史版本已写入，但无法更新修订状态：{error}"));
    }
    Ok(())
}

fn rollback_files(backups: &[(std::path::PathBuf, Option<Vec<u8>>)]) {
    for (path, previous) in backups.iter().rev() {
        match previous {
            Some(bytes) => {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(path, bytes);
            }
            None => {
                if path.is_file() {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
}

fn load_messages(
    connection: &Connection,
    thread_id: &str,
) -> Result<Vec<WriterThreadMessage>, String> {
    let mut statement = connection.prepare("SELECT id, body, created_at, updated_at FROM writer_thread_messages WHERE thread_id = ?1 ORDER BY created_at").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![thread_id], |row| {
            Ok(WriterThreadMessage {
                id: row.get(0)?,
                body: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_writer_threads(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<WriterThread>, String> {
    let connection = connection(&app)?;
    let mut statement = connection.prepare("SELECT id, project_id, file_path, from_offset, to_offset, quoted_text, resolved, created_at, updated_at FROM writer_threads WHERE project_id = ?1 ORDER BY resolved, updated_at DESC").map_err(|error| error.to_string())?;
    let base = statement
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    base.into_iter()
        .map(|row| {
            Ok(WriterThread {
                id: row.0.clone(),
                project_id: row.1,
                file_path: row.2,
                from_offset: row.3,
                to_offset: row.4,
                quoted_text: row.5,
                resolved: row.6,
                created_at: row.7,
                updated_at: row.8,
                messages: load_messages(&connection, &row.0)?,
            })
        })
        .collect()
}

#[tauri::command]
pub fn create_writer_thread(app: AppHandle, request: CreateThreadRequest) -> Result<(), String> {
    if request.body.trim().is_empty() || request.to_offset <= request.from_offset {
        return Err("评论内容和文本选区不能为空。".into());
    }
    let now = timestamp();
    let mut connection = connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO writer_threads (id, project_id, file_path, from_offset, to_offset, quoted_text, resolved, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7)", params![request.id, request.project_id, request.file_path, request.from_offset, request.to_offset, request.quoted_text, now]).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO writer_thread_messages (id, thread_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![request.message_id, request.id, request.body.trim(), now]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_writer_thread_message(
    app: AppHandle,
    request: AddThreadMessageRequest,
) -> Result<(), String> {
    if request.body.trim().is_empty() {
        return Err("回复内容不能为空。".into());
    }
    let now = timestamp();
    let mut connection = connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO writer_thread_messages (id, thread_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![request.id, request.thread_id, request.body.trim(), now]).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE writer_threads SET updated_at = ?2 WHERE id = ?1",
            params![request.thread_id, now],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_writer_thread_message(
    app: AppHandle,
    message_id: String,
    body: String,
) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("评论内容不能为空。".into());
    }
    connection(&app)?
        .execute(
            "UPDATE writer_thread_messages SET body = ?2, updated_at = ?3 WHERE id = ?1",
            params![message_id, body.trim(), timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_writer_thread_resolved(
    app: AppHandle,
    thread_id: String,
    resolved: bool,
) -> Result<(), String> {
    connection(&app)?
        .execute(
            "UPDATE writer_threads SET resolved = ?2, updated_at = ?3 WHERE id = ?1",
            params![thread_id, resolved, timestamp()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_writer_thread(app: AppHandle, thread_id: String) -> Result<(), String> {
    connection(&app)?
        .execute(
            "DELETE FROM writer_threads WHERE id = ?1",
            params![thread_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_writer_revision(app: AppHandle, request: SaveRevisionRequest) -> Result<(), String> {
    let now = timestamp();
    connection(&app)?.execute(
        "INSERT INTO writer_revisions (id, project_id, file_path, before_content, after_content, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET after_content = excluded.after_content, status = 'pending', updated_at = excluded.updated_at",
        params![request.id, request.project_id, request.file_path, request.before_content, request.after_content, now],
    ).map_err(|error| error.to_string())?;
    connection(&app)?.execute(
        "DELETE FROM writer_revisions WHERE project_id = ?1 AND status != 'pending' AND id NOT IN
         (SELECT id FROM writer_revisions WHERE project_id = ?1 AND status != 'pending' ORDER BY updated_at DESC LIMIT ?2)",
        params![request.project_id, MAX_SETTLED_REVISION_COUNT],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn apply_writer_revision(app: AppHandle, request: ApplyRevisionRequest) -> Result<(), String> {
    if request.status != "accepted" && request.status != "rejected" {
        return Err("无效的修订状态。".into());
    }
    let connection = connection(&app)?;
    let (project_id, root_path, file_path, before_content, after_content, current_status):
        (String, String, String, String, String, String) = connection
        .query_row(
            "SELECT r.project_id, p.root_path, r.file_path, r.before_content, r.after_content, r.status
             FROM writer_revisions r JOIN writer_projects p ON p.id = r.project_id WHERE r.id = ?1",
            params![request.revision_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "找不到这条修订。".to_string())?;
    if current_status != "pending" {
        return Err("这条修订已经处理过了。".into());
    }
    let root = canonical_root(&root_path)?;
    let path = checked_relative_path_for_write(&root, &file_path)?;
    if !path.is_file() {
        return Err(format!("文件已被删除，无法安全处理修订：{file_path}"));
    }
    let current = fs::read(&path).map_err(|error| format!("无法读取修订文件：{error}"))?;
    if current != after_content.as_bytes() {
        return Err(format!("文件已发生新的修改，未处理修订：{file_path}"));
    }
    let previous = current;
    let next_content = if request.status == "accepted" {
        after_content.into_bytes()
    } else {
        before_content.into_bytes()
    };
    fs::write(&path, &next_content).map_err(|error| format!("无法应用修订：{error}"))?;
    let updated = connection
        .execute(
            "UPDATE writer_revisions SET status = ?2, updated_at = ?3 WHERE id = ?1 AND project_id = ?4 AND status = 'pending'",
            params![request.revision_id, request.status, timestamp(), project_id],
        )
        .map_err(|error| {
            let _ = fs::write(&path, &previous);
            error.to_string()
        })?;
    if updated != 1 {
        let _ = fs::write(&path, &previous);
        return Err("修订状态已被其他操作更新，未应用本次操作。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn list_writer_revisions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<WriterRevision>, String> {
    let connection = connection(&app)?;
    let mut statement = connection.prepare("SELECT id, project_id, file_path, before_content, after_content, status, created_at, updated_at FROM writer_revisions WHERE project_id = ?1 ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok(WriterRevision {
                id: row.get(0)?,
                project_id: row.get(1)?,
                file_path: row.get(2)?,
                before_content: row.get(3)?,
                after_content: row.get(4)?,
                status: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_writer_revision_status(
    app: AppHandle,
    revision_id: String,
    status: String,
) -> Result<(), String> {
    // Keep the legacy command name, but route it through the same filesystem
    // and conflict checks as the current API so callers cannot create a
    // database-only status change.
    apply_writer_revision(
        app,
        ApplyRevisionRequest {
            revision_id,
            status,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        decode_snapshot_file, encode_snapshot_file, parse_version_snapshot, VersionSnapshot,
    };
    use std::collections::BTreeMap;

    #[test]
    fn complete_snapshot_round_trips_binary_and_text_files() {
        let binary = encode_snapshot_file(&[0, 159, 146, 150]);
        let text = encode_snapshot_file("\\section{摘要}".as_bytes());
        assert_eq!(
            decode_snapshot_file(&binary).unwrap(),
            vec![0, 159, 146, 150]
        );
        assert_eq!(
            decode_snapshot_file(&text).unwrap(),
            "\\section{摘要}".as_bytes()
        );
    }

    #[test]
    fn legacy_snapshot_is_read_without_complete_restore_flag() {
        let legacy = serde_json::json!({"main.tex": "old"}).to_string();
        let (files, complete) = parse_version_snapshot(&legacy).unwrap();
        assert_eq!(files.get("main.tex").map(String::as_str), Some("old"));
        assert!(!complete);
    }

    #[test]
    fn complete_snapshot_is_marked_for_new_file_cleanup() {
        let mut files = BTreeMap::new();
        files.insert("main.tex".to_string(), "new".to_string());
        let json = serde_json::to_string(&VersionSnapshot { format: 2, files }).unwrap();
        let (parsed, complete) = parse_version_snapshot(&json).unwrap();
        assert_eq!(parsed.get("main.tex").map(String::as_str), Some("new"));
        assert!(complete);
    }
}
