// Phase 2 · DeepSeek v4 flash 流式翻译客户端
// 整句英文 final → chat/completions(stream)→ 流式中文 → emit translating/done。
// 准确率(design §5.4):system 规则保留专有名词 + 最近几句(原文,译文)滚动上下文。

use futures_util::StreamExt;
use serde_json::json;
use tauri::AppHandle;

use crate::asr::emit_subtitle;
use crate::{db, prompts};

const CHAT_URL: &str = "https://api.deepseek.com/chat/completions";

/// 翻译一句,流式 emit 中文。ctx 为最近几句(原文, 译文)做术语/语境连贯。
/// 返回译文(供加入上下文);出错返回 None。
pub async fn translate(
    app: &AppHandle,
    client: &reqwest::Client,
    key: &str,
    id: u64,
    en: &str,
    ctx: &[(String, String)],
    source_language: &str,
    target_language: &str,
) -> Option<String> {
    let system = prompts::translation_system_prompt(source_language, target_language);
    let mut messages = vec![json!({"role": "system", "content": system})];
    for (src, dst) in ctx {
        messages.push(json!({"role": "user", "content": src}));
        messages.push(json!({"role": "assistant", "content": dst}));
    }
    messages.push(json!({"role": "user", "content": en}));

    let body = json!({
        "model": "deepseek-v4-flash",
        "stream": true,
        "thinking": { "type": "disabled" },
        "temperature": 0.1,
        "max_tokens": 160,
        "messages": messages,
    });

    let resp = match client
        .post(CHAT_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            emit_subtitle(app, id, en, &format!("[翻译请求失败] {e}"), "error");
            return None;
        }
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        emit_subtitle(app, id, en, &format!("[翻译 {status}] {detail}"), "error");
        return None;
    }

    let mut stream = resp.bytes_stream();
    let mut line_buf = String::new();
    let mut zh = String::new();

    while let Some(chunk) = stream.next().await {
        let Ok(bytes) = chunk else { break };
        line_buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = line_buf.find('\n') {
            let line: String = line_buf.drain(..=pos).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                return finish_translation(app, id, en, zh, source_language, target_language);
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if let Some(delta) = v
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|s| s.as_str())
            {
                if !delta.is_empty() {
                    zh.push_str(delta);
                    emit_subtitle(app, id, en, &zh, "translating");
                }
            }
        }
    }
    finish_translation(app, id, en, zh, source_language, target_language)
}

pub async fn translate_text(
    client: &reqwest::Client,
    key: &str,
    text: &str,
    source_language: &str,
    target_language: &str,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("请输入需要翻译的内容".to_string());
    }
    let system = prompts::translation_system_prompt(source_language, target_language);
    let body = json!({
        "model": "deepseek-v4-flash",
        "stream": false,
        "thinking": { "type": "disabled" },
        "temperature": 0.1,
        "max_tokens": 4096,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": text }
        ],
    });
    let resp = client
        .post(CHAT_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("翻译请求失败: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(format!("翻译失败({status}): {detail}"));
    }
    let v = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析翻译结果失败: {e}"))?;
    let translated = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if translated.is_empty() {
        Err("没有获得翻译结果".to_string())
    } else {
        Ok(translated)
    }
}

fn finish_translation(
    app: &AppHandle,
    id: u64,
    original: &str,
    translated: String,
    source_language: &str,
    target_language: &str,
) -> Option<String> {
    let translated = translated.trim().to_string();
    emit_subtitle(app, id, original, &translated, "done");
    if translated.is_empty() {
        None
    } else {
        let _ = db::save_translation_history(
            app,
            original,
            &translated,
            source_language,
            target_language,
        );
        Some(translated)
    }
}
