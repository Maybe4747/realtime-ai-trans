# AI 同声传译助手落地架构设计文档

## 1. 文档目标

本文档用于指导 AI 同声传译助手的工程实现，目标不是设计一个完整商用系统，而是明确一个可以快速落地、可以演示、后续可扩展的桌面端架构。

技术基础采用 Electron、React、TypeScript、electron-vite。前端组件库采用 shadcn/ui，样式体系采用 Tailwind CSS。架构设计不引入复杂后端，不做账号体系，不做云端存储，优先跑通桌面实时字幕闭环。

## 2. MVP 工程目标

MVP 需要完成的工程闭环：

```text
麦克风音频输入
-> 实时音频分片
-> AI 实时识别与翻译
-> 字幕状态管理
-> 悬浮字幕窗展示
-> 最近字幕自动修正
-> 历史面板回看
```

MVP 默认配置：

```text
源语言：自动识别
目标语言：简体中文
音频来源：麦克风
平台优先级：Windows
AI 服务：智谱 `glm-asr-2512` 负责 ASR，智谱 `glm-4.7-flash` 负责翻译与修正
```

## 3. 工程基础约束

工程采用 Electron 标准分层：

```text
src
├─ main
│  └─ Electron 主进程
├─ preload
│  └─ 安全桥接层
└─ renderer
   └─ React 渲染进程
```

架构约束：

- 主进程负责窗口、会话、AI Provider 和字幕状态。
- Preload 只暴露受控 API。
- Renderer 负责界面、用户交互和麦克风采集。
- 共享类型放在 renderer 与 main 都可引用的位置，避免 IPC 合约分散。

## 4. 总体架构

### 4.0 前端组件库决策

前端组件库使用 shadcn/ui。

选择原因：

- 组件代码直接进入项目，方便开发期间快速改样式和行为。
- 默认基于 Radix primitives，交互和可访问性基础更稳。
- 与 Tailwind CSS 配合，能快速做出克制、清晰的桌面工具界面。
- 不引入重型组件库运行时，适合 Electron 小工具。

MVP 优先添加组件：

```text
button
select
card
badge
scroll-area
separator
tooltip
sheet
switch
slider
```

使用边界：

- 主控制窗口、历史面板、设置项优先使用 shadcn/ui。
- 悬浮字幕窗可以使用 Tailwind 自定义样式，不强行套 Card，避免字幕层变得笨重。
- 图标优先使用 lucide-react。
- 不引入 shadcn 的复杂 dashboard blocks，避免产品偏离“小而美”。

### 4.1 架构分层

```text
┌──────────────────────────────────────────────┐
│ Renderer: React UI                            │
│ - 主控制窗口                                  │
│ - 悬浮字幕窗口                                │
│ - 历史面板                                    │
│ - shadcn/ui 组件与 Tailwind 样式               │
│ - 麦克风采集与 PCM 编码                       │
└───────────────────────┬──────────────────────┘
                        │ typed IPC
┌───────────────────────▼──────────────────────┐
│ Preload: 安全桥接层                            │
│ - 暴露 appApi                                 │
│ - 限制 IPC 通道                                │
│ - 类型声明                                    │
└───────────────────────┬──────────────────────┘
                        │ ipcMain / ipcRenderer
┌───────────────────────▼──────────────────────┐
│ Main: Electron 主进程                          │
│ - 窗口管理                                    │
│ - AI 会话管理                                 │
│ - 字幕状态中心                                │
│ - 配置管理                                    │
│ - 错误与生命周期管理                          │
└───────────────────────┬──────────────────────┘
                        │ WebSocket / HTTPS
┌───────────────────────▼──────────────────────┐
│ AI Provider                                   │
│ - 实时语音识别                                │
│ - 实时翻译                                    │
│ - 上下文修正                                  │
└──────────────────────────────────────────────┘
```

### 4.2 核心原则

