use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::HashMap, fs};
use tauri::{AppHandle, Manager};

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let connection =
        Connection::open(directory.join("reader.sqlite3")).map_err(|error| error.to_string())?;
    connection.execute_batch("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS reader_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));").map_err(|error| error.to_string())?;
    Ok(connection)
}

#[derive(Serialize)]
pub struct ReaderState {
    #[serde(flatten)]
    values: HashMap<String, String>,
}

#[tauri::command]
pub fn load_reader_state(app: AppHandle) -> Result<ReaderState, String> {
    let connection = connection(&app)?;
    let mut statement = connection
        .prepare("SELECT key, value FROM reader_state")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut values = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|error| error.to_string())?;
        values.insert(key, value);
    }
    Ok(ReaderState { values })
}

#[tauri::command]
pub fn save_reader_state(app: AppHandle, state: HashMap<String, String>) -> Result<(), String> {
    let mut connection = connection(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (key, value) in state {
        transaction.execute("INSERT INTO reader_state (key, value, updated_at) VALUES (?1, ?2, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params![key, value]).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}
