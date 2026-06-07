# 桌面端 AI 同声传译字幕助手 · 设计文档

> 版本: v0.1 · 日期: 2026-06-07 · 状态: 设计中(未开工)

---

## 1. 产品定位

**一句话:** 让 macOS 上任何正在播放的声音,即时变成母语悬浮字幕,不挑 app、不挑网站。

**首发主打场景:** 看视频 / 学习(YouTube、网课、播客)。
之所以先做这个场景,是因为它天然规避了三个最硬的需求,能把全部精力压在「同传体验」本身:

- 只需采**系统输出音频**,单向(不用处理"你说的话")
- 不需要**分辨说话人**
- 隐私不敏感(可以用云端 API)

**首发明确不做(后续阶段):** 在线会议模式、双向音频、说话人分离、多语言、本地模型、Windows。

### 1.1 差异化

| 现有方案             | 短板                           | 我们的优势 |
| -------------------- | ------------------------------ | ---------- |
| YouTube 自带翻译字幕 | 只在 YouTube,质量看天          | 不挑来源   |
| Zoom/Teams 字幕      | 锁在各自 app,常要付费档        | 系统级     |
| 沉浸式翻译           | 偏网页文本,视频实时弱          | 实时音频   |
| macOS Live Captions  | 系统级但基本只英文、**不翻译** | 带翻译     |
| Otter / Whisper 工具 | 偏录音文件转写,非实时悬浮      | 实时悬浮   |

护城河 = 同时做到「**系统级 + 实时 + 翻译 + 悬浮字幕**」四件事。

---

## 2. 核心体验原则

1. **句级近实时,优先可读性。** 受 ASR 接口限制(见 §4),字幕是"每句话说完后一两秒出现",不是逐字同步。完整句子比逐字跳动更易读,对学习更友好。
2. **转写求快、翻译求稳。** 英文识别结果流式显示(边说边出);翻译等整句识别完成后再触发,避免译文反复重写。
3. **字幕不挡操作。** 悬浮窗鼠标穿透,不影响点视频/会议。
4. **必须盖得住全屏视频。** 看视频几乎必然全屏,字幕浮不到全屏之上则产品价值减半(见 §8 风险)。
5. **零配置起步。** 利用 ScreenCaptureKit 抓系统音频,只需一次录屏授权,不要求用户装虚拟声卡。
6. **只把有内容的语音送上云端。** VAD 门控过滤静音/杂音/纯音乐 → 省延迟、省费用;ASR 只管转写,术语准确率交给翻译层。

---

## 3. 技术选型

| 模块     | 选型                                        | 说明                                  |
| -------- | ------------------------------------------- | ------------------------------------- |
| 桌面框架 | Tauri 2                                     | 已有骨架。Rust 后端 + React 前端      |
| 前端     | React 19 + Vite + Tailwind 4 + shadcn       | 已有                                  |
| 音频采集 | ScreenCaptureKit (macOS 13+)                | 零配置抓系统音频                      |
| 断句     | 本地 VAD(Silero VAD via ONNX,或 webrtc-vad) | 按静音切句                            |
| ASR      | **智谱 GLM-ASR-2512**                       | HTTP,单段 ≤30s,支持英文,`stream=true` |
| 翻译     | **智谱 GLM-4.7-Flash(免费)** · 默认         | OpenAI 兼容,`stream=true`,200K;走 `Translator` 抽象,可切通用翻译 API |
| 密钥存储 | OS Keychain / Tauri store                   | 智谱 API key,仅存 Rust 侧             |

### 3.1 两个云端模型的关键事实(已核对官方文档)

**GLM-ASR-2512**

- 接口: `POST https://open.bigmodel.cn/api/paas/v4/audio/transcriptions`,`multipart/form-data`,模型名 `glm-asr-2512`
- **硬限制: 单段音频 ≤ 30 秒,文件 ≤ 25 MB** → 必须本地切句后分段上传
- `stream=true`: 单段识别结果流式返回(非无限音频流)
- 语言: 中文(含方言)、**英文**(英美音)、法德日韩西阿等
- 它是 **ASR(转写),不是翻译**,翻译需独立一步(GLM-4.7-Flash)
- 流式格式(**已确认**):SSE,`type=transcript.text.delta`(增量,取 `delta`)/ `transcript.text.done`(完成),结尾 `data: [DONE]`
- 响应**不含**置信度/分段/时间戳,只有 `text` → 过滤垃圾结果只能靠启发式(见 §5.3)
- 支持 `hotwords`(≤100)与 `prompt`(上下文,<8000 字)参数,但 **MVP 不用**,保持 ASR 纯净(见 §5.4 末)
- ⚠️ 采样率/编码/位深官方未写、价格未知:**实现时实测**

