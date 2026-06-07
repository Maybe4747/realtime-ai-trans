# 听译窗 / EchoSub

桌面端 AI 同声传译字幕助手。MVP 使用麦克风输入，将语音分片发送到智谱 `glm-asr-2512` 做语音转文本，再用 `glm-4.7-flash` 翻译并修正最近字幕。

## 当前 MVP

- 麦克风输入
- 源语言 / 目标语言选择
- 主控制窗口
- 真实置顶悬浮字幕窗口
- `draft / stable / revised` 字幕状态
- 本次会话历史面板
- 智谱 API 错误提示

## 环境变量

主进程读取智谱密钥，renderer 不接触密钥。

PowerShell:

```powershell
$env:ZHIPU_API_KEY="your-api-key"
```

## 开发

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm run typecheck
npm run lint
npm run build
```

## 打包

```powershell
npm run build:win
```

## 说明

MVP 只支持麦克风输入。系统音频直采、账号、云端同步、多人协作、会议纪要和复杂语言设置都不在当前范围内。