- 主进程掌握 AI 服务连接和 API Key，避免密钥暴露到页面侧。
- 渲染进程负责麦克风采集，因为 Chromium 的 `getUserMedia` 和 Web Audio 更容易快速落地。
- Preload 只暴露必要 API，不让 renderer 任意访问 Node 能力。
- 字幕状态集中在主进程维护，主窗口和悬浮窗都订阅同一份状态。
- AI 服务通过 Provider 接口隔离，但 MVP 固定使用智谱，不提供本地替代 Provider。

## 5. 核心运行流程

### 5.1 启动流程

```text
1. app.whenReady
2. 创建主控制窗口
3. 初始化 SubtitleStore
4. 初始化 SessionManager
5. Renderer 加载主界面
6. 用户选择源语言、目标语言
7. 用户点击开始听译
```

### 5.2 听译流程

```text
1. Renderer 请求麦克风权限
2. Renderer 创建 AudioContext
3. AudioWorklet 或 ScriptProcessor 将音频转成 PCM16 分片
4. Renderer 通过 IPC 发送 audio:chunk
5. Main 创建 AI 实时会话
6. Main 转发音频分片到 AI Provider
7. AI Provider 返回识别、翻译、修正事件
8. Main 归一化为 SubtitleEvent
9. SubtitleStore 更新字幕状态
10. Main 广播字幕状态到主窗口和悬浮窗
```

### 5.3 停止流程

```text
1. 用户点击暂停或停止
2. Renderer 停止麦克风采集
3. Main 停止接收 audio:chunk
4. SessionManager 关闭 AI 会话
5. SubtitleStore 保留本次会话历史
6. UI 状态变为 paused 或 idle
```

## 6. 窗口设计

### 6.1 主控制窗口

职责：

- 展示产品主界面。
- 控制开始、暂停、继续。
- 选择源语言和目标语言。
- 查看连接状态。
- 打开或隐藏字幕悬浮窗。
- 查看字幕历史。

Electron 配置建议：

```ts
const mainWindow = new BrowserWindow({
  width: 420,
  height: 560,
  minWidth: 360,
  minHeight: 480,
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
})
```

### 6.2 悬浮字幕窗口

职责：

- 展示主字幕和上一句字幕。
- 置顶显示。
- 支持拖动。
- 低打扰，不显示复杂控制。

Electron 配置建议：

```ts
const overlayWindow = new BrowserWindow({
  width: 860,
  height: 160,
  frame: false,
  transparent: true,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
})
```

渲染方式：

同一个 React 应用可以根据 URL hash 渲染不同界面：

```text
/#/main       主控制窗口
/#/overlay    悬浮字幕窗口
```

这样无需引入复杂路由，也能复用状态订阅和组件。

## 7. 模块拆分

建议新增目录：

```text
src
├─ main
│  ├─ index.ts
│  ├─ windows
│  │  ├─ createMainWindow.ts
│  │  └─ createOverlayWindow.ts
│  ├─ ipc
│  │  └─ registerIpcHandlers.ts
│  ├─ session
│  │  ├─ SessionManager.ts
│  │  └─ RealtimeProvider.ts
│  ├─ subtitles
│  │  ├─ SubtitleStore.ts
│  │  └─ revision.ts
│  └─ config
│     └─ appConfig.ts
├─ preload
│  ├─ index.ts
│  └─ index.d.ts
└─ renderer
   └─ src
      ├─ App.tsx
      ├─ app
      │  ├─ MainView.tsx
      │  └─ OverlayView.tsx
      ├─ components
      │  ├─ ui
      │  │  ├─ button.tsx
      │  │  ├─ select.tsx
      │  │  └─ ...
      │  ├─ ControlPanel.tsx
      │  ├─ LanguageSelect.tsx
      │  ├─ SubtitleOverlay.tsx
      │  └─ HistoryPanel.tsx
      ├─ hooks
      │  ├─ useAudioCapture.ts
      │  └─ useSubtitleEvents.ts
      ├─ audio
      │  ├─ audioCapture.ts
      │  └─ pcm.ts
      ├─ state
      │  └─ subtitleReducer.ts
      ├─ lib
      │  └─ utils.ts
      └─ types
         └─ shared.ts
```