**GLM-4.7-Flash**

- 接口: `POST https://open.bigmodel.cn/api/paas/v4/chat/completions`,OpenAI 兼容
- `stream=true` 支持;上下文 200K,最大输出 128K
- 免费档(具体 RPM/TPM 限流官方未明示,**需实测**)
- 适合翻译;中英翻译质量需实测

**通用翻译 API(`general_translation`,可选 · 后续)**

- 接口: `POST https://open.bigmodel.cn/api/v1/agents`,`agent_id=general_translation`(**非** OpenAI 兼容,需单独适配)
- `stream=true`(SSE);`source_lang=auto` 自动检测,`target_lang=zh-CN`
- **术语表 glossary**(file_id):同一术语全程统一译法 —— 学习/技术内容的独有价值
- `strategy`: `general`(单步,**实时只能用这个**)/ `reflection`/`cot`/`two_step`/`three_step`(多步=高延迟,实时用不了);`suggestion` 可指定口语化/字幕风格
- 计费: **20 元/百万 token**(1h 视频约 1~2 元)

---

## 4. 整体架构

```
┌──────────────────────── Rust 后端 (src-tauri) ────────────────────────┐
│                                                                        │
│  [1] ScreenCaptureKit 采集系统音频                                       │
│        → CMSampleBuffer (48kHz Float32)                                 │
│        → 下混单声道 + 重采样 16kHz mono PCM → ring buffer               │
│                                                                        │
│  [2] 本地 VAD 切句                                                      │
│        → 逐帧检测语音/静音                                              │
│        → 静音 > 阈值(~600ms) 即断句;或逼近 ~25s 强制切(兜底 30s 限制)  │
│        → 输出一段带前后 padding 的 WAV(16kHz mono)                     │
│                                                                        │
│  [3] GLM-ASR 转写(每段一次 HTTP, stream=true)                          │
│        → 流式收英文 token(interim)→ 段结束得到整句(final)             │
│                                                                        │
│  [4] GLM-4.7-Flash 翻译(整句 final 触发, stream=true)                  │
│        → 带最近 1~2 句上下文 → 流式收中文译文                           │
│                                                                        │
│  [5] emit Tauri 事件 { id, original, translated, status }              │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ IPC events
          ┌──────────────────────┴──────────────────────┐
          ▼                                              ▼
   主控窗 (React)                                 字幕悬浮窗 (React)
   开始/停止、设置、历史记录                       透明/置顶/鼠标穿透/双语/可拖动
```

**两个铁律:**

- 音频采集 + API key 全在 Rust 侧(webview 拿不到系统音频,密钥不能漏到前端)。
- 字幕渲染用**独立悬浮窗**,与主控窗解耦。

### 4.1 为什么是"切句 + HTTP"而不是"持续 WebSocket 流"

GLM-ASR 单段 ≤30s 的 HTTP 接口决定了无法喂无限音频流。因此:

- 用**本地 VAD 在静音处切句**(自然句边界),而非固定窗口硬切 → 减少边界丢词。
- 切出的每段 ≤25s(留 5s 安全余量),`stream=true` 让单段结果尽早回显。
- ASR 抽象成 `trait`,未来要逐字同传可换 WebSocket 供应商(Deepgram/火山)而不动 §4 其余部分。

---

## 5. 关键模块设计

### 5.1 音频采集(Rust)

