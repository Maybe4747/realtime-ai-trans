use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{asr, db, translate};

const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioToolRequest {
    pub file_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub translate: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioToolResult {
    pub original: String,
    pub translated: String,
}

#[tauri::command]
pub async fn translate_text_tool(app: AppHandle, text: String) -> Result<String, String> {
    let config = db::load_config(&app)?;
    if config.llm_provider != "deepseek_v4_flash" {
        return Err(format!("当前翻译服务暂不可用: {}", config.llm_provider));
    }
    let key = config.llm_api_key.trim();
    if key.is_empty() {
        return Err("请先在设置中填写翻译访问密钥".to_string());
    }
    let client = reqwest::Client::new();
    translate::translate_text(&client, key, &text).await
}

#[tauri::command]
pub async fn process_audio_tool(
    app: AppHandle,
    request: AudioToolRequest,
) -> Result<AudioToolResult, String> {
    if request.bytes.is_empty() {
        return Err("请选择一个音频文件".to_string());
    }
    if request.bytes.len() > MAX_UPLOAD_BYTES {
        return Err("文件过大，请选择 25MB 以内的音频文件".to_string());
    }
    if !request.mime_type.starts_with("audio/") {
        return Err("目前请选择音频文件".to_string());
    }

    let config = db::load_config(&app)?;
    if config.asr_provider != "zhipu_glm_asr" {
        return Err(format!("当前语音识别服务暂不可用: {}", config.asr_provider));
    }
    if request.translate && config.llm_provider != "deepseek_v4_flash" {
        return Err(format!("当前翻译服务暂不可用: {}", config.llm_provider));
    }
    let asr_key = config.asr_api_key.trim();
    if asr_key.is_empty() {
        return Err("请先在设置中填写语音识别访问密钥".to_string());
    }
    let llm_key = config.llm_api_key.trim();
    if request.translate && llm_key.is_empty() {
        return Err("请先在设置中填写翻译访问密钥".to_string());
    }

    let client = reqwest::Client::new();
    let original = asr::transcribe_file(
        &client,
        asr_key,
        &request.file_name,
        &request.mime_type,
        request.bytes,
    )
    .await?;
    let translated = if request.translate {
        translate::translate_text(&client, llm_key, &original).await?
    } else {
        String::new()
    };
    Ok(AudioToolResult {
        original,
        translated,
    })
}