### 7.1 Main 进程模块

#### WindowManager

职责：

- 创建主窗口。
- 创建、显示、隐藏悬浮字幕窗口。
- 向所有窗口广播字幕事件。
- 处理窗口生命周期。

#### SessionManager

职责：

- 创建实时 AI 会话。
- 根据源语言和目标语言配置 Provider。
- 接收音频分片。
- 关闭或重启会话。
- 将 AI 原始事件转换成标准事件。

#### RealtimeProvider

职责：

- 隔离具体 AI 服务。
- 维护 WebSocket 或 HTTP 流连接。
- 提供统一方法：

```ts
interface RealtimeProvider {
  start(options: StartSessionOptions): Promise<void>
  sendAudio(chunk: AudioChunk): void
  stop(): Promise<void>
  onEvent(callback: (event: ProviderEvent) => void): void
  onError(callback: (error: ProviderError) => void): void
}
```

#### SubtitleStore

职责：

- 保存活跃会话的字幕列表。
- 管理 `draft`、`stable`、`revised` 状态。
- 接收新增、更新、修正事件。
- 向窗口广播完整或增量状态。

### 7.2 Preload 模块

Preload 只暴露一个 `window.appApi`，不要让 renderer 直接访问任意 IPC。

建议 API：

```ts
type AppApi = {
  startSession(options: StartSessionOptions): Promise<void>
  stopSession(): Promise<void>
  pauseSession(): Promise<void>
  sendAudioChunk(chunk: ArrayBuffer): void
  showOverlay(): Promise<void>
  hideOverlay(): Promise<void>
  setOverlayBounds(bounds: OverlayBounds): Promise<void>
  onSessionEvent(callback: (event: SessionEvent) => void): Unsubscribe
  onSubtitleEvent(callback: (event: SubtitleEvent) => void): Unsubscribe
}
```

### 7.3 Renderer 模块

#### MainView

职责：

- 语言选择。
- 开始、暂停按钮。
- 状态展示。
- 历史面板。
- 简单错误提示。

#### OverlayView

职责：

- 展示最近字幕。
- 展示修正高亮。
- 提供拖动区域。
- 订阅字幕事件。

#### useAudioCapture

职责：

- 请求麦克风权限。
- 开启 AudioContext。
- 将音频转成 AI 服务可用的 PCM16。
- 定时发送小分片。
- 停止采集并释放资源。

### 7.4 shadcn/ui 落地方式

本项目使用 npm，因此初始化和添加组件时使用 npx：

```bash
npx shadcn@latest init
npx shadcn@latest add button select card badge scroll-area separator tooltip sheet switch slider
```

初始化建议：

- `style` 使用默认风格即可。
- `baseColor` 建议选择 neutral，适合桌面工具。
- `components` 目录使用 `src/renderer/src/components`。
- `utils` 文件使用 `src/renderer/src/lib/utils.ts`。
- Tailwind 配置只服务 renderer，不影响 main/preload。

组件使用约束：

- `Button` 用于开始、暂停、重试、复制等明确命令。
- `Select` 用于源语言和目标语言选择。
- `Badge` 用于状态，例如聆听中、已暂停、已修正。
- `Sheet` 用于历史面板或轻设置面板。
- `ScrollArea` 用于字幕历史列表。
- `Tooltip` 用于图标按钮说明。
- `Switch` 用于置顶、显示原文等二元设置。
- `Slider` 用于字幕字号等数值设置。
- `Card` 只用于主窗口内的局部信息块，不用于悬浮字幕窗主体。

悬浮字幕窗优先使用手写 Tailwind 样式，保持透明、轻量、低干扰。

## 8. 数据模型

### 8.1 语言配置

```ts
type LanguageCode = 'auto' | 'zh-CN' | 'en' | 'ja' | 'ko'

interface LanguageOption {
  code: LanguageCode
  label: string
}

interface TranslationConfig {
  sourceLanguage: LanguageCode
  targetLanguage: Exclude<LanguageCode, 'auto'>
}
```

