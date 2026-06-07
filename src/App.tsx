import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Status = "idle" | "running";

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [clickThrough, setClickThrough] = useState(true);
  const [lastEn, setLastEn] = useState("");
  const [lastZh, setLastZh] = useState("");
  const [busy, setBusy] = useState(false);

  // 同步字幕窗最新一句到控制台
  useEffect(() => {
    const un = listen<{ original: string; translated: string; status: string }>(
      "subtitle",
      (e) => {
        const p = e.payload;
        if (p.status === "error") {
          setMsg(`✗ ${p.original} ${p.translated}`);
          return;
        }
        if (p.original) setLastEn(p.original);
        if (p.translated) setLastZh(p.translated);
      }
    );
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
        setMsg("聆听中 · 播放有声视频即可");
      } else {
        await invoke("stop_capture");
        setStatus("idle");
        setMsg("已停止");
      }
    } catch (e) {
      setStatus("idle");
      setMsg(`✗ ${e}`);
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
      setMsg(`✗ ${e}`);
    }
  }

  return (
    <main className="wrap">
      <header className="head">
        <span className="sigil" />
        <div>
          <h1>LUMEN</h1>
          <p className="tag">PHASE 2 · 双语实时同传</p>
        </div>
        <span className={`live ${status === "running" ? "on" : ""}`}>
          {status === "running" ? "● LIVE" : "○ 待机"}
        </span>
      </header>

      <section className="card">
        <div className="card-top">
          <span className="k">同传</span>
          <span className="sub">系统音频 → GLM-ASR</span>
        </div>
        <button
          className={`btn ${status === "running" ? "rec" : ""}`}
          onClick={toggle}
          disabled={busy}
        >
          {status === "running" ? "■  停止" : "●  开始同传"}
        </button>
        <p className="hint">
          需先设置 <code>GLM_API_KEY</code> 环境变量,并授予屏幕录制权限。
        </p>
      </section>

      <section className="card">
        <div className="card-top">
          <span className="k">字幕</span>
          <span className="sub">双语悬浮窗</span>
        </div>
        <p className="last-en">{lastEn || "—"}</p>
        <p className="last">{lastZh || "—"}</p>
        <button className="btn ghost" onClick={toggleClickThrough}>
          鼠标穿透:{clickThrough ? "开" : "关"}
        </button>
      </section>

      {msg && <p className={`msg ${msg.startsWith("✗") ? "err" : ""}`}>{msg}</p>}
    </main>
  );
}

export default App;
