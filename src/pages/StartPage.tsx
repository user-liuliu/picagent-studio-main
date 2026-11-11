import { useEffect, useMemo, useRef, useState } from "react";
import { suiteApi, type ApiBaseHistory, type ApiCategoryPromptState, type ApiImage, type ApiPlanSnapshot, type ApiPlatformProfile, type ApiPromptInputField, type ApiPromptTemplate, type ApiRagChunk, type ApiSuite, type ApiStructurePlan } from "../api/client";
import { inputForTemplate, structurePlanDynamicInput, updatePromptInputValue } from "../features/plan/plan-input";
import { Icon, ImageWithState } from "./shared";

type GenerationModal = { kind: "running" | "success" | "error"; title: string; message: string; completed?: number; total?: number };
type UploadProgressItem = { id: string; name: string; progress: number; status: "uploading" | "done" | "error" };

const OPTION_LABELS: Record<string, string> = {
  fixed: "固定数量",
  auto: "按产品特性生成",
  provided: "用户提供",
  no_brand: "无品牌",
  derive: "根据产品特性生成",
  to_confirm: "待补充",
  combined: "主图和详情页",
  main_only: "仅主图",
  detail_only: "仅详情页",
};

const DETAIL_CATEGORIES = [
  ["appearance_angles", "多角度外观图"], ["lifestyle_use", "生活场景图"], ["feature_benefit", "信息卖点图"], ["material_detail", "细节特写图"],
  ["size_scale", "尺寸规格图"], ["included_items", "配件全家福"], ["compatibility_application", "适配与应用图"], ["variant_bundle", "组合与变体图"],
  ["packaging_unboxing", "包装与开箱图"], ["care_instruction", "使用与维护图"],
] as const;
const DETAIL_CATEGORY_NAMES: Record<string, string> = { main: "主图组", ...Object.fromEntries(DETAIL_CATEGORIES) };
const RECENT_PAGE_SIZE = 6;

type BriefInput = {
  platform: string;
  output_language: string;
  product_name: string;
  human_supplement: string;
  emphasis_requirements: string;
  design_constraints: string;
};

const EMPTY_BRIEF: BriefInput = {
  platform: "",
  output_language: "英文",
  product_name: "",
  human_supplement: "",
  emphasis_requirements: "",
  design_constraints: "",
};

function stylePrompt(card: Record<string, unknown>): string {
  if (typeof card.promptPrefix === "string") return card.promptPrefix;
  return Object.values(card).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []).join("；");
}

function optionLabel(field: ApiPromptInputField, option: string): string {
  if (field.key === "design_style_mode" && option === "auto") return "自动判断";
  return OPTION_LABELS[option] ?? option;
}

function RagReferences({ chunks, query, selectedChunkIds, setQuery, setSelectedChunkIds, supplement, setSupplement, disabled }: {
  chunks: ApiRagChunk[];
  query: string;
  selectedChunkIds: string[];
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setSelectedChunkIds: React.Dispatch<React.SetStateAction<string[]>>;
  supplement: string;
  setSupplement: (value: string) => void;
  disabled: boolean;
}) {
  return <section className="start-rag" aria-labelledby="rag-title"><div className="start-rag-head"><div><h3 id="rag-title">商品资料</h3><span>只冻结明确勾选的资料；未选择资料也可以继续规划。</span></div><span className="start-selection-count">已选 {selectedChunkIds.length} 条</span></div><div className="start-rag-browser"><label className="start-search"><Icon name="zoom-in" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索商品类别或素材组" disabled={disabled} /></label><div className="start-chunk-list">{chunks.length ? chunks.map((chunk) => <label className={`start-chunk ${selectedChunkIds.includes(chunk.id) ? "selected" : ""}`} key={`${chunk.id}:${chunk.version}`}><input type="checkbox" disabled={disabled} checked={selectedChunkIds.includes(chunk.id)} onChange={() => setSelectedChunkIds(selectedChunkIds.includes(chunk.id) ? selectedChunkIds.filter((id) => id !== chunk.id) : [...selectedChunkIds, chunk.id])} /><span><strong>{chunk.title}</strong><small>{chunk.id} · v{chunk.version} · {chunk.sourceKind === "validation_seed" ? "验证资料" : chunk.sourceKind}</small><p>{chunk.summary}</p></span><em>已发布</em></label>) : <p className="start-rag-empty">暂未检索到商品资料，可使用图片与人工补充事实继续规划。</p>}</div></div><label className="start-supplement"><span>补充商品事实（选填）</span><textarea disabled={disabled} value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="填写资料中没有但本次允许使用的真实参数、配件、兼容关系或卖点。" /><small>整段内容会作为当前方案的人工确认事实冻结。</small></label></section>;
}

