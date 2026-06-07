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

---

## 3. 技术选型

| 模块     | 选型                                        | 说明                                  |
| -------- | ------------------------------------------- | ------------------------------------- |
| 桌面框架 | Tauri 2                                     | 已有骨架。Rust 后端 + React 前端      |
| 前端     | React 19 + Vite + Tailwind 4 + shadcn       | 已有                                  |
| 音频采集 | ScreenCaptureKit (macOS 13+)                | 零配置抓系统音频                      |
| 断句     | 本地 VAD(Silero VAD via ONNX,或 webrtc-vad) | 按静音切句                            |
| ASR      | **智谱 GLM-ASR-2512**                       | HTTP,单段 ≤30s,支持英文,`stream=true` |
| 翻译     | **智谱 GLM-4.7-Flash(免费)**                | OpenAI 兼容,`stream=true`,200K 上下文 |
| 密钥存储 | OS Keychain / Tauri store                   | 智谱 API key,仅存 Rust 侧             |

### 3.1 两个云端模型的关键事实(已核对官方文档)

**GLM-ASR-2512**

- 接口: `POST https://open.bigmodel.cn/api/paas/v4/audio/transcriptions`,`multipart/form-data`,模型名 `glm-asr-2512`
- **硬限制: 单段音频 ≤ 30 秒,文件 ≤ 25 MB** → 必须本地切句后分段上传
- `stream=true`: 单段识别结果流式返回(非无限音频流)
- 语言: 中文(含方言)、**英文**(英美音)、法德日韩西阿等
- 它是 **ASR(转写),不是翻译**,翻译需独立一步(GLM-4.7-Flash)
- ⚠️ 采样率/编码细节、interim/final 字段、价格、延迟:概览页未给,**实现时需查 API reference 实测**

**GLM-4.7-Flash**

- 接口: `POST https://open.bigmodel.cn/api/paas/v4/chat/completions`,OpenAI 兼容
- `stream=true` 支持;上下文 200K,最大输出 128K
- 免费档(具体 RPM/TPM 限流官方未明示,**需实测**)
- 适合翻译;中英翻译质量需实测

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

### 5.2 VAD 切句(Rust)

- 候选: Silero VAD(ONNX,经 `ort` 或 `voice_activity_detector` crate)质量好;`webrtc-vad` 更轻;能量阈值最简(兜底)。
- 逻辑: 30ms 帧检测 → 累积语音帧 → 静音持续 > 阈值(默认 ~600ms)即收一段;段长逼近 ~25s 强制切。
- 每段前后各加少量 padding(~200ms),避免首尾词被削。
- 参数(静音阈值、灵敏度)做成可调,影响"出字幕快慢 vs 句子完整度"。

### 5.3 ASR 调用(Rust)

- 每段: multipart POST 到 GLM-ASR,字段 `model=glm-asr-2512` + WAV(16kHz mono)+ `stream=true`。
- 解析流式响应(SSE/chunked,**具体格式实现时核对 API reference**)→ 累积文本 → 段结束即该句 final。
- 该句获得稳定 id,interim 阶段不断更新 `original`,final 时锁定。

### 5.4 翻译调用(Rust)

- 触发: 某句 ASR final。
- 请求 GLM-4.7-Flash,`stream=true`,system prompt 约束"逐句口语化翻成简洁简体中文,只输出译文";user 内容含**最近 1~2 句原文做上下文**(术语/代词连贯)。
- 维护一个滚动会话上下文(200K 窗口足够放整场)。
- 流式收中文 token → 更新该句 `translated`。

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

## 9. 分阶段路线图(每阶段带验收点)

```
Phase 0  可行性 spike(先验最高风险)
  → 验收: Rust 从 ScreenCaptureKit 稳定拿到 16kHz PCM(存 wav 能播)
  → 验收: 悬浮窗能盖住全屏 YouTube + 鼠标可穿透

Phase 1  打通链路(先单语英文转写)
  → 系统音频 → VAD 切句 → GLM-ASR → 悬浮窗显示英文(interim + final)
  → 验收: 放英文油管,字幕实时出现、延迟可接受、不疯狂跳

Phase 2  加翻译(双语)
  → 整句 final → GLM-4.7-Flash 翻译(带上下文)→ 双语显示
  → 验收: 英文出现后 1~2s 内中文跟上,排版稳定

Phase 3  产品化
  → 主控窗(开始停止/设置/快捷键)、历史记录、密钥安全存储、导出 srt
  → 验收: 能日常拿来看油管学习

Phase 4+ 后续
  → 多语言、选单 app 音源、本地模型(隐私卖点)、会议模式、Windows
```

---

## 10. 待定 / 实现时确认

- GLM-ASR 流式响应的确切 JSON/SSE 结构与字段名
- GLM-ASR 对采样率/编码(16-bit PCM WAV?)的确切要求
- GLM-ASR / GLM-4.7-Flash 的限流与端到端延迟实测数据
- VAD 选型最终定(Silero vs webrtc-vad)
- 全屏悬浮窗在 Tauri 2 下的具体实现路径(插件 / 直接 objc)