### 8.2 会话状态

```ts
type SessionStatus =
  | 'idle'
  | 'requesting-permission'
  | 'connecting'
  | 'listening'
  | 'paused'
  | 'error'

interface SessionState {
  sessionId?: string
  status: SessionStatus
  config: TranslationConfig
  startedAt?: number
  error?: string
}
```

### 8.3 音频分片

```ts
interface AudioChunk {
  sessionId: string
  sampleRate: number
  channels: 1
  format: 'pcm16'
  data: ArrayBuffer
  timestamp: number
}
```

建议采样参数：

```text
sampleRate: 16000 或 24000
channels: 1
format: pcm16 little-endian
chunk: 100ms 到 250ms
```

MVP 统一采集并下采样为 16kHz 单声道 PCM16，由主进程封装为 WAV 后提交给智谱 `glm-asr-2512`。

### 8.4 字幕模型

```ts
type SubtitleStatus = 'draft' | 'stable' | 'revised'

interface SubtitleItem {
  id: string
  sessionId: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  sourceText?: string
  translatedText: string
  status: SubtitleStatus
  startedAt: number
  endedAt?: number
  updatedAt: number
  revisionCount: number
}
```

### 8.5 字幕事件

```ts
type SubtitleEvent =
  | {
      type: 'subtitle:draft'
      item: SubtitleItem
    }
  | {
      type: 'subtitle:stable'
      item: SubtitleItem
    }
  | {
      type: 'subtitle:revised'
      item: SubtitleItem
      previousText: string
    }
  | {
      type: 'subtitle:clear'
      sessionId: string
    }
```

## 9. IPC 合约

### 9.1 Renderer -> Main

```text
session:start
session:pause
session:stop
audio:chunk
overlay:show
overlay:hide
overlay:set-bounds
history:clear
```

### 9.2 Main -> Renderer

```text
session:event
subtitle:event
subtitle:snapshot
overlay:event
app:error
```

### 9.3 约束

- `audio:chunk` 高频发送，不要等待 Promise 返回。
- 控制类 IPC 使用 `invoke/handle`，音频类 IPC 使用 `send/on`。
- Main 收到非活跃 sessionId 的音频分片直接丢弃。
- 所有事件都带 `sessionId`，避免旧会话事件污染新会话。

## 10. AI Provider 设计

### 10.1 为什么放在主进程

AI Provider 放在主进程有三个好处：

- API Key 不进入 renderer。
- WebSocket 生命周期不受 UI 重新渲染影响。
- 主窗口和悬浮窗可以共享一个会话。

### 10.2 Provider 输入

```ts
interface StartSessionOptions {
  sessionId: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  sampleRate: number
}
```

### 10.3 Provider 输出

Provider 不直接操作 UI，只输出标准事件：

```ts
type ProviderEvent =
  | {
      type: 'transcript.delta'
      text: string
      isFinal: false
    }
  | {
      type: 'transcript.completed'
      text: string
      isFinal: true
    }
  | {
      type: 'translation.delta'
      text: string
      isFinal: false
    }
  | {
      type: 'translation.completed'
      sourceText?: string
      translatedText: string
      isFinal: true
    }
  | {
      type: 'translation.revised'
      targetSubtitleId: string
      translatedText: string
    }
```

### 10.4 实现策略

MVP 固定使用智谱 ASR + LLM 分离链路，不实现本地替代 Provider，也不在本地生成假字幕。

```text
麦克风 PCM16 分片
-> 主进程按时间窗封装 WAV
-> 智谱 `glm-asr-2512` 语音转文本
-> 智谱 `glm-4.7-flash` 翻译当前文本并修正最近 1 到 3 句
-> SubtitleStore 写入 draft / stable / revised
-> 主窗口与悬浮字幕窗口同步展示
```

