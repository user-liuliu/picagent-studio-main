import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./shared";
import "../product-reverse.css";

type Mode = "main" | "detail";
type Template = { templateVersionId: string; name: string; versionNo?: number; applicability?: Record<string, unknown> };
type PromptVersion = { id: string; prompt: string };
type Attempt = { id: string; status: "pending" | "running" | "succeeded" | "failed"; errorMessage?: string | null };
type Ref = { id: string; ordinal: number; filename: string; width?: number; height?: number; templateVersionId?: string | null; attempts: Attempt[]; promptVersions: PromptVersion[]; effectivePromptVersionId?: string | null };
type Plan = { id: string; mode: Mode; baselineReferenceId?: string | null; references: Ref[] };
type UploadItem = { id: string; file: File; filename: string; previewUrl: string; progress: number; status: "waiting" | "uploading" | "processing" | "succeeded" | "failed"; referenceId?: string; error?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) { const error = new Error(payload?.error?.message ?? "请求失败") as Error & { status?: number }; error.status = response.status; throw error; }
  return payload?.data as T;
}

function uploadReference(planId: string, file: File, onProgress: (progress: number) => void, onProcessing: () => void): Promise<Ref> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); const form = new FormData(); form.append("file", file, file.name);
    request.open("POST", `/api/reverse-plans/${encodeURIComponent(planId)}/references`);
    request.setRequestHeader("idempotency-key", crypto.randomUUID?.() ?? `${Date.now()}-${file.name}`);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 95))));
    request.upload.onload = onProcessing;
    request.onerror = () => reject(new Error("网络异常，上传失败"));
    request.onload = () => { try { const payload = JSON.parse(request.responseText || "null") as { data?: Ref; error?: { message?: string } } | null; if (request.status < 200 || request.status >= 300 || !payload?.data) reject(new Error(payload?.error?.message ?? "上传失败")); else resolve(payload.data); } catch { reject(new Error("上传响应格式无效")); } };
    request.send(form);
  });
}

function UploadProgress({ item, onRetry }: { item: UploadItem; onRetry?: () => void }) {
  const label = item.status === "waiting" ? "等待上传" : item.status === "processing" ? "服务端处理中" : item.status === "succeeded" ? "上传完成" : item.status === "failed" ? item.error ?? "上传失败" : `上传中 ${item.progress}%`;
  return <div className={`reverse-upload-progress ${item.status}`} role="status"><div><span>{label}</span><strong>{item.status === "processing" ? "…" : `${item.progress}%`}</strong></div><span className="reverse-upload-track"><i style={{ transform: `scaleX(${item.progress / 100})` }} /></span>{item.status === "failed" && onRetry && <button type="button" onClick={onRetry}><Icon name="upload" />重新上传</button>}</div>;
}