- ScreenCaptureKit `SCStream`,`SCStreamConfiguration.capturesAudio = true`(macOS 13+)。
- 回调拿 `CMSampleBuffer`(通常 48kHz / Float32)→ 下混单声道 → 重采样 16kHz → 写入 ring buffer。
- **权限:** ScreenCaptureKit 音频采集需"录屏权限"(TCC),首次运行引导授权。
- Rust 绑定候选: `screencapturekit` crate / `cidre`,或编一个极薄的 Swift sidecar 桥接。**成熟度是 #1 风险(见 §8)。**
- 备选(后续):macOS 14.2+ Core Audio Tap(`AudioHardwareCreateProcessTap`)可不依赖录屏权限,但 Rust 生态更不成熟。

### 5.2 VAD 切句与内容门控(Rust)

只把"有内容的语音"送上云端 → 省延迟、省费用(避开静音/杂音/纯音乐的无效请求)。三道闸:

- **闸 1 · VAD(本地,送 ASR 前):** Silero VAD(ONNX,经 `ort` / `voice_activity_detector` crate)质量好;`webrtc-vad` 更轻;能量阈值兜底。逐帧检测,纯静音直接不产生段。
- **闸 2 · 本地兜底(送 ASR 前):** 最短语音时长门限(如 <300ms 的爆音/点击噪声丢弃);Silero 对非语音噪声/音乐有一定鲁棒性,降低误触发。
- **闸 3 · ASR 后(见 §5.3):** GLM-ASR 不返回置信度,故对返回文本做启发式过滤(空串、纯重复/幻觉模式)→ 丢弃则**连翻译调用一起省掉**。

**切句(端点检测)逻辑:** 语音起始开段 → 静音持续 > 阈值(默认 ~600ms)收段;逼近 ~25s 强制切(兜底 30s 限制);每段前后加 ~200ms padding 防削词。参数可调。

⚠️ **端点阈值直接影响翻译质量:** 切太碎 → 句子残缺、上下文丢失、译文差;切太长 → 延迟高。优先在自然句边界(较长停顿)断句。

### 5.3 ASR 调用(Rust)

**职责单一:音频 → 文字,不管术语对错(术语交给 §5.4 翻译层)。** 走 `Asr` trait,保持可替换。

- 每段: multipart POST 到 GLM-ASR,`model=glm-asr-2512` + WAV(16kHz mono)+ `stream=true`。
- 流式响应(已确认):SSE,`transcript.text.delta`(增量,取 `delta`)累积 → `transcript.text.done` 即该句 final,结尾 `data: [DONE]`。
- 该句获得稳定 id,delta 阶段更新 `original`,done 时锁定。
- **后置过滤(闸 3):** 无置信度可用,故按启发式丢弃空串 / 纯重复 / 已知幻觉短语(如静音上冒出的 "Thank you" 类),避免触发无谓翻译。
- `hotwords`/`prompt` 参数存在但 **MVP 不用** —— 让 ASR 保持纯净、可替换;留作后续"听错专有名词"的可选逃生口(见 §5.4 末)。

### 5.4 翻译调用与准确率(Rust)

翻译抽象成 `Translator` trait(与 ASR 对称,可换后端)。MVP 默认 = GLM-4.7-Flash;通用翻译 API 作后续"高质量/术语表"可选档。**术语准确率全压在这一层**(ASR 只管转写)。

- 触发: 某句 ASR final → `chat/completions`,`stream=true` → 流式收中文,更新该句 `translated`。

**准确率三层(逐级加力):**

1. **Prompt 规则(零配置,收益最大):** system prompt 硬性要求"保留专有名词 / 产品名 / 库名 / 技术术语 / 代码标识符为英文,不硬译"。多数 bun→包子 这类,在 techy 上下文里靠这条就解决。
2. **滚动上下文(强化版):** 每次带最近 2~3 句 **(原文, 译文) 对**(而非只带译文)。作用:代词/主题连贯 + 隐式确定领域 + **术语自我强化**(某句把 Bun 保留后,后续自动跟着保留)。200K 上下文足够放整场。
3. **术语表 / 热词(翻译层,兜底):** 用户可编辑的「术语→译法」表,注入翻译 prompt(或用通用翻译 API 原生 glossary),强制覆盖模型仍译错的顽固词。**注意:这是翻译层热词,不是 ASR 热词。**

