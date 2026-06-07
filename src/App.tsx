import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ActivityIcon,
  CaptionsIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  PlayIcon,
  SettingsIcon,
  SquareIcon,
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
type View = "home" | "history" | "settings";

type AppConfig = {
  asrProvider: string;
  asrApiKey: string;
  llmProvider: string;
  llmApiKey: string;
  subtitleMode: string;
  minDwellMs: number;
  maxDwellMs: number;
  maxQueue: number;
  saveHistory: boolean;
};

type SubtitleEvent = {
  original: string;
  translated: string;
  status: string;
};

const defaultConfig: AppConfig = {
  asrProvider: "zhipu_glm_asr",
  asrApiKey: "",
  llmProvider: "deepseek_v4_flash",
  llmApiKey: "",
  subtitleMode: "bilingual",
  minDwellMs: 1800,
  maxDwellMs: 4200,
  maxQueue: 5,
  saveHistory: true,
};

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboardIcon }> = [
  { id: "home", label: "首页", icon: LayoutDashboardIcon },
  { id: "history", label: "历史", icon: HistoryIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

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

  const configured = Boolean(config.asrApiKey.trim() && config.llmApiKey.trim());

  const statusLabel = useMemo(() => {
    if (status === "running") return "采集中";
    if (!configured) return "待配置";
    return "待机";
  }, [configured, status]);

  useEffect(() => {
    invoke<AppConfig>("get_app_config")
      .then((saved) => setConfig(saved))
      .catch((e) => setMsg(`配置读取失败: ${e}`));
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

  async function saveConfig() {
    setSaving(true);
    setMsg("");
    try {
      const saved = await invoke<AppConfig>("save_app_config", { config });
      setConfig(saved);
      setMsg("设置已保存");
    } catch (e) {
      setMsg(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
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
          {navItems.map((item) => {
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
            <h2>{view === "home" ? "实时同传" : view === "history" ? "翻译历史" : "设置"}</h2>
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
              onToggleClickThrough={toggleClickThrough}
            />
          )}
          {view === "history" && <HistoryView />}
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
  onToggleClickThrough,
}: {
  statusLabel: string;
  configured: boolean;
  lastEn: string;
  lastZh: string;
  clickThrough: boolean;
  onToggleClickThrough: () => void;
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

function HistoryView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>历史记录</CardTitle>
        <CardDescription>保存后可在这里回看最近的字幕内容。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="empty-state">
          <HistoryIcon />
          <p>暂无历史记录</p>
          <span>开始一次同传后，识别和翻译内容会在这里显示。</span>
        </div>
      </CardContent>
    </Card>
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
    <div className="settings-grid">
      <Card>
        <CardHeader>
          <CardTitle>服务连接</CardTitle>
          <CardDescription>填写用于语音识别和翻译的访问密钥。</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <label className="field">
            <span>语音识别服务</span>
            <select value={config.asrProvider} onChange={(e) => onChange("asrProvider", e.target.value)}>
              <option value="zhipu_glm_asr">默认语音识别</option>
            </select>
          </label>
          <label className="field">
            <span>语音识别访问密钥</span>
            <Input
              type="password"
              value={config.asrApiKey}
              onChange={(e) => onChange("asrApiKey", e.target.value)}
              placeholder="用于语音识别"
            />
          </label>
          <label className="field">
            <span>翻译服务</span>
            <select value={config.llmProvider} onChange={(e) => onChange("llmProvider", e.target.value)}>
              <option value="deepseek_v4_flash">默认翻译服务</option>
            </select>
          </label>
          <label className="field">
            <span>翻译访问密钥</span>
            <Input
              type="password"
              value={config.llmApiKey}
              onChange={(e) => onChange("llmApiKey", e.target.value)}
              placeholder="用于翻译"
            />
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
          <div className="switch-row">
            <div>
              <p>保存历史</p>
              <span>关闭后，本次使用的字幕内容不会出现在历史记录中。</span>
            </div>
            <Switch checked={config.saveHistory} onCheckedChange={(checked) => onChange("saveHistory", Boolean(checked))} />
          </div>
          <Button onClick={onSave} disabled={saving}>
            <KeyRoundIcon data-icon="inline-start" />
            {saving ? "保存中" : "保存设置"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
