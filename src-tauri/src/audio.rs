// Phase 1 · 流式音频采集 + 能量 VAD 切句
// SCStream 持续采集 48k/2ch → 下混单声道 → 抽取到 16k → 能量 VAD 按静音切句
// → 每段 PCM 经 channel 送处理线程 → asr::transcribe。

use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use screencapturekit::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::asr;
use crate::db;
use crate::translate;

const SRC_RATE: usize = 48_000;
const DST_RATE: usize = 16_000;
const DECIM: usize = SRC_RATE / DST_RATE; // 3:1 整除

// VAD 参数(在 16k 上)
const FRAME: usize = 320; // 20ms
const SILENCE_RMS: f32 = 0.008; // 能量阈值,低于视为静音
const SILENCE_HANG: usize = 18; // 连续 18 帧(360ms)静音 → 收段
const MIN_SEG: usize = DST_RATE * 3 / 10; // 最短 300ms,过短丢弃(噪声)
const MAX_SEG: usize = DST_RATE * 8; // 最长 8s,兜底拆长句降低端到端延迟

struct Vad {
    seg: Vec<f32>,     // 当前累积段(16k)
    frame: Vec<f32>,   // 凑帧算 RMS
    silence: usize,    // 连续静音帧数
    in_speech: bool,
    decim_acc: f32, // 48k→16k 抽取累加
    decim_n: usize,
    tx: Sender<Vec<f32>>,
}

impl Vad {
    fn push_48k(&mut self, s: f32) {
        self.decim_acc += s;
        self.decim_n += 1;
        if self.decim_n == DECIM {
            let avg = self.decim_acc / DECIM as f32;
            self.decim_acc = 0.0;
            self.decim_n = 0;
            self.push_16k(avg);
        }
    }

    fn push_16k(&mut self, s: f32) {
        self.frame.push(s);
        if self.frame.len() < FRAME {
            return;
        }
        let rms = (self.frame.iter().map(|x| x * x).sum::<f32>() / FRAME as f32).sqrt();
        let voiced = rms > SILENCE_RMS;

        if voiced {
            self.in_speech = true;
            self.silence = 0;
            self.seg.extend_from_slice(&self.frame);
        } else if self.in_speech {
            self.silence += 1;
            self.seg.extend_from_slice(&self.frame); // 含尾静音作 padding
            if self.silence >= SILENCE_HANG {
                self.flush();
            }
        }
        if self.seg.len() >= MAX_SEG {
            self.flush();
        }
        self.frame.clear();
    }

    fn flush(&mut self) {
        if self.seg.len() >= MIN_SEG {
            let seg = std::mem::take(&mut self.seg);
            let _ = self.tx.send(seg);
        } else {
            self.seg.clear();
        }
        self.silence = 0;
        self.in_speech = false;
    }
}

struct Capture {
    vad: Arc<Mutex<Vad>>,
}

impl SCStreamOutputTrait for Capture {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Audio {
            return;
        }
        let Some(list) = sample.audio_buffer_list() else {
            return;
        };
        let n = list.num_buffers();
        if n == 0 {
            return;
        }
        // Float32、每通道一 buffer(非交错)。下混单声道后喂 VAD。
        let chans: Vec<&[u8]> = list.iter().map(|b| b.data()).collect();
        let frames = chans[0].len() / 4;
        let mut vad = self.vad.lock().unwrap();
        for f in 0..frames {
            let off = f * 4;
            let mut acc = 0.0f32;
            for ch in &chans {
                if off + 4 <= ch.len() {
                    acc += f32::from_le_bytes([ch[off], ch[off + 1], ch[off + 2], ch[off + 3]]);
                }
            }
            vad.push_48k(acc / n as f32);
        }
    }
}

static STREAM: Mutex<Option<SCStream>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStateEvent {
    running: bool,
    message: String,
}

pub fn is_running() -> bool {
    STREAM.lock().unwrap().is_some()
}

pub fn emit_capture_state(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "capture_state",
        CaptureStateEvent {
            running: is_running(),
            message: message.into(),
        },
    );
}

/// 开始同传:采集→VAD→ASR→翻译。需先在设置中配置 provider key 与屏幕录制权限。
#[tauri::command]
pub fn start_capture(app: AppHandle) -> Result<(), String> {
    let mut guard = STREAM.lock().unwrap();
    if guard.is_some() {
        return Err("已在运行".into());
    }
    let config = db::load_config(&app)?;
    if config.asr_provider != "zhipu_glm_asr" {
        return Err(format!("暂不支持 ASR provider: {}", config.asr_provider));
    }
    if config.llm_provider != "deepseek_v4_flash" {
        return Err(format!("暂不支持 LLM provider: {}", config.llm_provider));
    }
    let asr_key = config.asr_api_key.trim().to_string();
    if asr_key.is_empty() {
        return Err("请先在设置中配置 ASR API key".to_string());
    }
    let translate_key = config.llm_api_key.trim().to_string();
    if translate_key.is_empty() {
        return Err("请先在设置中配置 LLM translation API key".to_string());
    }

    let content = SCShareableContent::get().map_err(|e| format!("获取共享内容失败: {e:?}"))?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("没有可用显示器")?;
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();
    let config = SCStreamConfiguration::new()
        .with_width(2)
        .with_height(2)
        .with_captures_audio(true)
        .with_sample_rate(SRC_RATE as i32)
        .with_channel_count(2)
        .with_excludes_current_process_audio(true);

    let (tx, rx) = channel::<Vec<f32>>();

    // 处理线程:消费切好的段 → 调 ASR;翻译旁路并发,避免堵塞下一段 ASR。
    let app2 = app.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[audio] 创建运行时失败: {e}");
                return;
            }
        };
        let client = reqwest::Client::new();
        rt.block_on(async move {
            // 最近几句(原文, 译文)做翻译上下文,术语/语境连贯。
            let ctx: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
            while let Ok(seg) = rx.recv() {
                if let Some((id, en)) = asr::transcribe(&app2, &client, &asr_key, seg).await {
                    let app3 = app2.clone();
                    let client3 = client.clone();
                    let key3 = translate_key.clone();
                    let ctx3 = ctx.clone();
                    let ctx_snapshot = ctx.lock().unwrap().clone();
                    tokio::spawn(async move {
                        if let Some(zh) =
                            translate::translate(&app3, &client3, &key3, id, &en, &ctx_snapshot)
                                .await
                        {
                            let mut ctx = ctx3.lock().unwrap();
                            ctx.push((en, zh));
                            let len = ctx.len();
                            if len > 3 {
                                ctx.drain(..len - 3);
                            }
                        }
                    });
                }
            }
        });
    });

    let vad = Arc::new(Mutex::new(Vad {
        seg: Vec::new(),
        frame: Vec::new(),
        silence: 0,
        in_speech: false,
        decim_acc: 0.0,
        decim_n: 0,
        tx,
    }));

    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(Capture { vad }, SCStreamOutputType::Audio);
    stream
        .start_capture()
        .map_err(|e| format!("启动采集失败(检查屏幕录制权限): {e:?}"))?;

    *guard = Some(stream);
    emit_capture_state(&app, "正在同传系统音频");
    Ok(())
}

/// 停止同传。drop stream → drop handler → drop tx → 处理线程退出。
#[tauri::command]
pub fn stop_capture(app: AppHandle) -> Result<(), String> {
    let stream = STREAM.lock().unwrap().take().ok_or("当前未在运行")?;
    stream
        .stop_capture()
        .map_err(|e| format!("停止采集失败: {e:?}"))?;
    emit_capture_state(&app, "已停止");
    Ok(())
}