export function ReversePage({ planId, navigate }: { planId?: string; navigate: (to: string) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("main");
  const [promptDraft, setPromptDraft] = useState("");
  const [message, setMessage] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewActual, setPreviewActual] = useState(false);
  const uploadUrls = useRef(new Set<string>());
  const selected = plan?.references.find((item) => item.id === selectedId) ?? plan?.references[0] ?? null;
  const preview = plan?.references.find((item) => item.id === previewId) ?? null;
  const selectedPrompt = selected?.promptVersions.find((item) => item.id === selected.effectivePromptVersionId)?.prompt ?? "";
  const stateOf = (item: Ref) => item.attempts[item.attempts.length - 1]?.status ?? "pending";
  const visibleTemplates = useMemo(() => templates.filter((template) => (template.applicability?.targetType ?? mode) === mode), [templates, mode]);
  const uploading = uploads.some((item) => item.status === "waiting" || item.status === "uploading" || item.status === "processing");
  const closePreview = () => { setPreviewId(null); setPreviewActual(false); };

  const refresh = async (id: string) => {
    const next = await api<Plan>(`/api/reverse-plans/${encodeURIComponent(id)}`);
    setPlan(next); setMode(next.mode); setSelectedId((current) => current && next.references.some((item) => item.id === current) ? current : next.references[0]?.id ?? null);
  };
  useEffect(() => {
    api<Template[]>(`/api/prompt-templates?stage=reverse_prompt`).then(setTemplates).catch((error) => setMessage(error.message));
    if (planId) refresh(planId).catch((error) => setMessage(error.message));
  }, [planId]);
  useEffect(() => setPromptDraft(selectedPrompt), [selectedId, selectedPrompt]);
  useEffect(() => () => { uploadUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => { if (!previewId) return; const close = (event: KeyboardEvent) => event.key === "Escape" && closePreview(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [previewId]);

  const createPlan = async () => {
    const created = await api<Plan>("/api/reverse-plans", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID?.() ?? String(Date.now()) }, body: JSON.stringify({ mode }) });
    navigate(`/reverse/${created.id}`);
  };
  const updateUpload = (id: string, patch: Partial<UploadItem>) => setUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const runUploadBatch = async (items: UploadItem[]) => {
    if (!plan) return;
    let cursor = 0; const completed = new Set<string>();
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++]; updateUpload(item.id, { status: "uploading", progress: 1, error: undefined });
        try {
          const reference = await uploadReference(plan.id, item.file, (progress) => updateUpload(item.id, { status: "uploading", progress }), () => updateUpload(item.id, { status: "processing", progress: 95 }));
          completed.add(item.id); updateUpload(item.id, { status: "succeeded", progress: 100, referenceId: reference.id });
        } catch (error) { updateUpload(item.id, { status: "failed", error: error instanceof Error ? error.message : "上传失败" }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
    await refresh(plan.id);
    if (completed.size) window.setTimeout(() => setUploads((current) => current.filter((item) => { if (!completed.has(item.id)) return true; URL.revokeObjectURL(item.previewUrl); uploadUrls.current.delete(item.previewUrl); return false; })), 1000);
  };
  const upload = async (files: FileList | File[] | null) => {
    if (!plan || !files || !files.length || uploading) return;
    const available = Math.max(0, 16 - plan.references.length); const selectedFiles = Array.from(files).slice(0, available);
    if (!selectedFiles.length) { setMessage("一个方案最多上传 16 张参考图"); return; }
    if (selectedFiles.length < files.length) setMessage(`仅上传前 ${selectedFiles.length} 张，方案上限为 16 张`);
    const rows = selectedFiles.map((file, index) => { const previewUrl = URL.createObjectURL(file); uploadUrls.current.add(previewUrl); return { id: crypto.randomUUID?.() ?? `${Date.now()}-${index}`, file, filename: file.name, previewUrl, progress: 0, status: "waiting" as const }; });
    setUploads((current) => [...current, ...rows]); await runUploadBatch(rows);
  };
  const retryUpload = async (item: UploadItem) => { if (uploading) return; updateUpload(item.id, { status: "waiting", progress: 0, error: undefined }); await runUploadBatch([item]); };
  const mutate = async (path: string, body?: unknown, method = "POST") => { if (!plan) return; try { await api(path, { method, headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID?.() ?? String(Date.now()) }, body: body === undefined ? undefined : JSON.stringify(body) }); await refresh(plan.id); } catch (error) { if ((error as Error & { status?: number }).status === 404) { await refresh(plan.id).catch(() => undefined); setMessage("图片状态已更新，请重新操作"); } else setMessage(error instanceof Error ? error.message : "操作失败"); } };
  const reverseAll = async () => { if (!plan) return; for (const item of plan.references.filter((ref) => ref.templateVersionId && stateOf(ref) !== "succeeded")) await mutate(`/api/reverse-plans/${plan.id}/references/${item.id}/run`); };
  const enterCanvas = async () => { if (!plan) return; try { const result = await api<{ suiteId: string }>(`/api/reverse-plans/${plan.id}/canvas-imports`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID?.() ?? String(Date.now()) }, body: JSON.stringify({}) }); navigate(`/suites/${result.suiteId}/board`); } catch (error) { setMessage(error instanceof Error ? error.message : "导入共享画布失败"); } };
  const archiveSelected = async () => { if (!plan || !selected) return; try { await api(`/api/reverse-plans/${plan.id}/references/${selected.id}/asset`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID?.() ?? String(Date.now()) } }); setMessage("已保存为爆品图反推资产"); } catch (error) { setMessage(error instanceof Error ? error.message : "资产保存失败"); } };
  const move = (item: Ref, delta: number) => mutate(`/api/reverse-plans/${plan?.id}/references/${item.id}`, { ordinal: item.ordinal + delta }, "PATCH");

  const pendingUploads = uploads.filter((item) => !item.referenceId || !plan?.references.some((reference) => reference.id === item.referenceId));

  return <div className="reverse-shell">
    <header className="reverse-topbar"><button className="reverse-brand" type="button" onClick={() => navigate("/")}><img src="/logo.png" alt="" width={36} height={36} style={{ objectFit: "contain", flexShrink: 0 }} /><strong>PicAgent</strong></button><div className="reverse-breadcrumb"><span>内部图片生产</span><i>/</i><strong>爆品图反推</strong></div><div className="reverse-top-actions"><span className="reverse-status"><b />{message || "方案状态实时同步"}</span><button className="reverse-avatar" type="button" aria-label="当前用户">设</button></div></header>
    <div className="reverse-layout">
      <aside className="reverse-panel left"><div className="reverse-panel-scroll"><div className="reverse-panel-head"><h1>爆品图反推</h1><p>从爆品参考图提炼可复用的构图、风格和信息排版提示词。</p></div><div className="reverse-step-list"><div className="reverse-step active"><span>1</span><strong>上传参考图</strong></div><div className="reverse-step active"><span>2</span><strong>选择反推模板</strong></div><div className="reverse-step"><span>3</span><strong>编辑提示词</strong></div><div className="reverse-step"><span>4</span><strong>进入共享画布</strong></div></div><section className="reverse-left-section"><div className="reverse-section-label"><strong>反推类型</strong><span>二选一</span></div><div className="reverse-tabs"><button className={mode === "main" ? "active" : ""} type="button" onClick={() => mode !== "main" && window.confirm("切换模式会使当前模板选择和未保存结果失效，继续吗？") && mutate(`/api/reverse-plans/${plan?.id}`, { mode: "main" }, "PATCH")}>主图反推</button><button className={mode === "detail" ? "active" : ""} type="button" onClick={() => mode !== "detail" && window.confirm("切换模式会使当前模板选择和未保存结果失效，继续吗？") && mutate(`/api/reverse-plans/${plan?.id}`, { mode: "detail" }, "PATCH")}>详情图反推</button></div><p className="reverse-mode-note">{mode === "main" ? "每张参考主图独立提炼版式、信息层级和商业转化结构。" : "每张详情图独立处理；默认以第 1 张图建立系列色彩基准。"}</p></section><section className="reverse-left-section"><div className="reverse-section-label"><strong>批量操作</strong><span>最多 16 张</span></div><div className="reverse-batch-actions"><button className="reverse-btn primary" type="button" disabled={!plan || !plan.references.length} onClick={() => reverseAll().catch(() => undefined)}><Icon name="sparkles" />批量反推提示词</button><button className="reverse-btn secondary" type="button" onClick={() => plan && refresh(plan.id)}><Icon name="save" />保存当前方案</button><button className="reverse-btn secondary" type="button" disabled={!plan?.references.some((item) => stateOf(item) === "succeeded")} onClick={() => enterCanvas().catch(() => undefined)}><Icon name="arrow-right" />带入共享画布</button></div><small className="reverse-limit">每张图片独立生成一条提示词。详情图默认以第 1 张图建立系列色彩基准。</small></section></div></aside>
      <main className="reverse-main"><header className="reverse-main-head"><div><h2>{mode === "main" ? "主图反推" : "详情图反推"}</h2><p>上传爆品参考图，再为每张图选择对应的反推模板。</p></div><div className="reverse-counter"><strong>{(plan?.references.length ?? 0) + pendingUploads.length}</strong> 张参考图 · <strong>{plan?.references.filter((item) => stateOf(item) === "succeeded").length ?? 0}</strong> 条提示词</div></header><div className="reverse-content">{!plan ? <div className="reverse-dropzone"><button className="reverse-btn primary" type="button" onClick={() => createPlan().catch((error) => setMessage(error.message))}>创建爆品图反推方案</button></div> : <><label className={`reverse-dropzone ${uploading ? "uploading" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); upload(Array.from(event.dataTransfer.files)).catch((error) => setMessage(error.message)); }}><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={(event) => { const files = event.target.files; event.target.value = ""; upload(files).catch((error) => setMessage(error.message)); }} /><Icon name="files" /><strong>{uploading ? "正在上传参考图" : "拖拽爆品参考图到这里，或点击选择文件"}</strong><span>支持 JPG、PNG、WebP · 最多 3 张并发 · 单方案最多 16 张</span></label><div className="reverse-reference-head"><h3>参考图列表</h3><span>点击图片查看原图 · 可排序、删除和选择色彩基准</span></div><section className="reverse-image-grid">
        {plan.references.map((item) => { const status = stateOf(item); const progress = uploads.find((uploadItem) => uploadItem.referenceId === item.id); return <article className={`reverse-image-card ${item.id === selected?.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}><div className="reverse-image-top"><button className="reverse-image-preview" type="button" onClick={(event) => { event.stopPropagation(); setPreviewId(item.id); setPreviewActual(false); }} aria-label={`查看原图 ${item.filename}`}><img src={`/api/reverse-plans/${plan.id}/references/${item.id}/preview`} alt={item.filename} /><span className="reverse-image-zoom"><Icon name="zoom-in" />查看原图</span></button><span className="reverse-image-index">{item.ordinal}</span></div><div className="reverse-image-meta"><div className="reverse-image-name">{item.filename}</div><div className="reverse-image-sub">{mode === "detail" && item.id === plan.baselineReferenceId ? "系列色彩基准" : "独立处理"}</div>{mode === "detail" && <button className="reverse-card-action" type="button" disabled={item.id === plan.baselineReferenceId} onClick={(event) => { event.stopPropagation(); mutate(`/api/reverse-plans/${plan.id}`, { baselineReferenceId: item.id }, "PATCH"); }}>{item.id === plan.baselineReferenceId ? <><Icon name="check" />已设为色彩基准</> : "设为色彩基准"}</button>}<label className="reverse-template"><span>反推模板</span><select value={item.templateVersionId ?? ""} onChange={(event) => mutate(`/api/reverse-plans/${plan.id}/references/${item.id}`, { templateVersionId: event.target.value }, "PATCH")}><option value="">请选择模板</option>{visibleTemplates.map((template) => <option value={template.templateVersionId} key={template.templateVersionId}>{template.name} · v{template.versionNo ?? 1}</option>)}</select></label><div className="reverse-card-controls"><button type="button" disabled={item.ordinal === 1} onClick={(event) => { event.stopPropagation(); move(item, -1); }} aria-label={`上移 ${item.filename}`}>↑</button><button type="button" disabled={item.ordinal === plan.references.length} onClick={(event) => { event.stopPropagation(); move(item, 1); }} aria-label={`下移 ${item.filename}`}>↓</button><button className="danger" type="button" onClick={(event) => { event.stopPropagation(); mutate(`/api/reverse-plans/${plan.id}/references/${item.id}`, undefined, "DELETE"); }} aria-label={`删除 ${item.filename}`}>删除</button></div><div className="reverse-card-status"><b className={status === "succeeded" ? "done" : status === "failed" ? "failed" : ""}>{status === "succeeded" ? "已生成" : status === "failed" ? "失败" : status === "running" ? "生成中" : "待反推"}</b>{status === "failed" && <button type="button" onClick={(event) => { event.stopPropagation(); mutate(`/api/reverse-plans/${plan.id}/references/${item.id}/retry`); }}>重新反推</button>}</div>{progress && <UploadProgress item={progress} />}</div></article>; })}
        {pendingUploads.map((item, index) => <article className="reverse-image-card uploading" key={item.id}><div className="reverse-image-top"><img src={item.previewUrl} alt={item.filename} /><span className="reverse-image-index">{plan.references.length + index + 1}</span></div><div className="reverse-image-meta"><div className="reverse-image-name">{item.filename}</div><div className="reverse-image-sub">{item.status === "waiting" ? "等待上传" : item.status === "failed" ? "上传未完成" : "文件加载中"}</div><UploadProgress item={item} onRetry={() => retryUpload(item).catch(() => undefined)} /></div></article>)}
      </section></>}</div></main>
      <aside className="reverse-panel right"><div className="reverse-panel-scroll"><div className="reverse-right-head"><h2>提示词</h2><p>选中一张参考图后，查看并编辑它独立生成的提示词。</p></div>{selected ? <div className="reverse-inspector"><div className="reverse-inspector-info"><button className="reverse-inspector-thumb" type="button" onClick={() => { setPreviewId(selected.id); setPreviewActual(false); }} aria-label={`查看原图 ${selected.filename}`}>{plan && <img src={`/api/reverse-plans/${plan.id}/references/${selected.id}/preview`} alt={selected.filename} />}</button><div><strong>参考图 {selected.ordinal}</strong><span>{selected.filename}</span></div></div><label className="reverse-field"><span>当前模板</span><select value={selected.templateVersionId ?? ""} onChange={(event) => mutate(`/api/reverse-plans/${plan?.id}/references/${selected.id}`, { templateVersionId: event.target.value }, "PATCH")}><option value="">请选择模板</option>{visibleTemplates.map((template) => <option value={template.templateVersionId} key={template.templateVersionId}>{template.name}</option>)}</select></label><label className="reverse-field"><span>反推出的提示词</span><textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} spellCheck={false} /></label><div className="reverse-inspector-actions"><button className="reverse-btn secondary" type="button" onClick={() => mutate(`/api/reverse-plans/${plan?.id}/references/${selected.id}/prompt`, { prompt: promptDraft }, "PATCH")}><Icon name="save" />保存提示词</button><button className="reverse-btn primary" type="button" onClick={() => mutate(`/api/reverse-plans/${plan?.id}/references/${selected.id}/run`)}><Icon name="sparkles" />重新反推</button><button className="reverse-btn secondary wide" type="button" onClick={() => navigator.clipboard?.writeText(promptDraft)}><Icon name="copy" />复制提示词</button><button className="reverse-btn secondary wide" type="button" disabled={!selected.effectivePromptVersionId} onClick={() => archiveSelected().catch(() => undefined)}><Icon name="library" />保存为反推资产</button></div><div className="reverse-source-note"><strong>来源</strong>提示词由当前参考图、模板版本和服务端模型输出生成。后续进入共享画布时，从图片资源库选择产品白底图。</div></div> : <div className="reverse-inspector-empty">创建方案并上传参考图后，这里会显示对应的反推提示词。</div>}</div></aside>
    </div>
    {preview && plan && <div className="reverse-lightbox" role="dialog" aria-modal="true" aria-label={`原图预览 ${preview.filename}`} onMouseDown={closePreview}><div className="reverse-lightbox-panel" onMouseDown={(event) => event.stopPropagation()}><header><div><strong>{preview.filename}</strong><span>{preview.width && preview.height ? `${preview.width} × ${preview.height}` : "原始图片"}</span></div><div><button type="button" onClick={() => setPreviewActual((value) => !value)} title={previewActual ? "适应窗口" : "1:1 原始尺寸"}><Icon name={previewActual ? "fit" : "zoom-in"} /><span>{previewActual ? "适应窗口" : "1:1"}</span></button><button type="button" onClick={closePreview} title="关闭" aria-label="关闭原图预览"><Icon name="x" /></button></div></header><div className={`reverse-lightbox-stage ${previewActual ? "actual" : "fit"}`}><img src={`/api/reverse-plans/${plan.id}/references/${preview.id}/preview/original`} alt={preview.filename} /></div></div></div>}
  </div>;
}