`glm-asr-2512` 使用智谱音频转文本接口。`glm-4.7-flash` 使用智谱 Chat Completions 接口，提示词要求返回目标语言译文和可选的前文修正结果。没有有效 API Key、网络不可用或 API 返回异常时，应用进入 `error` 状态并提示用户，不输出替代字幕。

## 11. 字幕修正策略

### 11.1 状态流转

```text
draft -> stable -> revised
```

含义：

- `draft`：正在生成，允许频繁变化。
- `stable`：一句话结束，已经可以进入历史。
- `revised`：后续上下文让系统修正了这句。

### 11.2 修正窗口

只允许修正最近一到三句，或者最近 15 秒内的字幕。

```ts
const REVISION_MAX_ITEMS = 3
const REVISION_MAX_AGE_MS = 15_000
```

### 11.3 修正触发

触发修正的时机：

- 新的完整句子结束。
- AI Provider 明确返回 revision 事件。
- 识别文本和翻译文本存在明显上下文补全。

### 11.4 UI 表现

修正不能打断用户观看。

建议：

- 字幕被修正时短暂高亮 800ms。
- 历史面板显示“已修正”标记。
- 不弹 Toast。
- 不播放声音。

### 11.5 替换规则

SubtitleStore 处理规则：

```text
1. 如果 targetSubtitleId 存在，直接替换对应 item。
2. 如果不存在，找最近 stable item。
3. 如果新旧文本差异很小，不触发 revised。
4. 如果字幕已经超过修正窗口，不再修改。
```

## 12. 音频采集设计

### 12.1 MVP 音频来源

第一版只承诺麦克风输入。

原因：

- Electron renderer 可以直接使用 `navigator.mediaDevices.getUserMedia`。
- Windows 系统音频直采涉及 loopback 或虚拟设备，实现风险较高。
- 演示可以通过电脑外放加麦克风完成闭环。

### 12.2 采集流程

```text
getUserMedia({ audio: true })
-> AudioContext
-> AudioWorkletProcessor
-> Float32 PCM
-> downsample
-> Int16 PCM
-> IPC audio:chunk
```

### 12.3 AudioWorklet

MVP 使用 `AudioWorklet` 采集麦克风音频并输出 PCM16 分片。若浏览器运行环境不支持 `AudioWorklet`，应用应给出明确错误，不使用本地假数据替代真实音频。

## 13. 配置与密钥

### 13.1 API Key 来源

MVP 使用环境变量：

```text
ZHIPU_API_KEY
```

主进程读取环境变量，renderer 不读取。

### 13.2 本地配置

第一版可用 renderer state 或 localStorage 保存以下轻量配置：

```text
sourceLanguage
targetLanguage
overlayPosition
fontSize
```

若需要更稳，可以后续引入 `electron-store`。MVP 不是必须。

## 14. 错误处理

### 14.1 错误类型

```ts
type AppErrorCode =
  | 'MIC_PERMISSION_DENIED'
  | 'MIC_NOT_FOUND'
  | 'AI_CONNECT_FAILED'
  | 'AI_AUTH_FAILED'
  | 'AI_STREAM_CLOSED'
  | 'AUDIO_ENCODER_FAILED'
  | 'UNKNOWN'
```

### 14.2 UI 策略

主窗口显示明确错误：

```text
麦克风权限未开启
未检测到麦克风
AI 服务连接失败
密钥无效
连接已断开，点击重试
```

悬浮窗只显示轻提示或状态点，不承载完整错误说明。

### 14.3 自动恢复

MVP 只做有限恢复：

- AI 连接断开后，停止会话并提示重试。
- 麦克风失败后，提示用户重新授权。
- 不做复杂重连队列。

## 15. 实施顺序

### 阶段一：跑通链路

目标：能听到麦克风并生成字幕。

任务：

- 初始化 Tailwind CSS 与 shadcn/ui。
- 添加 MVP 必需的 shadcn/ui 组件。
- 替换模板 UI 为主控制窗口。
- 增加语言选择控件。
- 实现 preload 的基础 API。
- 实现麦克风采集。
- 实现 SessionManager。
- 接入智谱 `glm-asr-2512` ASR。
- 接入智谱 `glm-4.7-flash` 翻译与修正。

