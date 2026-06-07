use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub asr_provider: String,
    pub asr_api_key: String,
    pub llm_provider: String,
    pub llm_api_key: String,
    pub subtitle_mode: String,
    pub min_dwell_ms: i64,
    pub max_dwell_ms: i64,
    pub max_queue: i64,
    pub save_history: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleConfig {
    subtitle_mode: String,
    min_dwell_ms: i64,
    max_dwell_ms: i64,
    max_queue: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            asr_provider: "zhipu_glm_asr".to_string(),
            asr_api_key: String::new(),
            llm_provider: "deepseek_v4_flash".to_string(),
            llm_api_key: String::new(),
            subtitle_mode: "bilingual".to_string(),
            min_dwell_ms: 1800,
            max_dwell_ms: 4200,
            max_queue: 5,
            save_history: true,
        }
    }
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let conn = connect(app)?;
    migrate(&conn)?;
    Ok(())
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
pub fn save_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    validate_config(&config)?;
    let conn = connect(&app)?;
    migrate(&conn)?;
    conn.execute(
        "INSERT INTO app_config (
            id,
            asr_provider,
            asr_api_key,
            llm_provider,
            llm_api_key,
            subtitle_mode,
            min_dwell_ms,
            max_dwell_ms,
            max_queue,
            save_history,
            updated_at
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            asr_provider = excluded.asr_provider,
            asr_api_key = excluded.asr_api_key,
            llm_provider = excluded.llm_provider,
            llm_api_key = excluded.llm_api_key,
            subtitle_mode = excluded.subtitle_mode,
            min_dwell_ms = excluded.min_dwell_ms,
            max_dwell_ms = excluded.max_dwell_ms,
            max_queue = excluded.max_queue,
            save_history = excluded.save_history,
            updated_at = CURRENT_TIMESTAMP",
        params![
            config.asr_provider,
            config.asr_api_key,
            config.llm_provider,
            config.llm_api_key,
            config.subtitle_mode,
            config.min_dwell_ms,
            config.max_dwell_ms,
            config.max_queue,
            if config.save_history { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("保存配置失败: {e}"))?;
    let saved = load_config(&app)?;
    emit_subtitle_config(&app, &saved);
    Ok(saved)
}

pub fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let conn = connect(app)?;
    migrate(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT
                asr_provider,
                asr_api_key,
                llm_provider,
                llm_api_key,
                subtitle_mode,
                min_dwell_ms,
                max_dwell_ms,
                max_queue,
                save_history
            FROM app_config
            WHERE id = 1",
        )
        .map_err(|e| format!("读取配置失败: {e}"))?;
    stmt.query_row([], |row| {
        Ok(AppConfig {
            asr_provider: row.get(0)?,
            asr_api_key: row.get(1)?,
            llm_provider: row.get(2)?,
            llm_api_key: row.get(3)?,
            subtitle_mode: row.get(4)?,
            min_dwell_ms: row.get(5)?,
            max_dwell_ms: row.get(6)?,
            max_queue: row.get(7)?,
            save_history: row.get::<_, i64>(8)? != 0,
        })
    })
    .map_err(|e| format!("读取配置失败: {e}"))
}

fn connect(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据目录失败: {e}"))?;
    }
    Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?
        .join("lumen.db"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            asr_provider TEXT NOT NULL DEFAULT 'zhipu_glm_asr',
            asr_api_key TEXT NOT NULL DEFAULT '',
            llm_provider TEXT NOT NULL DEFAULT 'deepseek_v4_flash',
            llm_api_key TEXT NOT NULL DEFAULT '',
            subtitle_mode TEXT NOT NULL DEFAULT 'bilingual',
            min_dwell_ms INTEGER NOT NULL DEFAULT 1800,
            max_dwell_ms INTEGER NOT NULL DEFAULT 4200,
            max_queue INTEGER NOT NULL DEFAULT 5,
            save_history INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO app_config (id) VALUES (1);",
    )
    .map_err(|e| format!("初始化数据库失败: {e}"))?;
    Ok(())
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    if config.asr_provider.trim().is_empty() {
        return Err("ASR provider 不能为空".to_string());
    }
    if config.llm_provider.trim().is_empty() {
        return Err("LLM provider 不能为空".to_string());
    }
    if config.min_dwell_ms < 500 || config.max_dwell_ms < config.min_dwell_ms {
        return Err("字幕停留时间配置无效".to_string());
    }
    if config.max_queue < 1 || config.max_queue > 20 {
        return Err("字幕队列长度需在 1 到 20 之间".to_string());
    }
    Ok(())
}

fn emit_subtitle_config(app: &AppHandle, config: &AppConfig) {
    let _ = app.emit_to(
        "subtitle",
        "subtitle_config",
        SubtitleConfig {
            subtitle_mode: config.subtitle_mode.clone(),
            min_dwell_ms: config.min_dwell_ms,
            max_dwell_ms: config.max_dwell_ms,
            max_queue: config.max_queue,
        },
    );
}
