// Phase 2 · GLM-4.7-Flash 流式翻译客户端
// 整句英文 final → chat/completions(stream)→ 流式中文 → emit translating/done。
// 准确率(design §5.4):system 规则保留专有名词 + 最近几句(原文,译文)滚动上下文。

use futures_util::StreamExt;
use serde_json::json;
use tauri::AppHandle;

use crate::asr::emit_subtitle;

const CHAT_URL: &str = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const SYS: &str = "你是实时字幕的同声传译。把英文口语逐句翻成自然、简洁的简体中文。\
保留专有名词、产品名、库名、框架名、技术术语、代码标识符为英文原文,不要硬译\
(例如 Bun、Node、Deno、JavaScript、TypeScript 保持英文)。\
只输出译文本身,不要加引号、不要解释、不要附原文。";

/// 翻译一句,流式 emit 中文。ctx 为最近几句(原文, 译文)做术语/语境连贯。
/// 返回译文(供加入上下文);出错返回 None。
pub async fn translate(
    app: &AppHandle,
    client: &reqwest::Client,
    key: &str,
    id: u64,
    en: &str,
    ctx: &[(String, String)],
) -> Option<String> {
    let mut messages = vec![json!({"role": "system", "content": SYS})];
    for (src, dst) in ctx {
        messages.push(json!({"role": "user", "content": src}));
        messages.push(json!({"role": "assistant", "content": dst}));
    }
    messages.push(json!({"role": "user", "content": en}));

    let body = json!({
        "model": "glm-4.7-flash",
        "stream": true,
        "temperature": 0.3,
        "messages": messages,
    });

    let resp = match client.post(CHAT_URL).bearer_auth(key).json(&body).send().await {
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
                emit_subtitle(app, id, en, &zh, "done");
                return non_empty(zh);
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
    emit_subtitle(app, id, en, &zh, "done");
    non_empty(zh)
}

fn non_empty(s: String) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}