验收：

```text
点击开始 -> 麦克风采集 -> AI 返回 -> 主窗口出现字幕
```

### 阶段二：桌面形态

目标：做出可用的悬浮字幕助手。

任务：

- 创建 overlay BrowserWindow。
- 实现 OverlayView。
- 实现 SubtitleStore。
- 实现 draft/stable 状态。
- 实现历史面板。
- 补齐基础错误状态。
- 优化字幕刷新频率。

验收：

```text
播放外语内容 -> 悬浮窗实时显示目标语言字幕 -> 历史面板可回看
```

### 阶段三：修正能力与演示

目标：让产品亮点成立。

任务：

- 实现 revised 状态。
- 实现最近一到三句修正。
- 加入修正高亮。
- 准备稳定 Demo 音频或视频。
- 优化悬浮窗视觉。
- 补 README 演示说明。

验收：

```text
Demo 中至少出现一次前文字幕被自动修正
```

## 16. 可测试点

MVP 不追求完整测试覆盖，但需要保留几个关键测试点。

### 16.1 单元测试优先级

优先测纯逻辑：

- `SubtitleStore` 新增 draft。
- draft 转 stable。
- stable 被 revised 替换。
- 超过窗口的字幕不被修正。
- 不同 sessionId 的事件不会互相污染。

### 16.2 手工验收清单

```text
[ ] 应用能启动
[ ] 主窗口显示语言选择
[ ] 点击开始后请求麦克风权限
[ ] 麦克风有音频分片输出
[ ] AI 会话能建立
[ ] 主窗口能显示字幕
[ ] 悬浮窗能显示字幕
[ ] 暂停后不再发送音频
[ ] 历史面板能查看字幕
[ ] 最近字幕能被修正
[ ] 错误状态可读
```

## 17. 风险与处理方案

### 17.1 智谱 API 请求失败

处理：

- 进入 `error` 状态。
- 停止向 Provider 发送新的音频分片。
- 在主窗口显示短错误，例如“AI 服务连接失败”或“密钥无效”。
- 不生成本地替代字幕。

### 17.2 麦克风采集质量差

处理：

- 使用本地准备好的英文音频。
- 在 Demo 时靠近音源。
- 增加输入音量提示，但不做复杂降噪。

### 17.3 修正质量不稳定

处理：

- 始终由 `glm-4.7-flash` 基于最近 1 到 3 句上下文生成修正建议。
- SubtitleStore 只接受文本差异足够明显、仍在修正窗口内的修正。
- UI 使用 `revised` 状态轻微高亮，不用弹窗打断用户。

### 17.4 系统音频需求被追问

回答策略：

MVP 优先麦克风输入，因为目标是验证“实时字幕 + 自动修正”的核心体验。系统音频直采是后续扩展能力，不影响产品闭环。

## 18. 已定约束

1. AI 服务使用智谱：`glm-asr-2512` 负责语音转文本，`glm-4.7-flash` 负责翻译与修正。
2. MVP 优先 Windows。
3. MVP 只支持麦克风输入，系统音频直采放到后续扩展。
4. 默认语言候选保留“自动识别、英语、日语、韩语、简体中文”。
5. MVP 默认只展示目标语言字幕，历史面板可显示原文。

## 19. 推荐拍板

为了稳定交付，推荐拍板如下：

```text
平台：Windows 优先
输入：麦克风优先
窗口：主控制窗口 + 透明悬浮字幕窗口
语言：源语言自动识别，目标语言默认简体中文
AI：主进程接入智谱 `glm-asr-2512` + `glm-4.7-flash`
状态：draft / stable / revised
历史：本次会话内历史
存储：不做云端，不做账号
```

这套架构足够简单，能支撑 Demo，也为后续系统音频、更多语言、术语表、导出和摘要保留扩展位置。
