import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ActivityIcon,
  CaptionsIcon,
  FileAudioIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ChevronDownIcon,
  PlayIcon,
  SettingsIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import "./App.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type Status = "idle" | "running";
type View = "home" | "history" | "toolsText" | "toolsAudio" | "settings";

type AppConfig = {
  asrProvider: string;
  asrApiKey: string;
  llmProvider: string;
  llmApiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  subtitleMode: string;
  minDwellMs: number;
  maxDwellMs: number;
  maxQueue: number;
  subtitleFontSize: number;
  subtitleOriginalColor: string;
  subtitleTranslatedColor: string;
  subtitleBackgroundColor: string;
  subtitleBackgroundOpacity: number;
  saveHistory: boolean;
};

type SubtitleEvent = {
  id: number;
  original: string;
  translated: string;
  status: string;
};

type CaptureStateEvent = {
  running: boolean;
  message: string;
};

type AudioToolResult = {
  original: string;
  translated: string;
};

type TranslationHistoryItem = {
  id: number;
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
};

const defaultConfig: AppConfig = {
  asrProvider: "zhipu_glm_asr",
  asrApiKey: "",
  llmProvider: "deepseek_v4_flash",
  llmApiKey: "",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  subtitleMode: "bilingual",
  minDwellMs: 1800,
  maxDwellMs: 4200,
  maxQueue: 5,
  subtitleFontSize: 30,
  subtitleOriginalColor: "#1d1d1f",
  subtitleTranslatedColor: "#111113",
  subtitleBackgroundColor: "#ffffff",
  subtitleBackgroundOpacity: 92,
  saveHistory: true,
};

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboardIcon }> = [
  { id: "home", label: "首页", icon: LayoutDashboardIcon },
  { id: "history", label: "历史", icon: HistoryIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

const toolItems: Array<{ id: View; label: string; icon: typeof LayoutDashboardIcon }> = [
  { id: "toolsText", label: "文本翻译", icon: WrenchIcon },
  { id: "toolsAudio", label: "音频转文字", icon: FileAudioIcon },
];

const languageOptions = [
  { value: "auto", label: "自动识别" },
  { value: "en", label: "英文" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "ja", label: "日文" },
  { value: "ko", label: "韩文" },
  { value: "es", label: "西班牙文" },
  { value: "fr", label: "法文" },
  { value: "de", label: "德文" },
];

function languageLabel(value: string) {
  return languageOptions.find((item) => item.value === value)?.label || value;
}

function App() {
  const [view, setView] = useState<View>("home");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [clickThrough, setClickThrough] = useState(true);
  const [lastEn, setLastEn] = useState("");
  const [lastZh, setLastZh] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const configured = Boolean(config.asrApiKey.trim() && config.llmApiKey.trim());
  const inTools = view === "toolsText" || view === "toolsAudio";

  const statusLabel = useMemo(() => {
    if (status === "running") return "采集中";
    if (!configured) return "待配置";
    return "待机";
  }, [configured, status]);

  useEffect(() => {
    invoke<AppConfig>("get_app_config")
      .then((saved) => setConfig(saved))
      .catch((e) => setMsg(`配置读取失败: ${e}`));
    loadHistory();
  }, []);

  useEffect(() => {
    const un = listen<SubtitleEvent>("subtitle", (e) => {
      const p = e.payload;
      if (p.status === "error") {
        setMsg(`错误: ${p.original} ${p.translated}`);
        return;
      }
      if (p.original) setLastEn(p.original);
      if (p.translated) setLastZh(p.translated);
      if (config.saveHistory && p.status === "done" && p.original && p.translated) {
        setHistory((items) => [
          {
            id: Date.now(),
            original: p.original,
            translated: p.translated,
            sourceLanguage: config.sourceLanguage,
            targetLanguage: config.targetLanguage,
            createdAt: new Date().toISOString(),
          },
          ...items,
        ].slice(0, 50));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [config.saveHistory, config.sourceLanguage, config.targetLanguage]);

  useEffect(() => {
    const un = listen<CaptureStateEvent>("capture_state", (e) => {
      setStatus(e.payload.running ? "running" : "idle");
      if (e.payload.message) setMsg(e.payload.message);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setMsg("");
    try {
      if (status === "idle") {
        await invoke("start_capture");
        setStatus("running");
        setMsg("正在同传系统音频");
      } else {
        await invoke("stop_capture");
        setStatus("idle");
        setMsg("已停止");
      }
    } catch (e) {
      setStatus("idle");
      setMsg(`错误: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleClickThrough() {
    const next = !clickThrough;
    try {
      await invoke("set_subtitle_click_through", { ignore: next });
      setClickThrough(next);
    } catch (e) {
      setMsg(`错误: ${e}`);
    }
  }

  async function saveConfig(nextConfig = config, successMessage = "设置已保存") {
    setSaving(true);
    setMsg("");
    try {
      const saved = await invoke<AppConfig>("save_app_config", { config: nextConfig });
      setConfig(saved);
      setMsg(successMessage);
    } catch (e) {
      setMsg(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function saveLanguage(sourceLanguage: string, targetLanguage: string) {
    const nextConfig = { ...config, sourceLanguage, targetLanguage };
    setConfig(nextConfig);
    await saveConfig(nextConfig, "翻译语言已保存");
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const items = await invoke<TranslationHistoryItem[]>("get_translation_history", { limit: 50 });
      setHistory(items);
    } catch (e) {
      setMsg(`历史读取失败: ${e}`);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <main className="console-shell">
      <aside className="console-sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>LUMEN</h1>
            <p>实时双语字幕</p>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.slice(0, 2).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </button>
            );
          })}
          <div className="nav-group">
            <button
              className={`nav-item nav-parent ${inTools ? "active" : ""}`}
              onClick={() => setToolsOpen((open) => !open)}
              aria-expanded={toolsOpen}
            >
              <WrenchIcon data-icon="inline-start" />
              工具
              <ChevronDownIcon className={`nav-chevron ${toolsOpen ? "open" : ""}`} />
            </button>
            {toolsOpen && (
              <div className="nav-sublist">
                {toolItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={`nav-item nav-subitem ${view === item.id ? "active" : ""}`}
                      onClick={() => setView(item.id)}
                    >
                      <Icon data-icon="inline-start" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {navItems.slice(2).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <Badge variant={status === "running" ? "default" : "secondary"}>{statusLabel}</Badge>
          <p>{configured ? "服务已连接，可以开始使用" : "请先完成服务设置"}</p>
        </div>
      </aside>

      <section className="console-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">控制台</p>
            <h2>
              {view === "home"
                ? "实时同传"
                : view === "history"
                  ? "翻译历史"
                  : view === "toolsText"
                    ? "文本翻译"
                    : view === "toolsAudio"
                      ? "音频转文字"
                      : "设置"}
            </h2>
          </div>
          <Button onClick={toggle} disabled={busy || (!configured && status === "idle")} variant={status === "running" ? "destructive" : "default"}>
            {status === "running" ? <SquareIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            {status === "running" ? "停止" : "开始同传"}
          </Button>
        </header>

        <div className="content-scroll">
          {view === "home" && (
            <HomeView
              statusLabel={statusLabel}
              configured={configured}
              lastEn={lastEn}
              lastZh={lastZh}
              clickThrough={clickThrough}
              sourceLanguage={config.sourceLanguage}
              targetLanguage={config.targetLanguage}
              saving={saving}
              onToggleClickThrough={toggleClickThrough}
              onLanguageChange={saveLanguage}
            />
          )}
          {view === "history" && <HistoryView items={history} loading={historyLoading} onRefresh={loadHistory} />}
          {view === "toolsText" && <TextToolView configured={configured} />}
          {view === "toolsAudio" && <AudioToolView configured={configured} />}
          {view === "settings" && (
            <SettingsView
              config={config}
              saving={saving}
              onChange={updateConfig}
              onSave={saveConfig}
            />
          )}

          {msg && <p className={`console-message ${msg.startsWith("错误") || msg.startsWith("保存失败") ? "error" : ""}`}>{msg}</p>}
        </div>
      </section>
    </main>
  );
}

function HomeView({
  statusLabel,
  configured,
  lastEn,
  lastZh,
  clickThrough,
  sourceLanguage,
  targetLanguage,
  saving,
  onToggleClickThrough,
  onLanguageChange,
}: {
  statusLabel: string;
  configured: boolean;
  lastEn: string;
  lastZh: string;
  clickThrough: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  saving: boolean;
  onToggleClickThrough: () => void;
  onLanguageChange: (sourceLanguage: string, targetLanguage: string) => void;
}) {
  const stats = [
    { label: "累计使用时长", value: "0h 00m", hint: "从保存的使用记录统计" },
    { label: "翻译字数", value: "0", hint: "已处理的译文字数" },
    { label: "字幕句数", value: "0", hint: "已生成的字幕数量" },
    { label: "覆盖内容", value: "0m", hint: "已识别的音频时长" },
  ];

  return (
    <div className="view-stack">
      <div className="hero-grid">
        <Card className="hero-card">
          <CardHeader>
            <CardDescription>当前状态</CardDescription>
            <CardTitle>{statusLabel}</CardTitle>
          </CardHeader>
          <CardContent className="hero-content">
            <div className="pulse-line">
              <ActivityIcon data-icon="inline-start" />
              <span>{configured ? "可以开始识别系统声音" : "请先在设置中填写访问密钥"}</span>
            </div>
            <Button variant="outline" onClick={onToggleClickThrough}>
              <CaptionsIcon data-icon="inline-start" />
              鼠标穿透: {clickThrough ? "开" : "关"}
            </Button>
            <div className="quick-language">
              <label>
                <span>输入语言</span>
                <select
                  value={sourceLanguage}
                  disabled={saving}
                  onChange={(e) => onLanguageChange(e.target.value, targetLanguage)}
                >
                  {languageOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>目标语言</span>
                <select
                  value={targetLanguage}
                  disabled={saving}
                  onChange={(e) => onLanguageChange(sourceLanguage, e.target.value)}
                >
                  {languageOptions.filter((item) => item.value !== "auto").map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <small>{saving ? "正在保存" : "修改后自动保存"}</small>
            </div>
          </CardContent>
        </Card>

        <div className="stats-grid">
          {stats.map((item) => (
            <Card key={item.label} size="sm">
              <CardHeader>
                <CardDescription>{item.label}</CardDescription>
                <CardTitle>{item.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="muted">{item.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近字幕</CardTitle>
          <CardDescription>显示最近识别到的一句内容</CardDescription>
        </CardHeader>
        <CardContent className="subtitle-preview">
          <p className="preview-en">{lastEn || "等待系统音频输入"}</p>
          <p className="preview-zh">{lastZh || "翻译结果会显示在这里"}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryView({
  items,
  loading,
  onRefresh,
}: {
  items: TranslationHistoryItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>历史记录</CardTitle>
        <CardDescription>最近保存的识别和翻译内容。</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <div className="history-list">
            <div className="history-toolbar">
              <span>{items.length} 条记录</span>
              <Button variant="outline" onClick={onRefresh} disabled={loading}>
                {loading ? "刷新中" : "刷新"}
              </Button>
            </div>
            {items.map((item) => (
              <article className="history-item" key={`${item.id}-${item.createdAt}`}>
                <div className="history-meta">
                  <span>{formatHistoryTime(item.createdAt)}</span>
                  <span>{languageLabel(item.sourceLanguage)} → {languageLabel(item.targetLanguage)}</span>
                </div>
                <p className="history-original">{item.original}</p>
                <p className="history-translated">{item.translated}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <HistoryIcon />
            <p>{loading ? "正在读取历史记录" : "暂无历史记录"}</p>
            <span>开始一次同传后，识别和翻译内容会在这里显示。</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TextToolView({ configured }: { configured: boolean }) {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const [toolMsg, setToolMsg] = useState("");

  async function runTextTranslate() {
    setToolMsg("");
    setTranslatedText("");
    if (!sourceText.trim()) {
      setToolMsg("请输入需要翻译的内容");
      return;
    }
    setTextBusy(true);
    try {
      const result = await invoke<string>("translate_text_tool", { text: sourceText });
      setTranslatedText(result);
    } catch (e) {
      setToolMsg(`处理失败: ${e}`);
    } finally {
      setTextBusy(false);
    }
  }

  return (
    <div className="tool-page">
      <Card>
        <CardHeader>
          <CardTitle>文本翻译</CardTitle>
          <CardDescription>粘贴英文内容，快速翻译成中文。</CardDescription>
        </CardHeader>
        <CardContent className="tool-stack">
          <textarea
            className="tool-textarea"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="在这里粘贴要翻译的英文文本"
          />
          <div className="tool-actions">
            <Button onClick={runTextTranslate} disabled={!configured || textBusy}>
              {textBusy ? "翻译中" : "翻译文本"}
            </Button>
            <Button variant="outline" onClick={() => {
              setSourceText("");
              setTranslatedText("");
              setToolMsg("");
            }}>
              清空
            </Button>
          </div>
          {translatedText && (
            <div className="tool-output">
              <p className="tool-output-title">译文</p>
              <p>{translatedText}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {!configured && (
        <p className="console-message error">请先在设置中填写访问密钥。</p>
      )}
      {toolMsg && <p className={`console-message ${toolMsg.startsWith("处理失败") ? "error" : ""}`}>{toolMsg}</p>}
    </div>
  );
}

function AudioToolView({ configured }: { configured: boolean }) {
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioTranslate, setAudioTranslate] = useState(true);
  const [audioFileName, setAudioFileName] = useState("");
  const [audioResult, setAudioResult] = useState<AudioToolResult | null>(null);
  const [toolMsg, setToolMsg] = useState("");

  async function runAudioTool(file: File | null) {
    setToolMsg("");
    setAudioResult(null);
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setToolMsg("请选择音频文件");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setToolMsg("文件过大，请选择 25MB 以内的音频文件");
      return;
    }
    setAudioBusy(true);
    setAudioFileName(file.name);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await invoke<AudioToolResult>("process_audio_tool", {
        request: {
          fileName: file.name,
          mimeType: file.type || "audio/wav",
          bytes,
          translate: audioTranslate,
        },
      });
      setAudioResult(result);
    } catch (e) {
      setToolMsg(`处理失败: ${e}`);
    } finally {
      setAudioBusy(false);
    }
  }

  return (
    <div className="tool-page">
      <Card>
        <CardHeader>
          <CardTitle>音频转文字</CardTitle>
          <CardDescription>上传音频文件，提取文字，也可以同时翻译。</CardDescription>
        </CardHeader>
        <CardContent className="tool-stack">
          <label className="upload-box">
            <FileAudioIcon />
            <span>{audioFileName || "选择音频文件"}</span>
            <small>支持常见音频格式，单个文件不超过 25MB。</small>
            <input
              type="file"
              accept="audio/*"
              disabled={!configured || audioBusy}
              onChange={(e) => runAudioTool(e.target.files?.[0] || null)}
            />
          </label>
          <div className="switch-row compact">
            <div>
              <p>同时翻译</p>
              <span>开启后会输出原文和中文译文。</span>
            </div>
            <Switch checked={audioTranslate} onCheckedChange={(checked) => setAudioTranslate(Boolean(checked))} />
          </div>
          {audioBusy && <p className="muted">正在处理音频，请稍等。</p>}
          {audioResult && (
            <div className="tool-output">
              <p className="tool-output-title">原文</p>
              <p>{audioResult.original}</p>
              {audioResult.translated && (
                <>
                  <p className="tool-output-title">译文</p>
                  <p>{audioResult.translated}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!configured && (
        <p className="console-message error">请先在设置中填写访问密钥。</p>
      )}
      {toolMsg && <p className={`console-message ${toolMsg.startsWith("处理失败") ? "error" : ""}`}>{toolMsg}</p>}
    </div>
  );
}

function SettingsView({
  config,
  saving,
  onChange,
  onSave,
}: {
  config: AppConfig;
  saving: boolean;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  onSave: () => void;
}) {
  return (
    <div className="settings-page">
      <div className="settings-savebar">
        <div>
          <p>设置</p>
          <span>修改服务连接或字幕显示后，点击右侧按钮保存。</span>
        </div>
        <Button onClick={onSave} disabled={saving}>
          <KeyRoundIcon data-icon="inline-start" />
          {saving ? "保存中" : "保存设置"}
        </Button>
      </div>

      <div className="settings-grid">
        <Card>
          <CardHeader>
            <CardTitle>服务连接</CardTitle>
            <CardDescription>需要填写两个密钥：一个把声音转成文字，一个把文字翻译成中文。</CardDescription>
          </CardHeader>
          <CardContent className="form-grid">
            <label className="field">
              <span>语音识别服务</span>
              <select value={config.asrProvider} onChange={(e) => onChange("asrProvider", e.target.value)}>
                <option value="zhipu_glm_asr">智谱 GLM-ASR</option>
              </select>
              <small>用于识别系统声音里的英文内容。</small>
            </label>
            <label className="field">
              <span>智谱 API Key</span>
              <Input
                type="password"
                value={config.asrApiKey}
                onChange={(e) => onChange("asrApiKey", e.target.value)}
                placeholder="填入智谱开放平台的 API Key"
              />
            </label>
            <label className="field">
              <span>翻译服务</span>
              <select value={config.llmProvider} onChange={(e) => onChange("llmProvider", e.target.value)}>
                <option value="deepseek_v4_flash">DeepSeek</option>
              </select>
              <small>用于把识别出的英文翻译成中文。</small>
            </label>
            <label className="field">
              <span>DeepSeek API Key</span>
              <Input
                type="password"
                value={config.llmApiKey}
                onChange={(e) => onChange("llmApiKey", e.target.value)}
                placeholder="填入 DeepSeek 平台的 API Key"
              />
            </label>
            <p className="save-hint">填写或更换密钥后，需要保存设置才会生效。</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>翻译语言</CardTitle>
            <CardDescription>选择输入内容的语言，以及字幕要输出的语言。</CardDescription>
          </CardHeader>
          <CardContent className="form-grid">
            <label className="field">
              <span>输入语言</span>
              <select value={config.sourceLanguage} onChange={(e) => onChange("sourceLanguage", e.target.value)}>
                {languageOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <small>系统音频一般选择英文；不确定时可选择自动识别。</small>
            </label>
            <label className="field">
              <span>目标语言</span>
              <select value={config.targetLanguage} onChange={(e) => onChange("targetLanguage", e.target.value)}>
                {languageOptions.filter((item) => item.value !== "auto").map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <small>翻译字幕会按这里选择的语言输出。</small>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>字幕显示</CardTitle>
            <CardDescription>调整字幕的显示方式和阅读时间。</CardDescription>
          </CardHeader>
          <CardContent className="form-grid">
            <label className="field">
              <span>显示模式</span>
              <select value={config.subtitleMode} onChange={(e) => onChange("subtitleMode", e.target.value)}>
                <option value="bilingual">双语</option>
                <option value="zh_only">仅中文</option>
                <option value="en_only">仅英文</option>
              </select>
            </label>
            <label className="field">
              <span>译文字号</span>
              <Input
                type="number"
                min={18}
                max={64}
                value={config.subtitleFontSize}
                onChange={(e) => onChange("subtitleFontSize", Number(e.target.value))}
              />
            </label>
            <div className="color-grid">
              <label className="field">
                <span>原文颜色</span>
                <Input
                  type="color"
                  value={config.subtitleOriginalColor}
                  onChange={(e) => onChange("subtitleOriginalColor", e.target.value)}
                />
              </label>
              <label className="field">
                <span>译文颜色</span>
                <Input
                  type="color"
                  value={config.subtitleTranslatedColor}
                  onChange={(e) => onChange("subtitleTranslatedColor", e.target.value)}
                />
              </label>
              <label className="field">
                <span>文字背景</span>
                <Input
                  type="color"
                  value={config.subtitleBackgroundColor}
                  onChange={(e) => onChange("subtitleBackgroundColor", e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>背景透明度</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={config.subtitleBackgroundOpacity}
                onChange={(e) => onChange("subtitleBackgroundOpacity", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>最短显示时间</span>
              <Input
                type="number"
                min={500}
                value={config.minDwellMs}
                onChange={(e) => onChange("minDwellMs", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>最长显示时间</span>
              <Input
                type="number"
                min={500}
                value={config.maxDwellMs}
                onChange={(e) => onChange("maxDwellMs", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>最多等待句数</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={config.maxQueue}
                onChange={(e) => onChange("maxQueue", Number(e.target.value))}
              />
            </label>
            <div className="subtitle-style-preview">
              <p style={{ color: config.subtitleOriginalColor }}>
                <span style={{ backgroundColor: hexToRgba(config.subtitleBackgroundColor, config.subtitleBackgroundOpacity * 0.82) }}>
                  Sample subtitle
                </span>
              </p>
              <strong
                style={{
                  color: config.subtitleTranslatedColor,
                  fontSize: `${Math.min(32, Math.max(18, config.subtitleFontSize))}px`,
                }}
              >
                <span style={{ backgroundColor: hexToRgba(config.subtitleBackgroundColor, config.subtitleBackgroundOpacity) }}>
                  字幕预览
                </span>
              </strong>
            </div>
            <div className="switch-row">
              <div>
                <p>保存历史</p>
                <span>关闭后，本次使用的字幕内容不会出现在历史记录中。</span>
              </div>
              <Switch checked={config.saveHistory} onCheckedChange={(checked) => onChange("saveHistory", Boolean(checked))} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function hexToRgba(hex: string, opacity: number) {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#ffffff";
  const alpha = Math.max(0, Math.min(100, opacity)) / 100;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default App;
