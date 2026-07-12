import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { PreviewApi, PreviewCapabilities, PreviewRecord, PreviewResult } from "./api.ts";

type BusyAction = "open" | "reopen" | "reload" | "verify" | "close" | "remove" | "";

export function PreviewPortal({ api }: { api: PreviewApi }) {
  const mount = document.getElementById("previewReactMount");
  if (!mount) throw new Error("Preview mount #previewReactMount is missing");
  return createPortal(<PreviewWorkbench api={api} />, mount);
}

function PreviewWorkbench({ api }: { api: PreviewApi }) {
  const [capabilities, setCapabilities] = useState<PreviewCapabilities | null>(null);
  const [previews, setPreviews] = useState<readonly PreviewRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [url, setUrl] = useState("http://127.0.0.1:3000/");
  const [label, setLabel] = useState("");
  const [selectorsText, setSelectorsText] = useState("#app");
  const [busy, setBusy] = useState<BusyAction>("");
  const [message, setMessage] = useState("");
  const selected = useMemo(() => previews.find((preview) => preview.id === selectedId) || previews[0] || null, [previews, selectedId]);

  const upsert = (record: PreviewRecord) => {
    setPreviews((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 8));
    setSelectedId(record.id);
  };

  const refresh = async () => {
    const result = await api.list();
    if (!result.ok) {
      setMessage(result.error || "无法读取应用预览列表");
      return;
    }
    setPreviews(result.previews || []);
    setSelectedId((current) => result.previews?.some((item) => item.id === current) ? current : result.previews?.[0]?.id || "");
  };

  useEffect(() => {
    let alive = true;
    const unsubscribe = api.onEvent((event) => {
      if (alive) upsert(event.preview);
    });
    void (async () => {
      const detected = await api.capabilities();
      if (!alive) return;
      setCapabilities(detected);
      if (!detected.available) setMessage(detected.reason || "应用预览不可用");
      else await refresh();
    })();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const selectors = () => [...new Set(selectorsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))].slice(0, capabilities?.maxSelectors || 12);

  const run = async (action: BusyAction, execute: () => Promise<PreviewResult>) => {
    if (!action || busy) return;
    setBusy(action);
    setMessage("");
    try {
      const result = await execute();
      if (result.preview) upsert(result.preview);
      if (!result.ok) setMessage(result.error || "应用预览操作失败");
      else if (result.verification?.status === "failed") setMessage(result.verification.diagnostic || "自动验证发现未通过检查");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };

  const open = () => run("open", () => api.open({ url, label, selectors: selectors() }));
  const reopen = () => selected && run("reopen", () => api.reopen(selected.id));
  const reload = () => selected && run("reload", () => api.reload(selected.id));
  const verify = () => selected && run("verify", () => api.verify(selected.id, selectors()));
  const close = () => selected && run("close", () => api.close(selected.id));
  const remove = () => selected && run("remove", async () => {
    const result = await api.remove(selected.id);
    if (result.ok) {
      setPreviews((current) => current.filter((item) => item.id !== selected.id));
      setSelectedId("");
    }
    return result;
  });

  const available = capabilities?.available === true;
  const state = selected?.state || (capabilities ? "closed" : "loading");
  const verification = selected?.lastVerification || null;

  return (
    <div className="preview-shell" data-testid="app-preview" data-state={state}>
      <header className="preview-head">
        <div>
          <h2>应用预览</h2>
          <p>隔离窗口 · 仅本机 HTTP</p>
        </div>
        <div className="preview-head-actions">
          <span className={`preview-state ${state}`}>{stateLabel(state)}</span>
          <button type="button" className="ghost" disabled={!available || Boolean(busy)} onClick={() => void refresh()}>刷新列表</button>
        </div>
      </header>

      {message ? <div className="preview-message" role="alert">{message}</div> : null}

      <div className="preview-layout">
        <section className="preview-register" aria-labelledby="previewRegisterTitle">
          <div className="preview-section-head">
            <h3 id="previewRegisterTitle">本地服务</h3>
            <span>{previews.length}/8</span>
          </div>
          <label className="preview-field">
            <span>地址</span>
            <input
              value={url}
              disabled={!available || Boolean(busy)}
              inputMode="url"
              spellCheck={false}
              placeholder="http://127.0.0.1:3000/"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="preview-field">
            <span>名称</span>
            <input value={label} disabled={!available || Boolean(busy)} maxLength={120} placeholder="可选" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="preview-field">
            <span>DOM 检查</span>
            <textarea
              value={selectorsText}
              disabled={!available || Boolean(busy)}
              rows={3}
              placeholder="#app（每行一个 CSS 选择器）"
              onChange={(event) => setSelectorsText(event.target.value)}
            />
          </label>
          <button type="button" className="primary preview-open" disabled={!available || Boolean(busy) || !url.trim()} onClick={() => void open()}>
            {busy === "open" ? "正在连接" : "打开隔离预览"}
          </button>

          <div className="preview-registry" aria-label="本地预览记录">
            {previews.length ? previews.map((preview) => (
              <button
                key={preview.id}
                type="button"
                className={`preview-registry-item${selected?.id === preview.id ? " active" : ""}`}
                aria-current={selected?.id === preview.id ? "true" : undefined}
                onClick={() => setSelectedId(preview.id)}
              >
                <strong>{preview.label || preview.origin}</strong>
                <span>{stateLabel(preview.state)} · {preview.origin}</span>
              </button>
            )) : <div className="preview-empty-small">暂无本地服务记录</div>}
          </div>
        </section>

        <section className="preview-detail" aria-labelledby="previewDetailTitle">
          <div className="preview-section-head">
            <div>
              <h3 id="previewDetailTitle">{selected?.title || selected?.label || "验证结果"}</h3>
              <span className="mono" title={selected?.currentUrl || selected?.url || ""}>{selected?.currentUrl || selected?.url || "尚未打开预览"}</span>
            </div>
            <div className="preview-toolbar">
              <button type="button" className="ghost" disabled={!selected || Boolean(busy)} onClick={() => void (selected?.state === "ready" ? reload() : reopen())}>
                {selected?.state === "ready" ? "重新加载" : "重新打开"}
              </button>
              <button type="button" className="primary" disabled={!selected || selected.state !== "ready" || Boolean(busy)} onClick={() => void verify()}>
                {busy === "verify" ? "正在验证" : "截图并验证"}
              </button>
            </div>
          </div>

          {selected?.blockedNavigation ? (
            <div className="preview-blocked" role="status">
              <strong>已阻止外部跳转</strong>
              <span className="mono">{selected.blockedNavigation}</span>
            </div>
          ) : null}

          {verification ? (
            <div className="preview-verification" data-status={verification.status}>
              <div className="preview-verification-summary">
                <strong>{verification.status === "passed" ? "自动验证通过" : "自动验证未通过"}</strong>
                <span>{formatTime(verification.checkedAt)}</span>
              </div>
              <div className="preview-checks">
                {verification.checks.map((check) => (
                  <div key={check.id} className={`preview-check ${check.status}`}>
                    <span aria-hidden="true">{check.status === "passed" ? "✓" : "×"}</span>
                    <div><strong>{checkLabel(check.id)}</strong><small>{check.detail}</small></div>
                  </div>
                ))}
              </div>
              <dl className="preview-evidence-paths">
                <div><dt>截图</dt><dd className="mono">{verification.screenshot?.path || "未生成"}</dd></div>
                <div><dt>证据</dt><dd className="mono">{verification.evidencePath || "未生成"}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="preview-detail-empty">
              <strong>{selected ? "尚未生成验证证据" : "选择或打开一个本地服务"}</strong>
              <span>{selected ? "预览就绪后可生成 DOM 检查和 PNG 截图。" : "预览内容会在无 Node、无 preload 的隔离窗口中打开。"}</span>
            </div>
          )}

          <footer className="preview-detail-actions">
            <button type="button" className="ghost" disabled={!selected || selected.state === "closed" || Boolean(busy)} onClick={() => void close()}>关闭窗口</button>
            <button type="button" className="ghost danger" disabled={!selected || Boolean(busy)} onClick={() => void remove()}>移除记录</button>
          </footer>
        </section>
      </div>
    </div>
  );
}

function stateLabel(state: string) {
  if (state === "ready") return "已打开";
  if (state === "loading") return "连接中";
  if (state === "registered") return "已登记";
  if (state === "failed") return "失败";
  return "已关闭";
}

function checkLabel(id: string) {
  if (id === "same-origin") return "来源一致";
  if (id === "document-ready") return "页面就绪";
  if (id === "screenshot") return "截图证据";
  if (id.startsWith("selector:")) return id.slice("selector:".length);
  return id;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