> **诚实的边界 ——「译错」vs「听错」:**
> 上面三层修的是**译错**(ASR 听对了 bun,LLM 却译成包子)→ 归翻译层,没问题。
> 但还有**听错**:ASR 把 "Bun" 直接听成 "born",此时文字里根本没有 bun,LLM 再聪明也救不回 → 只能靠 ASR `hotwords`。
> MVP 按「ASR 纯净」主线**先不上 ASR 热词**;若实测发现专有名词频繁被听错,再把 GLM-ASR 的 `hotwords`(免费支持)接为可选逃生口,不动其余架构。

- **可选后端(通用翻译 API):** `general` 单步策略(多步延迟太高,实时不可用)+ `suggestion` 控字幕风格 + 原生术语表;按量计费。

### 5.5 字幕悬浮窗(React)

- 维护一个 utterance 列表(按 id),收到事件就地更新;只显示最近 N 句(默认 2~3 句)。
- 每句两行: 上行英文(浅色/小)、下行中文(高亮/大)。可切"仅译文"。
- 样式可调: 字号、背景透明度、最大行数、位置。

---

## 6. 事件协议(Rust → React)

```ts
// Tauri event name: "subtitle"
interface SubtitleEvent {
  id: string // 一句话的唯一 id
  original: string // 英文(asr 阶段会增量更新)
  translated: string // 中文(translating 阶段会增量更新)
  status: "asr_partial" | "asr_final" | "translating" | "done"
}
```

状态机: `asr_partial → asr_final → translating → done`。
悬浮窗按 `id` upsert,据 `status` 决定样式(如未完成显呼吸/省略号)。

---

## 7. 窗口与交互设计

### 7.1 主控窗(常规窗口)

- 开始 / 停止(大按钮 + 全局快捷键)
- 状态指示(采集中 / 识别中 / 错误)
- 设置: 智谱 API key、显示模式(双语/仅译文)、字号、透明度、VAD 灵敏度
- 历史记录: 本场转写+翻译列表,可滚动/搜索/导出(txt / srt)

### 7.2 字幕悬浮窗

Tauri 2 配置/运行时创建,关键属性:

