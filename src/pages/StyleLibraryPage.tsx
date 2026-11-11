import { useEffect, useMemo, useRef, useState } from "react";
import { suiteApi, type ApiLibraryResource, type ApiLibraryResourceType, type ApiPromptTemplateCopy } from "../api/client";
import { Icon } from "./shared";

type ResourceFilter = "all" | ApiLibraryResourceType;
type AssetKind = "original" | "base" | "generated" | "process" | "final" | "reverse";

const assetKindFor = (resource: ApiLibraryResource): AssetKind => {
  if (resource.resourceType === "input_image") return "original";
  if (resource.resourceType === "base_image") return "base";
  if (resource.resourceType === "task_image_version") return "generated";
  if (resource.resourceType === "process_image") return "process";
  return "reverse";
};

const resourceLabel = (resource: ApiLibraryResource) => ({
  input_image: "商品实拍原图",
  base_image: "白底底图",
  task_image_version: "AI 生成结果",
  process_image: "过程图",
  reverse_reference_asset: "爆品图反推",
  prompt_template: "提示词模板",
}[resource.resourceType]);

const stageLabel = (stage: ApiLibraryResource["stage"]) => ({ base_refine: "底图精修", plan: "计划生成", task_image: "单卡创作" } as Record<string, string>)[stage ?? ""] ?? "工作台资源";
const statusLabel = (status: ApiLibraryResource["status"]) => ({ draft: "草稿", published: "已发布", archived: "已归档" }[status ?? "published"] ?? "已发布");
const statusClass = (status: ApiLibraryResource["status"]) => status === "draft" ? "warn" : status === "archived" ? "risk" : "pass";
const promptTextFor = (resource: ApiLibraryResource) => {
  if (resource.resourceType === "prompt_template") return String(resource.source?.body ?? "暂无提示词正文");
  const snapshot = resource.promptSnapshot;
  if (typeof snapshot?.prompt === "string") return snapshot.prompt;
  return "暂无可读提示词内容";
};
const promptSnapshotValue = (resource: ApiLibraryResource, key: string) => {
  const value = resource.promptSnapshot?.[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  const params = resource.promptSnapshot?.generationParams;
  if (params && typeof params === "object" && key in params) {
    const nested = (params as Record<string, unknown>)[key];
    if (typeof nested === "string" || typeof nested === "number") return String(nested);
  }
  return "未记录";
};
const dimensionsFor = (resource: ApiLibraryResource) => {
  const match = resource.summary.match(/(\d+)\s*[×x]\s*(\d+)/);
  return match ? `${match[1]} × ${match[2]}` : "未记录";
};
const ratioFor = (resource: ApiLibraryResource) => {
  const recorded = promptSnapshotValue(resource, "ratio");
  if (recorded !== "未记录") return recorded;
  const match = resource.summary.match(/(\d+)\s*[×x]\s*(\d+)/);
  if (!match) return "未记录";
  const width = Number(match[1]); const height = Number(match[2]); const divisor = (a: number, b: number): number => b === 0 ? 1 : a % b === 0 ? b : divisor(b, a % b);
  const gcd = divisor(width, height);
  return `${width / gcd}:${height / gcd}`;
};

function resourcePreview(resource: ApiLibraryResource) {
  if (resource.previewUrl) return <img src={resource.previewUrl} alt={resource.title} loading="lazy" />;
  if (resource.resourceType === "prompt_template") return <div className="style-library-template-preview"><strong>{resource.title}</strong></div>;
  return <div className="style-library-no-preview"><Icon name={resource.resourceType === "process_image" ? "history" : "image"} /><span>暂无预览</span></div>;
}

export function StyleLibraryPage({ navigate }: { navigate: (to: string) => void }) {
  const [tab, setTab] = useState<"images" | "templates">("images");
  const [query, setQuery] = useState("");
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "archived">("published");
  const [items, setItems] = useState<ApiLibraryResource[]>([]);
  const [selected, setSelected] = useState<ApiLibraryResource | null>(null);
  const [templateVersions, setTemplateVersions] = useState<ApiPromptTemplateCopy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showReverseForm, setShowReverseForm] = useState(false);
  const [promptModal, setPromptModal] = useState<ApiLibraryResource | null>(null);
  const [reverseForm, setReverseForm] = useState({ title: "", summary: "", objectKey: "", prompt: "", visualStructure: "" });
  const loadSequence = useRef(0);

  useEffect(() => { const previous = document.title; document.title = "风格库 · PicAgent"; return () => { document.title = previous; }; }, []);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const result = await suiteApi.listLibraryResources({ status: statusFilter === "all" ? undefined : statusFilter, query: query.trim() || undefined, resourceType: tab === "templates" ? "prompt_template" : undefined });
      if (sequence !== loadSequence.current) return;
      const visible = tab === "templates" ? result.items : result.items.filter((item) => item.resourceType !== "prompt_template");
      setItems(visible); setSelected((current) => visible.find((item) => item.id === current?.id) ?? visible[0] ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "资源加载失败，请重试"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load().catch(() => undefined); }, [tab, statusFilter]);
  useEffect(() => { if (!promptModal) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPromptModal(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [promptModal]);
  useEffect(() => {
    const templateId = selected?.resourceType === "prompt_template" && typeof selected.source?.templateId === "string" ? selected.source.templateId : null;
    if (!templateId) { setTemplateVersions([]); return; }
    suiteApi.listPromptTemplateVersions(templateId).then(setTemplateVersions).catch(() => setTemplateVersions([]));
  }, [selected?.id]);

  const filtered = useMemo(() => items.filter((item) => {
    if (tab === "images" && resourceFilter !== "all" && item.resourceType !== resourceFilter) return false;
    return true;
  }), [items, resourceFilter, tab]);

  const saveReverse = async () => {
    if (!reverseForm.title.trim() || !reverseForm.objectKey.trim() || !reverseForm.prompt.trim()) { setError("请填写标题、对象存储地址和反推提示词"); return; }
    try {
      const created = await suiteApi.createReverseReferenceAsset({ title: reverseForm.title.trim(), summary: reverseForm.summary.trim(), objectKey: reverseForm.objectKey.trim(), mimeType: "image/png", promptSnapshot: { prompt: reverseForm.prompt.trim() }, visualStructure: reverseForm.visualStructure ? JSON.parse(reverseForm.visualStructure) : {} });
      setReverseForm({ title: "", summary: "", objectKey: "", prompt: "", visualStructure: "" }); setShowReverseForm(false); setSelected(created); notify("爆品图反推资产已保存"); await load();
    } catch (cause) { setError(cause instanceof SyntaxError ? "视觉结构必须是合法 JSON" : cause instanceof Error ? cause.message : "保存失败，请重试"); }
  };

  const changeStatus = async (resource: ApiLibraryResource, status: "published" | "archived") => {
    try { const updated = await suiteApi.setLibraryResourceStatus(resource.id, status); setSelected(updated); notify(status === "published" ? "资源已发布" : "资源已归档"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "状态更新失败，请重试"); }
  };

  const copyTemplate = async () => {
    if (!selected?.templateVersionId) return;
    try { await suiteApi.copyPromptTemplateVersion(selected.templateVersionId); notify("已创建模板草稿"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "复制模板失败，请重试"); }
  };

  return <div className="app-shell style-library-shell">
    <header className="topbar style-library-topbar">
      <a className="brand-mark" href="/suites/new" onClick={(event) => { event.preventDefault(); navigate("/suites/new"); }} aria-label="返回创建"><img src="/logo.png" alt="" width={36} height={36} style={{ objectFit: "contain", flexShrink: 0 }} /></a>
      <div className="topbar-main"><div className="breadcrumb"><span>PicAgent</span><span className="crumb-sep">/</span><strong>风格库</strong></div></div>
      <div className="topbar-actions"><span className="top-status"><span className="status-dot pass" />资源已同步</span><button className="btn btn-ghost" type="button" onClick={() => navigate("/suites/new")}><Icon name="arrow-left" />返回创建</button><button className="icon-btn" type="button" aria-label="当前用户沈">沈</button></div>
    </header>
    <aside className="sidenav style-library-nav" aria-label="主导航">
      <a className="nav-item" href="/suites/new" onClick={(event) => { event.preventDefault(); navigate("/suites/new"); }}><Icon name="sparkles" /><span>创建</span></a>
      <button className="nav-item" type="button" onClick={() => notify("任务中心接口已预留")}><Icon name="tasks" /><span>任务</span></button>
      <a className="nav-item active" href="/style-library" aria-current="page"><Icon name="library" /><span>风格库</span></a>
      <span className="nav-spacer" />
    </aside>
    <main className="workarea styles-layout style-library-workarea">
      <section className="panel style-filter-panel">
        <header className="panel-header"><div><strong className="panel-title">资源筛选</strong><div className="panel-subtitle">维护可复用图片和提示词模板</div></div><span className="badge">{filtered.length} 项</span></header>
        <div className="panel-scroll"><div className="style-filters">
          <div className="style-filter-group"><h3>资源类型</h3>{([["all", "全部资源"], ["input_image", "商品实拍原图"], ["base_image", "白底底图"], ["task_image_version", "AI 生成结果"], ["process_image", "过程图"], ["reverse_reference_asset", "爆品图反推"]] as [ResourceFilter, string][]).map(([value, label]) => <label className="style-check" key={value}><input type="radio" name="resourceType" checked={resourceFilter === value} onChange={() => setResourceFilter(value)} />{label}</label>)}</div>
          <div className="style-filter-group"><h3>状态</h3>{([["published", "已发布"], ["draft", "草稿"], ["archived", "已归档"], ["all", "全部状态"]] as const).map(([value, label]) => <label className="style-check" key={value}><input type="radio" name="resourceStatus" checked={statusFilter === value} onChange={() => setStatusFilter(value)} />{label}</label>)}</div>
          <div className="style-filter-note"><Icon name="library" /><p>图片资源来自商品生产链路；除实拍原图外，每张图片都保留对应提示词快照。</p></div>
        </div></div>
      </section>
      <section className="styles-center style-library-center">
        <header className="panel-header style-catalog-toolbar"><div><strong className="panel-title">风格库</strong><div className="panel-subtitle">图片资产与提示词模板统一维护</div></div></header>
        <div className="tabs style-scope-tabs" role="tablist" aria-label="资源类型"><button className={`tab ${tab === "images" ? "active" : ""}`} type="button" onClick={() => { setTab("images"); setResourceFilter("all"); }} role="tab" aria-selected={tab === "images"}>图片资产 <span className="tab-count">{tab === "images" ? filtered.length : ""}</span></button><button className={`tab ${tab === "templates" ? "active" : ""}`} type="button" onClick={() => { setTab("templates"); setResourceFilter("all"); }} role="tab" aria-selected={tab === "templates"}>提示词模板 <span className="tab-count">{tab === "templates" ? filtered.length : ""}</span></button></div>
        <div className="style-library-toolbar"><div className="search-wrap"><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load().catch(() => undefined); }} placeholder={tab === "images" ? "搜索图片资产" : "搜索提示词模板"} /></div><button className="btn" type="button" onClick={() => load().catch(() => undefined)}>搜索</button></div>
        <div className="style-boundary"><strong>当前范围</strong><span>{tab === "images" ? "商品实拍原图、白底底图、AI 生成结果、过程图和爆品图反推。" : "System Prompt、User Prompt、inputSchema 和版本状态。"}</span><span className="badge pass">独立资源页</span></div>
        {showReverseForm && tab === "images" && <div className="style-library-reverse-form"><div><strong>保存爆品图反推</strong><span>复用已上传到对象存储的图片地址，并保存反推提示词。</span></div><input className="input" placeholder="标题" value={reverseForm.title} onChange={(event) => setReverseForm({ ...reverseForm, title: event.target.value })} /><input className="input" placeholder="MinIO objectKey" value={reverseForm.objectKey} onChange={(event) => setReverseForm({ ...reverseForm, objectKey: event.target.value })} /><textarea className="textarea" placeholder="反推提示词" value={reverseForm.prompt} onChange={(event) => setReverseForm({ ...reverseForm, prompt: event.target.value })} /><textarea className="textarea" placeholder="视觉结构 JSON（可选）" value={reverseForm.visualStructure} onChange={(event) => setReverseForm({ ...reverseForm, visualStructure: event.target.value })} /><div><button className="btn btn-primary" type="button" onClick={() => saveReverse().catch(() => undefined)}>保存资产</button><button className="btn btn-ghost" type="button" onClick={() => setShowReverseForm(false)}>取消</button></div></div>}
        <div className="style-results"><div className="style-grid">{loading ? <div className="style-library-loading">正在加载资源…</div> : filtered.length ? filtered.map((item) => <article className={`style-card ${selected?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => { setSelected(item); if (item.resourceType !== "input_image") setPromptModal(item); }}><div className="style-image">{resourcePreview(item)}<span className={`badge ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></div><div className="style-card-body"><div className="style-card-title">{item.title}</div><p className="style-card-summary">{item.resourceType === "prompt_template" ? `${stageLabel(item.stage)} · v${String(item.source?.versionNo ?? "-")}` : item.summary || stageLabel(item.stage)}</p><div className="style-card-meta"><span>{resourceLabel(item)}</span><span>{item.resourceVersionId.slice(0, 8)}</span></div></div></article>) : <div className="style-library-empty"><strong>没有匹配的资源</strong><p>可以调整搜索词、状态或左侧资源类型筛选。</p></div>}</div></div>
      </section>
      <aside className="panel right style-inspector">
        <header className="panel-header"><div><strong className="panel-title">资源详情</strong><div className="panel-subtitle">查看提示词快照和版本信息</div></div>{selected && <button className="icon-btn" type="button" aria-label="清除详情" onClick={() => setSelected(null)}><Icon name="x" /></button>}</header>
        {selected ? <div className="inspector-body"><figure className="style-detail-image">{selected.previewUrl ? <img src={selected.previewUrl} alt={selected.title} /> : resourcePreview(selected)}</figure><section className="inspector-section style-overview"><span className={`badge ${statusClass(selected.status)}`}>{statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.summary || stageLabel(selected.stage)}</p><div className="resource-card-meta"><span className="badge">{resourceLabel(selected)}</span><span className="badge">{stageLabel(selected.stage)}</span></div></section><section className="inspector-section"><h3>资源信息</h3><dl className="definition-list"><dt>资源 ID</dt><dd className="mono">{selected.id}</dd><dt>版本</dt><dd>{selected.resourceVersionId}</dd><dt>来源</dt><dd className="mono">{String(selected.source?.objectKey ?? selected.source?.code ?? "工作台业务对象")}</dd><dt>更新时间</dt><dd>{new Date(selected.updatedAt).toLocaleString("zh-CN")}</dd></dl></section><section className="inspector-section"><h3>提示词</h3>{selected.resourceType === "input_image" ? <div className="resource-prompt-empty"><strong>原始输入图不适用生成提示词</strong><p>实拍原图只作为商品事实和外观依据保存。</p></div> : <div className="style-library-prompt-entry"><div><strong>已保存提示词快照</strong><span>{selected.resourceType === "prompt_template" ? "模板正文" : "生成时使用的提示词"}</span></div><button className="btn" type="button" onClick={() => setPromptModal(selected)}>查看提示词</button></div>}</section>{selected.resourceType !== "input_image" && <section className="inspector-section"><h3>生成参数</h3><dl className="definition-list"><dt>图片比例</dt><dd>{ratioFor(selected)}</dd><dt>图片尺寸</dt><dd>{dimensionsFor(selected)}</dd><dt>清晰度</dt><dd>{promptSnapshotValue(selected, "quality")}</dd><dt>模型</dt><dd>{promptSnapshotValue(selected, "model")}</dd></dl></section>}{selected.resourceType === "prompt_template" && <section className="inspector-section"><h3>模板版本</h3><div className="style-library-version-list">{templateVersions.map((version) => <div key={version.templateVersionId}><span>v{version.versionNo} · {version.status}</span><small>{version.templateVersionId.slice(0, 8)}</small></div>)}</div><button className="btn" type="button" onClick={() => copyTemplate().catch(() => undefined)}>复制新草稿</button></section>}{selected.resourceType === "reverse_reference_asset" && <section className="inspector-section"><div className="style-library-actions"><button className="btn btn-primary" type="button" disabled={selected.status === "published"} onClick={() => changeStatus(selected, "published")}>发布</button><button className="btn" type="button" disabled={selected.status === "archived"} onClick={() => changeStatus(selected, "archived")}>归档</button></div></section>}<div className="resource-selection"><Icon name="sparkles" /><div><strong>历史引用保持稳定</strong><span>资源版本和提示词快照会随引用一起保存，不覆盖已有请求。</span></div></div></div> : <div className="style-library-inspector-empty"><Icon name="library" /><strong>选择一项资源</strong><span>从中间列表选择图片或提示词模板，查看详情和提示词。</span></div>}
      </aside>
    </main>
    {promptModal && <div className="style-library-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPromptModal(null); }}><section className="style-library-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="style-library-prompt-title"><header><div><span className="style-library-modal-kicker">PROMPT SNAPSHOT</span><h2 id="style-library-prompt-title">{promptModal.title}</h2><p>{resourceLabel(promptModal)} · {stageLabel(promptModal.stage)}</p></div><button className="icon-btn" type="button" aria-label="关闭提示词" onClick={() => setPromptModal(null)}><Icon name="x" /></button></header><div className="style-library-modal-body"><div className="style-library-modal-image">{promptModal.previewUrl ? <img src={promptModal.previewUrl} alt={promptModal.title} /> : resourcePreview(promptModal)}</div><div className="style-library-modal-content"><div className="style-library-modal-meta"><span><b>比例</b>{ratioFor(promptModal)}</span><span><b>尺寸</b>{dimensionsFor(promptModal)}</span><span><b>清晰度</b>{promptSnapshotValue(promptModal, "quality")}</span><span><b>模型</b>{promptSnapshotValue(promptModal, "model")}</span></div><div className="style-library-modal-prompt-head"><strong>提示词内容</strong><span>历史快照，只读</span></div><pre className="style-library-modal-prompt">{promptTextFor(promptModal)}</pre></div></div></section></div>}
    {error && <div className="suite-toast show" role="alert">{error}</div>}
    {toast && <div className="suite-toast show" role="status">{toast}</div>}
  </div>;
}
