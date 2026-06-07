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
    pub source_language: String,
    pub target_language: String,
    pub subtitle_mode: String,
    pub min_dwell_ms: i64,
    pub max_dwell_ms: i64,
    pub max_queue: i64,
    pub subtitle_font_size: i64,
    pub subtitle_original_color: String,
    pub subtitle_translated_color: String,
    pub subtitle_background_color: String,
    pub subtitle_background_opacity: i64,
    pub save_history: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationHistoryItem {
    pub id: i64,
    pub original: String,
    pub translated: String,
    pub source_language: String,
    pub target_language: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleConfig {
    subtitle_mode: String,
    min_dwell_ms: i64,
    max_dwell_ms: i64,
    max_queue: i64,
    subtitle_font_size: i64,
    subtitle_original_color: String,
    subtitle_translated_color: String,
    subtitle_background_color: String,
    subtitle_background_opacity: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            asr_provider: "zhipu_glm_asr".to_string(),
            asr_api_key: String::new(),
            llm_provider: "deepseek_v4_flash".to_string(),
            llm_api_key: String::new(),
            source_language: "en".to_string(),
            target_language: "zh-CN".to_string(),
            subtitle_mode: "bilingual".to_string(),
            min_dwell_ms: 1800,
            max_dwell_ms: 4200,
            max_queue: 5,
            subtitle_font_size: 30,
            subtitle_original_color: "#1d1d1f".to_string(),
            subtitle_translated_color: "#111113".to_string(),
            subtitle_background_color: "#ffffff".to_string(),
            subtitle_background_opacity: 92,
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
    let config = load_config(&app)?;
    emit_subtitle_config(&app, &config);
    Ok(config)
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
            source_language,
            target_language,
            subtitle_mode,
            min_dwell_ms,
            max_dwell_ms,
            max_queue,
            subtitle_font_size,
            subtitle_original_color,
            subtitle_translated_color,
            subtitle_background_color,
            subtitle_background_opacity,
            save_history,
            updated_at
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            asr_provider = excluded.asr_provider,
            asr_api_key = excluded.asr_api_key,
            llm_provider = excluded.llm_provider,
            llm_api_key = excluded.llm_api_key,
            source_language = excluded.source_language,
            target_language = excluded.target_language,
            subtitle_mode = excluded.subtitle_mode,
            min_dwell_ms = excluded.min_dwell_ms,
            max_dwell_ms = excluded.max_dwell_ms,
            max_queue = excluded.max_queue,
            subtitle_font_size = excluded.subtitle_font_size,
            subtitle_original_color = excluded.subtitle_original_color,
            subtitle_translated_color = excluded.subtitle_translated_color,
            subtitle_background_color = excluded.subtitle_background_color,
            subtitle_background_opacity = excluded.subtitle_background_opacity,
            save_history = excluded.save_history,
            updated_at = CURRENT_TIMESTAMP",
        params![
            config.asr_provider,
            config.asr_api_key,
            config.llm_provider,
            config.llm_api_key,
            config.source_language,
            config.target_language,
            config.subtitle_mode,
            config.min_dwell_ms,
            config.max_dwell_ms,
            config.max_queue,
            config.subtitle_font_size,
            config.subtitle_original_color,
            config.subtitle_translated_color,
            config.subtitle_background_color,
            config.subtitle_background_opacity,
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
                source_language,
                target_language,
                subtitle_mode,
                min_dwell_ms,
                max_dwell_ms,
                max_queue,
                subtitle_font_size,
                subtitle_original_color,
                subtitle_translated_color,
                subtitle_background_color,
                subtitle_background_opacity,
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
            source_language: row.get(4)?,
            target_language: row.get(5)?,
            subtitle_mode: row.get(6)?,
            min_dwell_ms: row.get(7)?,
            max_dwell_ms: row.get(8)?,
            max_queue: row.get(9)?,
            subtitle_font_size: row.get(10)?,
            subtitle_original_color: row.get(11)?,
            subtitle_translated_color: row.get(12)?,
            subtitle_background_color: row.get(13)?,
            subtitle_background_opacity: row.get(14)?,
            save_history: row.get::<_, i64>(15)? != 0,
        })
    })
    .map_err(|e| format!("读取配置失败: {e}"))
}