- `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `shadow: false`, `skipTaskbar: true`
- 默认贴屏幕底部居中,呈"字幕条"
- **鼠标穿透:** `set_ignore_cursor_events(true)`;因全穿透就拖不动,用快捷键切换"锁定/可拖"或留一个小抓手
- **盖住全屏:** 设为 non-activating `NSPanel` + window level + `collectionBehavior`(`canJoinAllSpaces | fullScreenAuxiliary | stationary`),否则盖不住全屏 YouTube/会议。**这是 #2 风险(见 §8)。**

---

## 8. 关键技术风险(开工前应 spike 验证)

| #   | 风险                                                         | 影响                   | 缓解                                                     |
| --- | ------------------------------------------------------------ | ---------------------- | -------------------------------------------------------- |
| 1   | ScreenCaptureKit 的 Rust 绑定不成熟,可能要写 Swift/ObjC 桥接 | 拿不到音频流则全盘卡住 | **Phase 0 先 spike**:能稳定取 16kHz PCM(存 wav 可播即过) |
| 2   | 悬浮窗盖不住全屏 app(macOS 全屏是独立 Space)                 | 看视频核心场景失效     | **Phase 0 先 spike**:NSPanel + collectionBehavior        |
| 3   | 句级延迟"同传感"不足                                         | 体验打折               | VAD 调参 + ASR 流式回显;可换流式供应商                   |
| 4   | 30s 切句导致边界丢词                                         | 个别词错漏             | VAD 静音处切 + 前后 padding                              |
| 5   | GLM-ASR / GLM-4.7-Flash 实际延迟、限流、计费未知             | 体验/成本不确定        | **早做接口实测**:打点端到端延迟、压限流                  |
| 6   | GLM-ASR 流式响应格式、音频编码要求文档未尽                   | 联调返工               | 实现前查 API reference + 小样验证                        |

---

## 8.5 Phase 0 Spike 结果(2026-06-07 · 已验证 ✓)

**结论:产品在 macOS 上技术可行,风险 #1 #2 已排除。**

| 验证项 | 结果 |
|---|---|
| 风险 #1 · ScreenCaptureKit 取流 | ✓ `screencapturekit` v7.0.1(crates.io,无需自写 Swift 桥接)。采到 10.34s,**1ch/16000Hz/16bit**,峰值 78.9% / RMS 3759,信号健康 |
| 风险 #2 · 悬浮窗盖全屏 | ✓ `tauri-nspanel`(git `v2.1`)+ `ActivationPolicy::Accessory`。全屏 YouTube 之上可见,鼠标穿透生效 |

**落地技术栈(已锁定):**
- 音频:`screencapturekit = { version="7.0.1", features=["async","macos_13_0"] }`。配置 `with_captures_audio(true).with_sample_rate(48000).with_channel_count(2).with_excludes_current_process_audio(true)`;回调 `audio_buffer_list()` → 每通道 `AudioBuffer::data()` 取 **Float32** 字节 → 下混单声道。
- 重采样:48k→16k 为整 3:1,**spike 用 3 样本均值抽取**即可(暂未引入 rubato;rubato 3.0 API 较重,Phase 1 若需更高质量低通再评估)。
- 悬浮窗:`window.to_panel::<P>()` → `set_level(Floating)` + `set_style_mask(nonactivating_panel)` + `set_collection_behavior(full_screen_auxiliary + can_join_all_spaces)`;穿透 `set_ignore_cursor_events(true)`。

**踩坑记录(避免 Phase 1 重犯):**
1. **Swift 运行时 rpath**:screencapturekit 经 apple-cf/apple-metal Swift 桥接,运行时报 `libswift_Concurrency.dylib not loaded`。修复:`build.rs` 加 `cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift`。
2. **macOS 私有 API**:透明 + NSPanel 需 `tauri.conf.json` 设 `"macOSPrivateApi": true` **且** Cargo `tauri` 开 `features=["macos-private-api"]`,两者缺一编译报错。
3. **权限**:首次采集弹屏幕录制授权(TCC),需授予运行 dev 的程序;capabilities 加 `core:window:allow-set-ignore-cursor-events`。
4. **窗口结构**:`main`(React 控制台)+ `subtitle`(独立透明窗,静态 html,`focus:false`)。

**现有 spike 代码(Phase 1 基础):** `src-tauri/src/audio.rs`(采集→WAV)、`src-tauri/src/overlay.rs`(NSPanel)、`public/subtitle.html`、`src/App.tsx`(控制台)。

---

## 9. 分阶段路线图(每阶段带验收点)

```
Phase 0  可行性 spike(先验最高风险)  ✓ 已完成 2026-06-07(见 §8.5)
  → 验收: Rust 从 ScreenCaptureKit 稳定拿到 16kHz PCM(存 wav 能播)  ✓
  → 验收: 悬浮窗能盖住全屏 YouTube + 鼠标可穿透  ✓

Phase 1  打通链路(先单语英文转写)  ✓ 已完成 2026-06-07
  → 系统音频 → VAD 切句 → GLM-ASR → 悬浮窗显示英文(interim + final)
  → 验收: 放英文视频,字幕实时出现 ✓(asr.rs 流式 + audio.rs 能量 VAD)

Phase 2  加翻译(双语)
  → 整句 final → GLM-4.7-Flash 翻译(带上下文)→ 双语显示
  → 验收: 英文出现后 1~2s 内中文跟上,排版稳定

Phase 3  产品化
  → 主控窗(开始停止/设置/快捷键)、历史记录、密钥安全存储、导出 srt
  → 验收: 能日常拿来看油管学习

Phase 4+ 后续
  → 多语言、选单 app 音源、通用翻译 API(术语表/高质量档)、本地模型(隐私卖点)、会议模式、Windows
```

---

## 10. 待定 / 实现时确认

- GLM-ASR 对采样率/编码/位深(16-bit PCM WAV?)的确切要求(官方未写,需实测)
- GLM-ASR / GLM-4.7-Flash 的限流与端到端延迟实测数据
- VAD 选型最终定(Silero vs webrtc-vad)
- 全屏悬浮窗在 Tauri 2 下的具体实现路径(插件 / 直接 objc)
- 翻译后端 A/B 实测:GLM-4.7-Flash(默认)vs 通用翻译 API `general` —— 比质量 / 端到端延迟 / 限流