function DynamicField({ field, value, onChange, platforms, className = "" }: {
  field: ApiPromptInputField;
  value: unknown;
  onChange: (value: string) => void;
  platforms?: ApiPlatformProfile[];
  className?: string;
}) {
  const options = field.options ?? [];
  return <label className={`start-field ${className}`}>
    <span>{field.label}{field.required ? " *" : ""}</span>
    {field.key === "platform" ? <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择目标平台</option>
      <optgroup label="海外平台">{(platforms ?? []).filter((item) => item.marketScope === "overseas").map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</optgroup>
      <optgroup label="国内平台">{(platforms ?? []).filter((item) => item.marketScope === "domestic").map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</optgroup>
    </select> : field.type === "textarea" ? <textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /> : field.type === "select" ? <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option} key={option}>{optionLabel(field, option)}</option>)}</select> : <input type={field.type === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

export function StartPage({ suiteId, navigate }: { suiteId?: string; navigate: (to: string) => void }) {
  const [suite, setSuite] = useState<ApiSuite | null>(null);
  const [recentSuites, setRecentSuites] = useState<ApiSuite[]>([]);
  const [recentPage, setRecentPage] = useState(1);
  const [name, setName] = useState("");
  const [images, setImages] = useState<ApiImage[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [structureTemplates, setStructureTemplates] = useState<ApiPromptTemplate[]>([]);
  const [baseTemplates, setBaseTemplates] = useState<ApiPromptTemplate[]>([]);
  const [platforms, setPlatforms] = useState<ApiPlatformProfile[]>([]);
  const [baseTemplateId, setBaseTemplateId] = useState("");
  const [briefInput, setBriefInput] = useState<BriefInput>(EMPTY_BRIEF);
  const [baseInput, setBaseInput] = useState<Record<string, unknown>>({});
  const [query, setQuery] = useState("");
  const [chunks, setChunks] = useState<ApiRagChunk[]>([]);
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);
  const [planSnapshot, setPlanSnapshot] = useState<ApiPlanSnapshot | null>(null);
  const [structureSnapshot, setStructureSnapshot] = useState<ApiPlanSnapshot | null>(null);
  const [categoryPromptState, setCategoryPromptState] = useState<ApiCategoryPromptState | null>(null);
  const [structureAttemptId, setStructureAttemptId] = useState<string | null>(null);
  const [structureGenerating, setStructureGenerating] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [confirmingStructure, setConfirmingStructure] = useState(false);
  const [structureRequestFingerprint, setStructureRequestFingerprint] = useState("");
  const [structureInput, setStructureInput] = useState({ main_image_count: 1, detail_image_count_min: 3, detail_image_count_max: 5, selected_detail_categories: ["appearance_angles", "lifestyle_use", "feature_benefit"] as string[], category_requirements: { appearance_angles: "required", lifestyle_use: "required", feature_benefit: "optional" } as Record<string, "required" | "optional"> });
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>([]);
  const [ragOpen, setRagOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [baseHistory, setBaseHistory] = useState<Record<string, ApiBaseHistory>>({});
  const [previewVersionIds, setPreviewVersionIds] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const [structureProgress, setStructureProgress] = useState(0);
  const [categoryProgressById, setCategoryProgressById] = useState<Record<string, number>>({});
  const [modal, setModal] = useState<GenerationModal | null>(null);
  const generationLock = useRef<string | null>(null);
  const uploadCleanupTimer = useRef<number | null>(null);
  const structureReviewRef = useRef<HTMLElement | null>(null);
  const scrollToReviewAfterResult = useRef(false);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const selectedChunks = useMemo(() => chunks.filter((chunk) => selectedChunkIds.includes(chunk.id)), [chunks, selectedChunkIds]);
  const current = images.find((image) => image.id === currentId) ?? images[0] ?? null;
  const currentHistory = current ? baseHistory[current.id] : undefined;
  const previewVersionId = current ? previewVersionIds[current.id] ?? currentHistory?.currentVersionId ?? currentHistory?.versions[0]?.id : undefined;
  const previewVersion = currentHistory?.versions.find((version) => version.id === previewVersionId) ?? null;
  const latestFailedAttempt = currentHistory?.attempts.find((attempt) => attempt.status === "failed") ?? null;
  const currentRunningAttempt = currentHistory?.attempts.find((attempt) => attempt.status === "running") ?? null;
  const runningImageIds = images.filter((image) => baseHistory[image.id]?.attempts.some((attempt) => attempt.status === "running")).map((image) => image.id);
  const pendingImages = images.filter((image) => !baseHistory[image.id]?.currentVersionId && !runningImageIds.includes(image.id));
  const imageIdsKey = images.map((image) => image.id).join(",");
  const baseTemplate = baseTemplates.find((item) => item.templateVersionId === baseTemplateId);
  const selectedPlatform = platforms.find((item) => item.code === briefInput.platform || item.name === briefInput.platform);
  const categoryExpectedRequestCount = categoryPromptState?.expectedRequestCount ?? (() => { const value = structureSnapshot?.structure; if (!value) return 0; return (value.mainAllocation?.count ?? value.mainImageCount ?? 0) > 0 ? 1 + value.categoryAllocations.filter((row) => row.count > 0).length : value.categoryAllocations.filter((row) => row.count > 0).length; })();
  const categoryPromptsComplete = categoryPromptState?.status === "succeeded" && categoryPromptState.requests.length >= categoryExpectedRequestCount;
  const v11Ready = structureSnapshot?.confirmationStatus === "confirmed" && categoryPromptsComplete;
  const planningFingerprint = JSON.stringify({ imageIds: images.map((image) => image.id), chunkIds: selectedChunkIds, briefInput, structureInput });
  const structureStale = Boolean(structureSnapshot && structureRequestFingerprint && planningFingerprint !== structureRequestFingerprint && structureSnapshot.confirmationStatus !== "confirmed");
  const categoryProgressKey = (categoryPromptState?.requests ?? []).map((request) => `${request.id}:${request.status}:${request.items.length}`).join("|");
  const categoryOverallProgress = categoryExpectedRequestCount ? Math.round((categoryPromptState?.requests.reduce((sum, request) => sum + (request.status === "succeeded" ? 100 : categoryProgressById[request.id] ?? 0), 0) ?? 0) / categoryExpectedRequestCount) : 0;
  const recentPageCount = Math.max(1, Math.ceil(recentSuites.length / RECENT_PAGE_SIZE));
  const pagedRecentSuites = recentSuites.slice((recentPage - 1) * RECENT_PAGE_SIZE, recentPage * RECENT_PAGE_SIZE);

  useEffect(() => {
    if (!batchGenerating) { setSimulatedProgress(0); return; }
    const timer = window.setInterval(() => setSimulatedProgress((value) => Math.min(96, value + Math.max(1, Math.ceil((96 - value) / 10)))), 450);
    return () => window.clearInterval(timer);
  }, [batchGenerating]);

  useEffect(() => {
    if (!structureGenerating) { setStructureProgress(0); return; }
    setStructureProgress((value) => value || 5);
    const timer = window.setInterval(() => setStructureProgress((value) => Math.min(94, value + (value < 45 ? 3 : value < 78 ? 2 : 1))), 900);
    return () => window.clearInterval(timer);
  }, [structureGenerating]);

  useEffect(() => {
    const requests = categoryPromptState?.requests ?? [];
    if (!requests.length) { setCategoryProgressById({}); return; }
    setCategoryProgressById((current) => Object.fromEntries(requests.map((request) => [request.id, request.status === "succeeded" ? 100 : request.status === "running" ? Math.max(current[request.id] ?? 0, 5) : current[request.id] ?? 0])));
    const runningIds = requests.filter((request) => request.status === "running").map((request) => request.id);
    if (!runningIds.length) return;
    const timer = window.setInterval(() => setCategoryProgressById((current) => ({ ...current, ...Object.fromEntries(runningIds.map((id) => { const value = current[id] ?? 5; return [id, Math.min(94, value + (value < 45 ? 3 : value < 78 ? 2 : 1))]; })) })), 900);
    return () => window.clearInterval(timer);
  }, [categoryProgressKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([suiteApi.listPromptTemplates("base_refine"), suiteApi.listPromptTemplates("structure_plan"), suiteApi.listPlatforms(), suiteApi.list()]).then(([bases, structures, platformProfiles, suites]) => {
      if (cancelled) return;
      setBaseTemplates(bases); setStructureTemplates(structures);
      setPlatforms(platformProfiles);
      setRecentSuites(suites);
      setBaseTemplateId((value) => value || bases[0]?.templateVersionId || "");
      setBaseInput((value) => inputForTemplate(bases[0], value));
      setBriefInput((value) => value.platform ? value : { ...value, platform: platformProfiles.find((item) => item.name === "Amazon")?.code ?? platformProfiles[0]?.code ?? "" });
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setRecentPage((page) => Math.min(page, recentPageCount));
  }, [recentPageCount]);

  useEffect(() => {
    let cancelled=false; const timer=window.setTimeout(()=>{suiteApi.searchChunks(query).then((items)=>{if(!cancelled)setChunks(items);}).catch((cause:Error)=>{if(!cancelled)setError(cause.message);});},250);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[query]);

  useEffect(() => {
    // A route change must discard transient state from the previous suite.
    if (!suiteId || suiteId === "new") {
      setSuite(null);
      setImages([]);
      setCurrentId(null);
      setBaseHistory({});
      setPreviewVersionIds({});
      setUploadProgress([]);
      setUploading(false);
      return;
    }
    setSuite(null);
    setImages([]);
    setCurrentId(null);
    setBaseHistory({});
    setPreviewVersionIds({});
    setUploadProgress([]);
    setUploading(false);
    setError(""); suiteApi.get(suiteId).then((data) => {
      setSuite(data); setName(data.name); setImages(data.inputImages); setCurrentId(data.inputImages[0]?.id ?? null);
      setBriefInput((value) => value.product_name ? value : { ...value, product_name: data.name });
    }).catch((cause: Error) => setError(cause.message));
    suiteApi.getPlan(suiteId).then((state)=>{const snapshot=state.snapshot;setPlanSnapshot(snapshot?.phase === "structure_plan" ? null : snapshot);}).catch(()=>undefined);
    suiteApi.getStructurePlan(suiteId).then((state)=>{const snapshot=state.snapshot;setStructureSnapshot(snapshot);setStructureAttemptId(state.attempt?.status === "running" ? state.attempt.id : null);setStructureGenerating(state.attempt?.status === "running");setStructureError(state.attempt?.status === "failed" ? state.attempt.errorMessage ?? "结构计划生成失败" : "");if(snapshot){const input=snapshot.dynamicInput;setBriefInput((value)=>({platform:String(input.platform??value.platform),output_language:String(input.output_language??value.output_language),product_name:String(input.product_name??value.product_name),human_supplement:String(input.human_supplement??input.product_facts??value.human_supplement),emphasis_requirements:String(input.emphasis_requirements??value.emphasis_requirements),design_constraints:String(input.design_constraints??input.design_style??value.design_constraints)}));setSelectedChunkIds(snapshot.chunks.map((chunk)=>chunk.sourceChunkId));}}).catch(()=>undefined);
    suiteApi.getCategoryPrompts(suiteId).then(setCategoryPromptState).catch(()=>undefined);
  }, [suiteId]);

  useEffect(() => { if (!structureAttemptId || !structureGenerating) return; const timer = window.setInterval(() => { suiteApi.getPlanAttempt(structureAttemptId).then((attempt) => { if (attempt.status === "running") return; setStructureGenerating(false); setStructureAttemptId(null); if (attempt.status === "failed") { setStructureError(attempt.errorMessage ?? "结构计划生成失败"); } else if (attempt.snapshot) { setStructureSnapshot(attempt.snapshot); setStructureError(""); notify("图片结构计划已生成，请审核并确认"); } }).catch((cause: Error) => { setStructureGenerating(false); setStructureError(cause.message); }); }, 1000); return () => window.clearInterval(timer); }, [structureAttemptId, structureGenerating]);

  useEffect(()=>{if(!suite || !categoryPromptState || (categoryPromptState.status !== "running" && categoryPromptState.requests.length >= categoryExpectedRequestCount))return;const timer=window.setInterval(()=>{suiteApi.getCategoryPrompts(suite.id).then(setCategoryPromptState).catch(()=>undefined);},1500);return()=>window.clearInterval(timer);},[suite,categoryPromptState?.status,categoryPromptState?.requests.length,categoryExpectedRequestCount]);
  useEffect(()=>{if(!scrollToReviewAfterResult.current||(!structureSnapshot&&!structureError))return;scrollToReviewAfterResult.current=false;window.setTimeout(()=>{structureReviewRef.current?.scrollIntoView({behavior:"smooth",block:"start"});structureReviewRef.current?.focus({preventScroll:true});},80);},[structureSnapshot?.id,structureError]);

  useEffect(() => {
    if (!suite || !imageIdsKey) return;
    let cancelled = false;
    Promise.all(images.map(async (image) => [image.id, await suiteApi.getBaseVersions(suite.id, image.id)] as const)).then((histories) => {
      if (cancelled) return;
      setBaseHistory((value) => ({ ...value, ...Object.fromEntries(histories) }));
      setPreviewVersionIds((value) => ({ ...value, ...Object.fromEntries(histories.flatMap(([imageId, history]) => history.currentVersionId && !value[imageId] ? [[imageId, history.currentVersionId]] : [])) }));
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [suite, imageIdsKey]);

  const createSuite = async () => {
    if (!name.trim()) { setError("请输入方案名称"); return; }
    setCreating(true); setError("");
    try { const created = await suiteApi.create(name.trim()); navigate(`/suites/${created.id}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); } finally { setCreating(false); }
  };

  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!suite) { setError("请先创建方案"); return; }
    if (!files.length) return;
    if (images.length + files.length > 6) { const message = `最多上传 6 张原图，还可上传 ${Math.max(0, 6 - images.length)} 张`; setError(message); setModal({ kind: "error", title: "无法继续上传", message }); return; }
    setUploading(true); setError("");
    const rows = files.map((file, index) => ({ id: `${file.name}:${file.size}:${file.lastModified}:${index}`, name: file.name, progress: 0, status: "uploading" as const }));
    setUploadProgress(rows);
    try {
      const results = await Promise.allSettled(files.map(async (file, index) => {
        const rowId = rows[index].id;
        try {
          const image = await suiteApi.upload(suite.id, file, images.length + index + 1, (value) => setUploadProgress((currentRows) => currentRows.map((row) => row.id === rowId ? { ...row, progress: value } : row)));
          setImages((currentImages) => [...currentImages, image]);
          setBaseHistory((value) => ({ ...value, [image.id]: { currentVersionId: null, versions: [], attempts: [] } }));
          setCurrentId((value) => value ?? image.id);
          setUploadProgress((currentRows) => currentRows.map((row) => row.id === rowId ? { ...row, progress: 100, status: "done" } : row));
        } catch (cause) {
          setUploadProgress((currentRows) => currentRows.map((row) => row.id === rowId ? { ...row, status: "error" } : row));
          throw cause;
        }
      }));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new Error(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : "上传失败").join("\n"));
      notify(`已上传 ${files.length} 张原图`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败"); }
    finally {
      setUploading(false);
      if (uploadCleanupTimer.current) window.clearTimeout(uploadCleanupTimer.current);
      const batchIds = new Set(rows.map((row) => row.id));
      uploadCleanupTimer.current = window.setTimeout(() => setUploadProgress((currentRows) => currentRows.filter((row) => !batchIds.has(row.id))), 900);
    }
  };

  const refreshBaseHistory = async (imageId: string) => {
    if (!suite) return;
    const history = await suiteApi.getBaseVersions(suite.id, imageId);
    setBaseHistory((value) => ({ ...value, [imageId]: history }));
    return history;
  };

  const generateBase = async (image: ApiImage) => {
    if (!suite) throw new Error("请先创建方案");
    if (!baseTemplate) throw new Error("没有可用的已发布底图模板");
    const started = await suiteApi.generateBase(suite.id, image.id, baseTemplate.templateVersionId, { ...baseInput, source_image_ids: image.id });
    const deadline = Date.now() + 900_000;
    while (Date.now() < deadline) {
      const history = await refreshBaseHistory(image.id);
      const attempt = history?.attempts.find((item) => item.id === started.attempt.id);
      if (attempt?.status === "failed") throw new Error(attempt.errorMessage ?? "精修失败");
      if (attempt?.status === "succeeded") {
        const version = history?.versions.find((item) => item.versionNumber === attempt.versionNumber) ?? null;
        if (version) setPreviewVersionIds((value) => ({ ...value, [image.id]: version.id }));
        return { attempt, version };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    throw new Error("精修仍在后台执行，请稍后查看历史版本");
  };

  useEffect(() => {
    if (!suite || !runningImageIds.length || batchGenerating) return;
    const timer = window.setInterval(() => {
      void Promise.all(runningImageIds.map((imageId) => refreshBaseHistory(imageId))).catch((cause: Error) => setError(cause.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [suite?.id, runningImageIds.join(","), batchGenerating]);

  const generateAll = async () => {
    if (!suite || generationLock.current || !pendingImages.length) return;
    const targets = [...pendingImages];
    generationLock.current = "batch"; setBatchGenerating(true); setSimulatedProgress(4); setGeneratingId(current?.id ?? null); setError("");
    setModal({ kind: "running", title: "正在一键精修", message: `正在处理 ${targets.length} 张原图，请勿重复点击。`, completed: 0, total: targets.length });
    const failures: string[] = [];
    let completed = 0;
    for (const image of targets) {
      try {
        await generateBase(image);
        completed += 1;
        setSimulatedProgress(Math.round((completed / targets.length) * 100));
        setModal({ kind: "running", title: "正在一键精修", message: `已完成 ${completed}/${targets.length} 张原图。`, completed, total: targets.length });
      } catch (cause) {
        failures.push(`${image.originalFilename}：${cause instanceof Error ? cause.message : "精修失败"}`);
        await refreshBaseHistory(image.id).catch(() => undefined);
      }
    }
    generationLock.current = null; setBatchGenerating(false); setGeneratingId(null);
    if (failures.length) {
      const message = failures.join("\n");
      setError(message); setModal({ kind: "error", title: `有 ${failures.length} 张原图精修失败`, message });
    } else {
      setModal({ kind: "success", title: "一键精修完成", message: `已生成 ${completed} 张白底底图，并保存到历史版本。` });
    }
  };

  const removeImage = async (image: ApiImage) => {
    if (!suite || batchGenerating) return;
    try {
      await suiteApi.removeInputImage(suite.id, image.id);
      const nextImages = images.filter((item) => item.id !== image.id);
      setImages(nextImages); setBaseHistory((value) => { const next = { ...value }; delete next[image.id]; return next; });
      setCurrentId((value) => value === image.id ? nextImages[0]?.id ?? null : value);
      notify("已取消这张原图");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "取消原图失败";
      setError(message); setModal({ kind: "error", title: "无法取消原图", message });
    }
  };

  const selectBaseVersion = async () => {
    if (!suite || !current || !previewVersion) return;
    setError("");
    try {
      await suiteApi.selectBaseVersion(suite.id, current.id, previewVersion.id);
      await refreshBaseHistory(current.id);
      notify(`已将版本 ${previewVersion.versionNumber} 设为当前底图`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "版本选择失败"); }
  };

  const changeBaseTemplate = (value: string) => {
    const next = baseTemplates.find((item) => item.templateVersionId === value);
    setBaseTemplateId(value); setBaseInput((currentValue) => inputForTemplate(next, currentValue));
  };
  const updateInput = (setter: React.Dispatch<React.SetStateAction<Record<string, unknown>>>, field: ApiPromptInputField, rawValue: string) => {
    setter((currentValue) => updatePromptInputValue(currentValue, field, rawValue));
  };
  const toggleCategory = (code: string) => setStructureInput((value) => { const selected = value.selected_detail_categories.includes(code) ? value.selected_detail_categories.filter((item) => item !== code) : [...value.selected_detail_categories, code]; const nextRequirements = { ...value.category_requirements }; if (!selected.includes(code)) delete nextRequirements[code]; else if (!nextRequirements[code]) nextRequirements[code] = "optional"; return { ...value, selected_detail_categories: selected, category_requirements: nextRequirements }; });
  const generateStructurePlan = async () => {
    const template = structureTemplates[0];
    if (!suite || !template) return;
    if (!briefInput.platform) { setError("请选择目标平台"); return; }
    if (structureInput.detail_image_count_min > structureInput.detail_image_count_max) { setError("详情图数量范围无效"); return; }
    if (!structureInput.selected_detail_categories.length) { setError("至少选择一个详情图类别"); return; }
    const currentFingerprint = planningFingerprint;
    setStructureRequestFingerprint(currentFingerprint);
    setStructureGenerating(true);
    setStructureError("");
    setError("");
    scrollToReviewAfterResult.current = true;
    try {
      const started = await suiteApi.generateStructurePlan(suite.id, template.templateVersionId, structurePlanDynamicInput(briefInput, structureInput), selectedChunks);
      setStructureAttemptId(started.attemptId);
    } catch (cause) {
      setStructureGenerating(false);
      setStructureError(cause instanceof Error ? cause.message : "结构计划生成失败");
    }
  };
  const updateStructure = (update: (structure: ApiStructurePlan) => ApiStructurePlan) => setStructureSnapshot((currentValue) => currentValue?.structure ? { ...currentValue, structure: update(currentValue.structure) } : currentValue);
  const updateMainAllocation = (update: (row: NonNullable<ApiStructurePlan["mainAllocation"]>) => NonNullable<ApiStructurePlan["mainAllocation"]>) => updateStructure((currentStructure) => currentStructure.mainAllocation ? ({ ...currentStructure, mainAllocation: update(currentStructure.mainAllocation) }) : currentStructure);
  const updateAllocation = (category: string, update: (row: ApiStructurePlan["categoryAllocations"][number]) => ApiStructurePlan["categoryAllocations"][number]) => updateStructure((structure) => ({ ...structure, categoryAllocations: structure.categoryAllocations.map((row) => row.category === category ? update(row) : row) }));
  const addReviewCategory = (category: string) => updateStructure((structure) => structure.categoryAllocations.some((row) => row.category === category) ? structure : ({ ...structure, categoryAllocations: [...structure.categoryAllocations, { category, requirement: "optional", count: 0, reason: "设计师新增类别，待确认", sourceImageIds: images.map((image) => image.id), factRefs: [], missingFacts: [] }] }));
  const removeReviewCategory = (category: string) => updateStructure((structure) => ({ ...structure, categoryAllocations: structure.categoryAllocations.filter((row) => row.category !== category) }));
  const generateCategoryPrompts = async (snapshot = structureSnapshot) => { if (!suite || !snapshot || snapshot.confirmationStatus !== "confirmed") return; try { await suiteApi.generateCategoryPrompts(suite.id, snapshot.id); setCategoryPromptState(await suiteApi.getCategoryPrompts(suite.id)); notify("类别提示词已开始生成"); } catch (cause) { setError(cause instanceof Error ? cause.message : "类别提示词生成失败"); } };
  const confirmAndGenerateCategoryPrompts = async () => {
    if (!suite || !structureSnapshot?.structure) return;
    setConfirmingStructure(true);
    setError("");
    try {
      const confirmed = await suiteApi.confirmStructurePlan(suite.id, structureSnapshot.structure);
      setStructureSnapshot(confirmed);
      await generateCategoryPrompts(confirmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "确认结构计划失败");
    } finally {
      setConfirmingStructure(false);
    }
  };
  const retryCategoryPrompt = async (categoryCode: string) => { if (!suite) return; try { await suiteApi.retryCategoryPrompt(suite.id, categoryCode); setCategoryPromptState(await suiteApi.getCategoryPrompts(suite.id)); notify("已重新请求该类别"); } catch (cause) { setError(cause instanceof Error ? cause.message : "类别重试失败"); } };
  const startCreation=async()=>{if(!suite)return;try{const readiness=await suiteApi.startCreationCheck(suite.id);await suiteApi.createTasks(suite.id,readiness.planSnapshotId);navigate(`/suites/${suite.id}/board`);}catch(cause){setError(cause instanceof Error?cause.message:"尚不能开始创作");}};
  const structureStatus = structureGenerating ? `规划中 ${structureProgress}%` : structureSnapshot?.confirmationStatus === "confirmed" ? "已确认" : structureSnapshot ? "待审核" : structureError ? "生成失败" : "待填写";
  const structure = structureSnapshot?.structure;
  const mainAllocation = structure?.mainAllocation ?? (structure ? { category: "main" as const, count: structure.mainImageCount ?? structureInput.main_image_count, reason: "主图数量由设计师确定；V2 将补充主图组参考图和事实范围。", sourceImageIds: images.map((image) => image.id), factRefs: [], missingFacts: [] } : null);
  const hasMissingFacts = Boolean(mainAllocation?.missingFacts.length || structure?.categoryAllocations.some((row) => row.missingFacts.length && (row.requirement === "required" || row.count > 0)));
  const detailAllocatedCount = structure?.categoryAllocations.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const detailCountsMatch = Boolean(structure && detailAllocatedCount === structure.detailImageCount);
  const title = suite?.name ?? "新建套图方案";
  return <div className="start-shell">
    <header className="start-topbar"><a className="start-brand" href="/suites/new" onClick={(event) => { event.preventDefault(); navigate("/suites/new"); }}><img src="/logo.png" alt="" width={36} height={36} style={{ objectFit: "contain", flexShrink: 0 }} /><strong>PicAgent</strong></a><div className="start-context"><span>内部图片生产</span><i>/</i><strong>{title}</strong></div><div className="start-top-actions"><span className="start-sync"><b></b>资料源已同步</span><button className="start-avatar" type="button" aria-label="当前用户沈">沈</button></div></header>
    <aside className="start-sidebar" aria-label="主导航"><a className="start-nav active" href="/suites/new"><Icon name="sparkles" /><span>创建</span></a><button className="start-nav" type="button" onClick={() => notify("任务中心接口已预留")}><Icon name="tasks" /><span>任务</span></button><a className="start-nav" href="/style-library" onClick={(event) => { event.preventDefault(); navigate("/style-library"); }}><Icon name="library" /><span>风格库</span></a><span className="start-nav-spacer"></span></aside>
    <main className="start-main">
      <section className="start-heading"><div><p className="start-eyebrow">CREATE FROM EVIDENCE</p><h1>从商品实拍到套图方案</h1><p>先确认产品真实外观，再用模板、商品资料与设计要求组装本次生成简报。</p></div><div className="start-heading-meta"><span>方案</span><strong>{title}</strong><span>状态</span><strong>{suite ? "已保存" : "待创建"}</strong>{suite ? <button className="start-workbench-entry" type="button" onClick={startCreation}>进入工作台<Icon name="arrow-right" /></button> : recentSuites[0] ? <button className="start-workbench-entry" type="button" onClick={() => navigate(`/suites/${recentSuites[0].id}/board`)}>进入最近工作台<Icon name="arrow-right" /></button> : null}</div></section>
      {!suite && <section className="start-create-bar"><label><span>方案名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：耳机日本站套图" /></label><button className="start-primary" type="button" disabled={creating} onClick={createSuite}>{creating ? "创建中…" : "创建方案"}<Icon name="arrow-right" /></button></section>}
      {error && <div className="start-error" role="alert">{error}</div>}
      <nav className="start-mode-strip" aria-label="创作模式">{[["columns", "套图模式", "当前可用"], ["sparkles", "爆品图反推", "当前可用"], ["editor", "单图模式", "接口预留"], ["eye", "视频模式", "接口预留"], ["merge", "多配多", "接口预留"], ["layers", "SKU 套装", "接口预留"], ["history", "替换模式", "接口预留"]].map(([icon, label, status], index) => <button className={index === 0 ? "active" : ""} type="button" key={label} onClick={() => label === "爆品图反推" ? navigate("/reverse") : index > 0 && notify(`${label}接口已预留`)}><Icon name={icon} /><span>{label}</span><small>{status}</small></button>)}</nav>
      <section className="start-studio" aria-label="套图生成准备">
        <section className="start-evidence" aria-labelledby="evidence-title"><header className="start-section-head"><div><p className="start-eyebrow">PRODUCT EVIDENCE</p><h2 id="evidence-title">商品图对比</h2></div><span className="start-step-badge">01 · 底图准备</span></header>
          <div className="start-upload-toolbar"><label className={`start-upload-button ${!suite ? "requires-suite" : ""}`}><Icon name="plus" />{images.length ? "继续加图" : "上传商品实拍图"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={uploadFiles} disabled={uploading || batchGenerating || images.length >= 6} /></label><button className="start-batch-generate" type="button" disabled={!suite || batchGenerating || uploading || !pendingImages.length || !baseTemplate} onClick={generateAll}>{batchGenerating || runningImageIds.length ? "一键精修中…" : pendingImages.length ? `一键精修 ${pendingImages.length} 张` : "一键精修"}</button><span>{suite ? `${images.length}/6 张 · 还可上传 ${6 - images.length} 张` : "创建方案后上传商品图"}</span></div>{uploadProgress.length > 0 && <div className="start-upload-progress" role="status" aria-live="polite">{uploadProgress.map((item) => <div className="start-upload-progress-row" key={item.id}><span className="start-upload-progress-name" title={item.name}>{item.name}</span><span className="start-upload-progress-track"><i className={item.status === "error" ? "is-error" : ""} style={{ width: `${item.progress}%` }} /></span><strong>{item.status === "error" ? "失败" : `${item.progress}%`}</strong></div>)}</div>}<div className="start-template-row"><label><span>底图精修提示词模板</span><select value={baseTemplateId} onChange={(event) => changeBaseTemplate(event.target.value)} disabled={!baseTemplates.length}><option value="">{baseTemplates.length ? "请选择模板" : "暂无已发布模板"}</option>{baseTemplates.map((item) => <option value={item.templateVersionId} key={item.templateVersionId}>{item.name} · v{item.versionNo}</option>)}</select></label><div><span>模板来源</span><strong>{baseTemplates.length ? "PG 已发布版本" : "正在加载模板"}</strong><small>本次精修将冻结模板版本</small></div></div>{baseTemplate && baseTemplate.inputSchema.length > 0 && <div className="start-dynamic-fields">{baseTemplate.inputSchema.filter((field) => field.key !== "source_image_ids").map((field, index) => <DynamicField key={field.key} field={field} value={baseInput[field.key]} onChange={(value) => updateInput(setBaseInput, field, value)} className={index === baseTemplate.inputSchema.length - 2 ? "full" : ""} />)}</div>}
          {images.length > 0 && <div className="start-thumbnail-strip" aria-label="原图缩略图">{images.map((image) => <div className={`start-thumbnail-card ${image.id === current?.id ? "active" : ""}`} key={image.id}><button className="start-thumbnail-select" type="button" onClick={() => setCurrentId(image.id)}><ImageWithState src={image.thumbnailPreviewUrl} alt={image.originalFilename} loading="lazy" fetchPriority="low" retryable={false} /><span>{image.ordinal}</span></button><button className="start-thumbnail-remove" type="button" aria-label={`取消 ${image.originalFilename}`} disabled={batchGenerating} onClick={() => removeImage(image)}>×</button></div>)}</div>}
          <div className="start-compare-stack">
            <article className="start-image-card source">
              <div className="start-image-label"><span>原始实拍图</span><em>SOURCE</em></div>
              {current && !currentHistory?.attempts.length && <button className="start-preview-remove" type="button" aria-label={`取消 ${current.originalFilename}`} disabled={batchGenerating} onClick={() => removeImage(current)}>×</button>}
              {current ? <ImageWithState src={current.originalPreviewUrl} alt={current.originalFilename} loading="eager" fetchPriority="high" /> : <div className="start-image-placeholder">请先创建方案并上传原图</div>}
              <footer><div><strong>{current?.originalFilename ?? "尚未上传原图"}</strong><span>{current ? `${current.width} × ${current.height} · SHA-256 ${current.sha256.slice(0, 12)}…` : "支持 JPG、PNG、WebP，单张不超过 12MB"}</span></div></footer>
            </article>
            <div className="start-transform-line" aria-label="自动精修流程">
              <span><Icon name="sparkles" /></span>
              <div><strong>AI 自动精修</strong><small>点击上方“一键精修”，只处理尚未成功的原图</small></div>
              <em>{generatingId === current?.id || currentRunningAttempt ? "生成中" : currentHistory?.currentVersionId ? "已生成" : latestFailedAttempt ? "生成失败" : "未生成"}</em>
              <span className="start-transform-hint">{batchGenerating ? "请等待本轮完成" : "可继续上传原图"}</span>
            </div>
            <article className="start-image-card clean">
              <div className="start-image-label"><span>精修白底图</span><em>CLEAN BASE</em></div>
              {previewVersion ? <ImageWithState src={previewVersion.previewUrl} alt={`白底图版本 ${previewVersion.versionNumber}`} loading="lazy" /> : <div className="start-image-placeholder">点击上方“一键精修”生成当前原图的产品底图</div>}
              <footer><div><strong>{previewVersion ? `版本 ${previewVersion.versionNumber}` : "等待生成"}</strong><span>{previewVersion ? `${previewVersion.width} × ${previewVersion.height} · PNG${previewVersion.id === currentHistory?.currentVersionId ? " · 当前版本" : " · 历史预览"}` : "成功结果将保存到 MinIO 并追加版本"}</span></div></footer>
            </article>
            {current && <section className="start-base-history" aria-label="底图历史版本">
              <header><div><strong>底图历史</strong><span>{currentHistory?.versions.length ?? 0} 个成功版本</span></div>{previewVersion && previewVersion.id !== currentHistory?.currentVersionId && <button type="button" onClick={selectBaseVersion}>设为当前版本</button>}</header>
              {currentHistory?.versions.length ? <div className="start-version-strip">{currentHistory.versions.map((version) => <button className={version.id === previewVersion?.id ? "active" : ""} type="button" key={version.id} onClick={() => setPreviewVersionIds((value) => ({ ...value, [current.id]: version.id }))}><ImageWithState src={version.previewUrl} alt={`版本 ${version.versionNumber}`} loading="lazy" retryable={false} /><span>版本 {version.versionNumber}{version.id === currentHistory.currentVersionId ? <em>当前</em> : null}</span></button>)}</div> : <p className="start-empty-history">尚无成功版本</p>}
              {latestFailedAttempt && <div className="start-generation-failure" role="status"><strong>失败记录 · 尝试版本 {latestFailedAttempt.versionNumber}</strong><span>{latestFailedAttempt.errorMessage ?? "白底精修失败，可重新点击精修"}</span></div>}
            </section>}
           </div>
        </section>
        <section className="start-brief" aria-labelledby="brief-title">
          <header className="start-section-head"><div><h2 id="brief-title">产品与设计简报</h2><p>先补充本次要求，再让 QWEN 规划图片结构。</p></div><span className={`start-step-badge ${structureSnapshot?.confirmationStatus === "confirmed" ? "confirmed" : ""}`}>{structureStatus}</span></header>
          <section className="start-brief-block" aria-label="最小人工简报">
            <div className="start-brief-grid">
              <label className="start-field"><span>目标平台 *</span><select disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={briefInput.platform} onChange={(event) => setBriefInput((value) => ({ ...value, platform: event.target.value }))}><option value="">请选择目标平台</option><optgroup label="海外平台">{platforms.filter((item) => item.marketScope === "overseas").map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</optgroup><optgroup label="国内平台">{platforms.filter((item) => item.marketScope === "domestic").map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</optgroup></select></label>
              <label className="start-field"><span>输出语言 *</span><select disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={briefInput.output_language} onChange={(event) => setBriefInput((value) => ({ ...value, output_language: event.target.value }))}><option value="英文">英文</option><option value="中文">中文</option></select></label>
              <label className="start-field full"><span>产品名称</span><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={briefInput.product_name} onChange={(event) => setBriefInput((value) => ({ ...value, product_name: event.target.value }))} placeholder="可从资料带入，也可以手动修改" /></label>
              <label className="start-field full"><span>本次必须强调的内容（选填）</span><textarea disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={briefInput.emphasis_requirements} onChange={(event) => setBriefInput((value) => ({ ...value, emphasis_requirements: event.target.value }))} placeholder={"产品参数：\n- 尺寸：125 × 65 × 40 mm\n- 重量：约 95 g\n- 材质：ABS + 半透明外壳\n- 连接方式：2.4G 无线、蓝牙\n- 按键数量：6 个\n\n必须强调：\n- 橙色半透明外壳\n- 左右对称人体工学结构\n- 轻量化设计\n- 必须展示侧键和滚轮\n\n不得虚构：\n- DPI 数值\n- 续航时间\n- 防水等级\n- 未确认的性能参数"} /><small>填写已确认的产品参数、事实和必须展示的卖点，模型不得自行补充或修改这些事实。</small></label>
              <label className="start-field full"><span>设计方向与禁止内容（选填）</span><textarea disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={briefInput.design_constraints} onChange={(event) => setBriefInput((value) => ({ ...value, design_constraints: event.target.value }))} placeholder={"设计方向：\n- 整体风格：科技、轻量、年轻化\n- 色彩：橙色半透明外壳，搭配黑色细节\n- 光线：柔和顶光和侧逆光，表现透明材质和轮廓\n- 背景：纯白或浅灰，保持干净\n- 构图：主体居中，完整展示产品轮廓\n- 场景图：可使用电竞桌面或年轻化办公环境\n\n禁止内容：\n- 不改变产品外壳颜色\n- 不增加额外按键、线材或配件\n- 不生成错误品牌 Logo\n- 不添加夸张促销文字或标签\n- 不使用未经确认的 RGB 灯光效果"} /><small>填写视觉风格和构图要求，以及明确禁止出现的内容；产品参数请填写在上一个输入框。</small></label>
            </div>
            {selectedPlatform && <div className="start-platform-note"><strong>{selectedPlatform.name} 平台规则</strong><span>{selectedPlatform.mainImageStrategy}</span><span>{selectedPlatform.galleryStrategy}</span></div>}
          </section>
          {structureTemplates.length > 0 && <section className="start-structure-panel" aria-labelledby="structure-plan-title">
            <header><div><h3 id="structure-plan-title">套图结构要求</h3><p>主图数量由你确定；详情图由 QWEN 在范围内分配。</p></div><span>{selectedChunkIds.length} 条资料 · {images.length} 张图片</span></header>
            <div className="start-structure-controls"><label className="start-field"><span>主图总数</span><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} type="number" min="1" value={structureInput.main_image_count} onChange={(event) => setStructureInput((value) => ({ ...value, main_image_count: Number(event.target.value) }))} /></label><label className="start-field"><span>详情图最少数量</span><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} type="number" min="0" value={structureInput.detail_image_count_min} onChange={(event) => setStructureInput((value) => ({ ...value, detail_image_count_min: Number(event.target.value) }))} /></label><label className="start-field"><span>详情图最多数量</span><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} type="number" min="0" value={structureInput.detail_image_count_max} onChange={(event) => setStructureInput((value) => ({ ...value, detail_image_count_max: Number(event.target.value) }))} /></label></div>
            <div className="start-category-grid">{DETAIL_CATEGORIES.map(([code, label]) => <label className={`start-category-option ${structureInput.selected_detail_categories.includes(code) ? "selected" : ""}`} key={code}><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} type="checkbox" checked={structureInput.selected_detail_categories.includes(code)} onChange={() => toggleCategory(code)} /><span>{label}</span>{structureInput.selected_detail_categories.includes(code) && <select disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={structureInput.category_requirements[code] ?? "optional"} onChange={(event) => setStructureInput((value) => ({ ...value, category_requirements: { ...value.category_requirements, [code]: event.target.value as "required" | "optional" } }))}><option value="required">必生</option><option value="optional">可选</option></select>}</label>)}</div>
            {structureStale && <p className="start-inline-warning">输入已经变化，请重新生成结构建议后再确认。</p>}
            <div className="start-structure-actions"><button type="button" onClick={generateStructurePlan} disabled={!suite || structureGenerating || !images.length || structureSnapshot?.confirmationStatus === "confirmed"}>{structureGenerating ? "QWEN 正在规划…" : structureSnapshot ? "重新生成结构建议" : "生成结构建议"}<Icon name="sparkles" /></button><span>{structureGenerating ? "正在分析图片、资料和类别要求" : "返回后将在下方进入独立审核阶段"}</span></div>
          </section>}
          {planSnapshot && !structureSnapshot && <aside className="start-legacy-plan"><div><strong>旧版历史计划</strong><span>版本 {planSnapshot.revisionNumber} · 仅用于读取既有卡片和图片历史</span></div><button type="button" onClick={startCreation}>进入历史创作板<Icon name="arrow-right" /></button></aside>}
        </section>
        <button className="start-rag-launcher" type="button" onClick={() => setRagOpen(true)}><Icon name="library" /><span>商品资料</span><b>{selectedChunkIds.length}</b></button>
      </section>
      <section ref={structureReviewRef} tabIndex={-1} className="start-structure-review-stage" aria-labelledby="structure-review-title">
        <header className="start-review-stage-head"><div><h2 id="structure-review-title">审核图片结构计划</h2><p>确认每类数量、参考图和统一风格，再生成单卡提示词。</p></div><div>{structureGenerating && <div className="start-simulated-progress" role="status" aria-label={`结构计划生成进度 ${structureProgress}%`}><span><i style={{ transform: `scaleX(${structureProgress / 100})` }} /></span><b>{structureProgress}%</b></div>}<span className={`start-step-badge ${structureSnapshot?.confirmationStatus === "confirmed" ? "confirmed" : structureError ? "failed" : ""}`}>{structureStatus}</span>{structureSnapshot && <small>版本 {structureSnapshot.revisionNumber} · {structureSnapshot.provider.model}</small>}</div></header>
        {structureError ? <div className="start-review-error" role="status"><div><strong>结构建议生成失败</strong><span>{structureError}</span></div><button type="button" onClick={generateStructurePlan}>重新生成</button></div> : structure && mainAllocation && <>
          {structureStale && <div className="start-review-notice"><strong>输入已变更</strong><span>当前建议不再对应最新输入，请重新生成后再确认。</span></div>}
          <div className="start-review-summary"><div><span>主图</span><strong>{mainAllocation.count}</strong></div><div><span>详情图</span><strong>{structure.detailImageCount}</strong></div><div><span>已采用类别</span><strong>{structure.categoryAllocations.filter((row) => row.count > 0).length}</strong></div><div><span>事实来源</span><strong>{selectedChunkIds.length + (briefInput.human_supplement.trim() ? 1 : 0)}</strong></div></div>
          <div className="start-review-toolbar"><div><strong>图片分配</strong><span>主图数量固定，详情图数量可在确认前调整。</span></div>{structureSnapshot?.confirmationStatus !== "confirmed" && <label><span>增加类别</span><select aria-label="新增详情图类别" defaultValue="" onChange={(event) => { if (event.target.value) { addReviewCategory(event.target.value); event.target.value = ""; } }}><option value="">选择类别</option>{DETAIL_CATEGORIES.filter(([code]) => !structure.categoryAllocations.some((row) => row.category === code)).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}</div>
          <div className="start-allocation-list">
            <article className="start-allocation-row main"><div className="start-allocation-copy"><strong>主图组</strong><small>{mainAllocation.reason}</small>{mainAllocation.missingFacts.length > 0 && <em>缺少事实：{mainAllocation.missingFacts.join("、")}</em>}</div><b>{mainAllocation.count} 张</b><div className="start-reference-picker"><span>参考图</span>{images.map((image) => <label key={image.id}><input disabled={structureSnapshot?.confirmationStatus === "confirmed" || !structure.mainAllocation} type="checkbox" checked={mainAllocation.sourceImageIds.includes(image.id)} onChange={(event) => updateMainAllocation((currentValue) => ({ ...currentValue, sourceImageIds: event.target.checked ? [...new Set([...currentValue.sourceImageIds, image.id])] : currentValue.sourceImageIds.filter((id) => id !== image.id) }))} /><span>{image.ordinal}</span></label>)}</div></article>
            {structure.categoryAllocations.map((row) => <article className="start-allocation-row" key={row.category}><div className="start-allocation-copy"><strong>{DETAIL_CATEGORY_NAMES[row.category] ?? row.category}</strong><small>{row.reason}</small>{row.missingFacts.length > 0 && <em>缺少事实：{row.missingFacts.join("、")}</em>}</div>{structureSnapshot?.confirmationStatus === "confirmed" ? <b>{row.count} 张</b> : <input aria-label={`${row.category} 数量`} type="number" min="0" value={row.count} onChange={(event) => updateAllocation(row.category, (currentValue) => ({ ...currentValue, count: Number(event.target.value) }))} />}{structureSnapshot?.confirmationStatus !== "confirmed" && <select aria-label={`${row.category} 生图要求`} value={row.requirement} onChange={(event) => updateAllocation(row.category, (currentValue) => ({ ...currentValue, requirement: event.target.value as "required" | "optional" }))}><option value="required">必生</option><option value="optional">可选</option></select>}<div className="start-reference-picker"><span>参考图</span>{images.map((image) => <label key={image.id}><input disabled={structureSnapshot?.confirmationStatus === "confirmed"} type="checkbox" checked={row.sourceImageIds.includes(image.id)} onChange={(event) => updateAllocation(row.category, (currentValue) => ({ ...currentValue, sourceImageIds: event.target.checked ? [...new Set([...currentValue.sourceImageIds, image.id])] : currentValue.sourceImageIds.filter((id) => id !== image.id) }))} /><span>{image.ordinal}</span></label>)}</div>{structureSnapshot?.confirmationStatus !== "confirmed" && <button className="start-row-remove" type="button" aria-label={`删除${DETAIL_CATEGORY_NAMES[row.category] ?? row.category}`} onClick={() => removeReviewCategory(row.category)}>删除</button>}</article>)}
          </div>
          <div className="start-review-editor"><div className="start-structure-total"><span>详情图最终总数</span>{structureSnapshot?.confirmationStatus !== "confirmed" ? <input aria-label="详情图最终总数" type="number" min="0" value={structure.detailImageCount} onChange={(event) => updateStructure((currentValue) => ({ ...currentValue, detailImageCount: Number(event.target.value) }))} /> : <strong>{structure.detailImageCount}</strong>}<small className={detailCountsMatch ? "valid" : ""}>类别合计 {detailAllocatedCount} 张</small></div><label className="start-field full"><span>全局风格要求</span><textarea disabled={structureSnapshot?.confirmationStatus === "confirmed"} value={stylePrompt(structure.globalStyleCard)} onChange={(event) => updateStructure((currentValue) => ({ ...currentValue, globalStyleCard: { promptPrefix: event.target.value } }))} placeholder="整套图片共用的背景、光线、色彩、构图和质感要求" /><small>确认后会加入每张卡的真实生图提示词。</small></label></div>
          {structureSnapshot?.confirmationStatus !== "confirmed" ? <div className="start-review-actions"><div><strong>{hasMissingFacts ? "仍有类别缺少可靠事实" : detailCountsMatch ? "数量关系有效，可以确认" : "详情图总数与类别合计不一致"}</strong><span>{hasMissingFacts ? "在上方补充商品事实或调整类别后重新规划。" : "确认后立即开始按类别生成提示词。"}</span></div><button className="start-primary" type="button" disabled={confirmingStructure || hasMissingFacts || structureStale || !detailCountsMatch} onClick={confirmAndGenerateCategoryPrompts}>{confirmingStructure ? "正在确认…" : "确认结构计划并生成提示词"}<Icon name="check" /></button></div> : <div className="start-category-progress"><div className="start-review-toolbar"><div><strong>类别提示词</strong><span>成功结果保留，失败类别可单独重试。</span></div><div className="start-progress-summary">{!categoryPromptsComplete && categoryPromptState?.status === "running" && <div className="start-simulated-progress" role="status" aria-label={`类别提示词生成进度 ${categoryOverallProgress}%`}><span><i style={{ transform: `scaleX(${categoryOverallProgress / 100})` }} /></span><b>{categoryOverallProgress}%</b></div>}<span className="start-progress-state">{categoryPromptsComplete ? "全部完成" : categoryPromptState?.status === "partial" ? "部分失败" : categoryPromptState?.status === "running" ? `生成中 ${categoryOverallProgress}%` : "待生成"}</span></div></div><div className="start-progress-list">{(categoryPromptState?.requests ?? []).map((request) => { const progress = request.status === "succeeded" ? 100 : categoryProgressById[request.id] ?? 0; return <div className={`start-progress-row is-${request.status}`} key={request.id}><div><strong>{DETAIL_CATEGORY_NAMES[request.categoryCode] ?? request.categoryCode}</strong><small>{request.requestedCount} 张 · {request.provider.model}</small></div><div className="start-row-progress" role="status" aria-label={`${DETAIL_CATEGORY_NAMES[request.categoryCode] ?? request.categoryCode}生成进度 ${progress}%`}><span><i style={{ transform: `scaleX(${progress / 100})` }} /></span><b>{request.status === "failed" ? "失败" : `${progress}%`}</b></div><em>{request.status === "succeeded" ? `${request.items.length}/${request.requestedCount}` : request.status === "running" ? "处理中" : "可重试"}</em>{request.status === "failed" && <button type="button" onClick={() => retryCategoryPrompt(request.categoryCode)}>重试</button>}</div>; })}</div>{categoryPromptState?.status === "pending" || categoryPromptState?.status === "not_ready" ? <button className="start-primary" type="button" onClick={() => generateCategoryPrompts()}>继续生成提示词<Icon name="sparkles" /></button> : categoryPromptsComplete ? <button className="start-primary" type="button" onClick={startCreation}>进入创作板<Icon name="arrow-right" /></button> : null}</div>}
        </>}
        {!structureError && (!structure || !mainAllocation) && <div className={`start-review-empty ${structureGenerating ? "loading" : ""}`} role="status" aria-live="polite">
          <div className="start-review-empty-copy"><span className="start-review-empty-icon"><Icon name={structureGenerating ? "sparkles" : "tasks"} /></span><div><strong>{structureGenerating ? "QWEN 正在生成结构建议" : "等待结构建议"}</strong><p>{structureGenerating ? "返回后会在这里展开主图、详情图类别分配、参考图和全局风格，供你逐项确认。" : "完成上方简报并点击“生成结构建议”，审核内容会直接显示在这里。"}</p></div></div>
          <div className="start-review-readiness" aria-label="结构计划准备状态">
            <span className={suite ? "ready" : ""}><Icon name={suite ? "check" : "alert"} />{suite ? "方案已创建" : "等待创建方案"}</span>
            <span className={images.length ? "ready" : ""}><Icon name={images.length ? "check" : "alert"} />{images.length ? `${images.length} 张商品图` : "等待商品图"}</span>
            <span className={briefInput.platform ? "ready" : ""}><Icon name={briefInput.platform ? "check" : "alert"} />{briefInput.platform ? "平台已选择" : "等待目标平台"}</span>
            <span className={structureInput.selected_detail_categories.length ? "ready" : ""}><Icon name={structureInput.selected_detail_categories.length ? "check" : "alert"} />{structureInput.selected_detail_categories.length ? `${structureInput.selected_detail_categories.length} 个详情类别` : "等待详情类别"}</span>
          </div>
        </div>}
      </section>
      <section className="start-recents" aria-labelledby="recent-title"><header><div><p className="start-eyebrow">RECENT PROJECTS</p><h2 id="recent-title">最近项目</h2><p>每页最多展示两行 6 个项目，按最近更新时间排序。</p></div></header><div className="start-project-grid">{suite ? <article><div className="start-recent-placeholder"><span className="start-project-state active">当前方案</span><h3>{title}</h3><p>{images.length} 张原图 · 已从 API 恢复</p><button type="button" onClick={startCreation}>进入工作台<Icon name="arrow-right" /></button></div></article> : pagedRecentSuites.map((item) => <article key={item.id}><div className="start-recent-placeholder"><span className={`start-project-state ${item.status === "in_progress" ? "active" : ""}`}>{item.status === "in_progress" ? "处理中" : "草稿"}</span><h3>{item.name}</h3><p>{new Date(item.updatedAt).toLocaleString("zh-CN")} · {item.status === "in_progress" ? "可继续创作" : "尚未完成"}</p><button type="button" onClick={() => navigate(`/suites/${item.id}/board`)}>进入工作台<Icon name="arrow-right" /></button></div></article>)}</div>{!suite && recentPageCount > 1 && <nav className="start-pagination" aria-label="最近项目分页"><button className="start-page-arrow previous" type="button" aria-label="上一页" disabled={recentPage === 1} onClick={() => setRecentPage((page) => Math.max(1, page - 1))}><Icon name="chevron-right" /></button>{Array.from({ length: recentPageCount }, (_, index) => { const page = index + 1; return <button className={page === recentPage ? "active" : ""} type="button" aria-label={`第 ${page} 页`} aria-current={page === recentPage ? "page" : undefined} key={page} onClick={() => setRecentPage(page)}>{page}</button>; })}<button className="start-page-arrow" type="button" aria-label="下一页" disabled={recentPage === recentPageCount} onClick={() => setRecentPage((page) => Math.min(recentPageCount, page + 1))}><Icon name="chevron-right" /></button></nav>}</section>
    </main>{ragOpen && <div className="start-rag-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRagOpen(false); }}><section className="start-rag-modal" role="dialog" aria-modal="true" aria-labelledby="rag-modal-title"><header><div><p className="start-eyebrow">PRODUCT EVIDENCE</p><h2 id="rag-modal-title">商品资料</h2></div><button type="button" aria-label="关闭商品资料" onClick={() => setRagOpen(false)}>×</button></header><RagReferences chunks={chunks} query={query} selectedChunkIds={selectedChunkIds} setQuery={setQuery} setSelectedChunkIds={setSelectedChunkIds} supplement={briefInput.human_supplement} setSupplement={(human_supplement) => setBriefInput((value) => ({ ...value, human_supplement }))} disabled={structureSnapshot?.confirmationStatus === "confirmed"} /></section></div>}{toast && <div className="start-toast show" role="status" aria-live="polite">{toast}</div>}{modal && <div className="start-modal-backdrop" role="presentation"><section className={`start-modal ${modal.kind}`} role="dialog" aria-modal="true" aria-labelledby="start-modal-title"><button className="start-modal-close" type="button" aria-label="关闭提示" onClick={() => setModal(null)}>×</button><p className="start-modal-kicker">PICAGENT</p><h2 id="start-modal-title">{modal.title}</h2><p className="start-modal-message">{modal.message}</p>{modal.kind === "running" && <><div className="start-modal-progress"><span style={{ width: `${Math.max(simulatedProgress, modal.total ? Math.round(((modal.completed ?? 0) / modal.total) * 100) : 0)}%` }}></span></div><small className="start-modal-progress-value">{Math.max(simulatedProgress, modal.total ? Math.round(((modal.completed ?? 0) / modal.total) * 100) : 0)}%</small></>}{modal.kind !== "running" && <button className="start-modal-confirm" type="button" onClick={() => setModal(null)}>知道了</button>}</section></div>}
  </div>;
}