#[tauri::command]
pub fn get_translation_history(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<TranslationHistoryItem>, String> {
    let conn = connect(&app)?;
    migrate(&conn)?;
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let mut stmt = conn
        .prepare(
            "SELECT id, original, translated, source_language, target_language, created_at
            FROM translation_history
            ORDER BY id DESC
            LIMIT ?1",
        )
        .map_err(|e| format!("读取历史记录失败: {e}"))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(TranslationHistoryItem {
                id: row.get(0)?,
                original: row.get(1)?,
                translated: row.get(2)?,
                source_language: row.get(3)?,
                target_language: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("读取历史记录失败: {e}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("读取历史记录失败: {e}"))?);
    }
    Ok(items)
}

pub fn save_translation_history(
    app: &AppHandle,
    original: &str,
    translated: &str,
    source_language: &str,
    target_language: &str,
) -> Result<(), String> {
    let config = load_config(app)?;
    if !config.save_history || translated.trim().is_empty() {
        return Ok(());
    }
    let conn = connect(app)?;
    migrate(&conn)?;
    conn.execute(
        "INSERT INTO translation_history (
            original,
            translated,
            source_language,
            target_language,
            created_at
        ) VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        params![
            original.trim(),
            translated.trim(),
            source_language,
            target_language,
        ],
    )
    .map_err(|e| format!("保存历史记录失败: {e}"))?;
    Ok(())
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
            source_language TEXT NOT NULL DEFAULT 'en',
            target_language TEXT NOT NULL DEFAULT 'zh-CN',
            subtitle_mode TEXT NOT NULL DEFAULT 'bilingual',
            min_dwell_ms INTEGER NOT NULL DEFAULT 1800,
            max_dwell_ms INTEGER NOT NULL DEFAULT 4200,
            max_queue INTEGER NOT NULL DEFAULT 5,
            subtitle_font_size INTEGER NOT NULL DEFAULT 30,
            subtitle_original_color TEXT NOT NULL DEFAULT '#1d1d1f',
            subtitle_translated_color TEXT NOT NULL DEFAULT '#111113',
            subtitle_background_color TEXT NOT NULL DEFAULT '#ffffff',
            subtitle_background_opacity INTEGER NOT NULL DEFAULT 92,
            save_history INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS translation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original TEXT NOT NULL,
            translated TEXT NOT NULL,
            source_language TEXT NOT NULL DEFAULT 'en',
            target_language TEXT NOT NULL DEFAULT 'zh-CN',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT OR IGNORE INTO app_config (id) VALUES (1);",
    )
    .map_err(|e| format!("初始化数据库失败: {e}"))?;
    add_column_if_missing(
        conn,
        "app_config",
        "source_language",
        "TEXT NOT NULL DEFAULT 'en'",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "target_language",
        "TEXT NOT NULL DEFAULT 'zh-CN'",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "subtitle_font_size",
        "INTEGER NOT NULL DEFAULT 30",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "subtitle_original_color",
        "TEXT NOT NULL DEFAULT '#1d1d1f'",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "subtitle_translated_color",
        "TEXT NOT NULL DEFAULT '#111113'",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "subtitle_background_color",
        "TEXT NOT NULL DEFAULT '#ffffff'",
    )?;
    add_column_if_missing(
        conn,
        "app_config",
        "subtitle_background_opacity",
        "INTEGER NOT NULL DEFAULT 92",
    )?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("检查数据库字段失败: {e}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("检查数据库字段失败: {e}"))?;
    for name in columns {
        if name.map_err(|e| format!("检查数据库字段失败: {e}"))? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map_err(|e| format!("更新数据库结构失败: {e}"))?;
    Ok(())
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    if config.asr_provider.trim().is_empty() {
        return Err("ASR provider 不能为空".to_string());
    }
    if config.llm_provider.trim().is_empty() {
        return Err("LLM provider 不能为空".to_string());
    }
    if config.source_language.trim().is_empty() || config.target_language.trim().is_empty() {
        return Err("翻译语言不能为空".to_string());
    }
    if config.min_dwell_ms < 500 || config.max_dwell_ms < config.min_dwell_ms {
        return Err("字幕停留时间配置无效".to_string());
    }
    if config.max_queue < 1 || config.max_queue > 20 {
        return Err("字幕队列长度需在 1 到 20 之间".to_string());
    }
    if config.subtitle_font_size < 18 || config.subtitle_font_size > 64 {
        return Err("字幕字号需在 18 到 64 之间".to_string());
    }
    if config.subtitle_background_opacity < 0 || config.subtitle_background_opacity > 100 {
        return Err("字幕背景透明度需在 0 到 100 之间".to_string());
    }
    for color in [
        &config.subtitle_original_color,
        &config.subtitle_translated_color,
        &config.subtitle_background_color,
    ] {
        if !is_hex_color(color) {
            return Err("字幕颜色格式无效".to_string());
        }
    }
    Ok(())
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
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
            subtitle_font_size: config.subtitle_font_size,
            subtitle_original_color: config.subtitle_original_color.clone(),
            subtitle_translated_color: config.subtitle_translated_color.clone(),
            subtitle_background_color: config.subtitle_background_color.clone(),
            subtitle_background_opacity: config.subtitle_background_opacity,
        },
    );
}
