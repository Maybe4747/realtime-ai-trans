// Phase 1/2 · GLM-ASR 流式客户端
// PCM(16kHz mono f32)→ WAV bytes → multipart POST(stream=true)
// → 解析 SSE transcript.text.delta/done → emit "subtitle" 事件,并返回整句供翻译。

use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const ASR_URL: &str = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions";
static UTTER_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
pub struct SubtitleEvent {
    pub id: u64,
    pub original: String,
    pub translated: String,
    pub status: String, // asr_partial | asr_final | translating | done | error
}

/// 统一向字幕窗发事件(asr 与 translate 共用)。
pub(crate) fn emit_subtitle(
    app: &AppHandle,
    id: u64,
    original: &str,
    translated: &str,
    status: &str,
) {
    let _ = app.emit_to(
        "subtitle",
        "subtitle",
        SubtitleEvent {
            id,
            original: original.to_string(),
            translated: translated.to_string(),
            status: status.to_string(),
        },
    );
}

// 16kHz mono f32 → 16-bit WAV 字节(内存中,不落盘)。
fn encode_wav(pcm: &[f32]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for &s in pcm {
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            w.write_sample(v).map_err(|e| e.to_string())?;
        }
        w.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

/// 转写一段音频并流式 emit 英文。返回整句 final 文本(供翻译);空或出错返回 None。
pub async fn transcribe(
    app: &AppHandle,
    client: &reqwest::Client,
    key: &str,
    pcm: Vec<f32>,
) -> Option<(u64, String)> {
    let id = UTTER_ID.fetch_add(1, Ordering::Relaxed);
    let wav = match encode_wav(&pcm) {
        Ok(w) => w,
        Err(e) => {
            emit_subtitle(app, id, &format!("[编码失败] {e}"), "", "error");
            return None;
        }
    };

    let part = match reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
    {
        Ok(p) => p,
        Err(e) => {
            emit_subtitle(app, id, &format!("[part] {e}"), "", "error");
            return None;
        }
    };
    let form = reqwest::multipart::Form::new()
        .text("model", "glm-asr-2512")
        .text("stream", "true")
        .part("file", part);

    let resp = match client
        .post(ASR_URL)
        .bearer_auth(key)
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            emit_subtitle(app, id, &format!("[请求失败] {e}"), "", "error");
            return None;
        }
    };
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        emit_subtitle(app, id, &format!("[ASR {status}] {body}"), "", "error");
        return None;
    }

    let mut stream = resp.bytes_stream();
    let mut line_buf = String::new();
    let mut text = String::new();

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
                return finalize(app, id, text);
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
                "transcript.text.delta" => {
                    if let Some(d) = v.get("delta").and_then(|x| x.as_str()) {
                        text.push_str(d);
                        emit_subtitle(app, id, &text, "", "asr_partial");
                    }
                }
                "transcript.text.done" => {
                    if let Some(full) = v.get("text").and_then(|x| x.as_str()) {
                        if !full.is_empty() {
                            text = full.to_string();
                        }
                    }
                    return finalize(app, id, text);
                }
                _ => {}
            }
        }
    }
    finalize(app, id, text)
}

// 后置过滤(design §5.3):空串/纯空白不出字幕,避免静音误识别污染。
fn finalize(app: &AppHandle, id: u64, text: String) -> Option<(u64, String)> {
    if text.trim().is_empty() {
        return None;
    }
    emit_subtitle(app, id, &text, "", "asr_final");
    Some((id, text))
}
