import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges, Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps, type Viewport, useNodesState, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { suiteApi, type ApiCanvasLayout, type ApiLibraryResource, type ApiPromptTemplateCopy, type ApiProductMaterialRef, type ApiSuiteTask, type ApiTaskVersion, type ApiWorkbench } from "../api/client";
import { Icon, ImageWithState } from "./shared";
import { Circle as KonvaCircle, Layer, Line, Rect as KonvaRect, Stage, Text as KonvaText, Transformer } from "react-konva";
import type Konva from "konva";

type BoardMode = "compose" | "gallery";
type CardKind = "style" | "base" | "reverse-ref" | "task" | "output";
type BoardData = {
  kind: CardKind;
  title: string;
  subtitle?: string;
  text?: string;
  task?: ApiSuiteTask;
  version?: ApiTaskVersion;
  imageUrl?: string;
  styleGuide?: string;
  referenceCount?: number;
  displayPrompt?: string;
  lineage?: string;
  onPreview?: (preview: Preview) => void;
  onSelect?: (task: ApiSuiteTask) => void;
  onGenerate?: (task: ApiSuiteTask) => void;
  onCopy?: (task: ApiSuiteTask) => void;
  onRegenerate?: (task: ApiSuiteTask) => void;
  onEdit?: (task: ApiSuiteTask, version?: ApiTaskVersion) => void;
  onSelectVersion?: (task: ApiSuiteTask, versionId: string, selection: "current" | "final") => void;
};
type BoardNode = Node<BoardData>;
type Preview = { url: string; title: string; subtitle?: string };
type EditTool = "re_edit" | "regenerate" | "add_text" | "change_text" | "inpaint" | "erase" | "expand";
type MaskStroke = { mode: "draw" | "erase"; points: Array<{ x: number; y: number }>; size: number };
type DraftOperation = { operationId: string; type: "re_edit" | "add_text" | "change_text" | "redraw" | "erase" | "outpaint"; summary: string; sourceVersionId: string; payload: Record<string, unknown> };
type ImageEditCapabilities = Record<string, boolean>;
type ImageFrame = { left: number; top: number; width: number; height: number };

const statusText = (value?: string) => ({ pending: "草稿", generating: "生成中", generated: "已生成", succeeded: "已生成", failed: "失败", archived: "已归档", incomplete: "待补全" } as Record<string, string>)[value ?? ""] ?? value ?? "草稿";
const readParam = (task: ApiSuiteTask, key: string, fallback: string) => {
  const value = task.generationParams?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
};
const ratioFor = (task: ApiSuiteTask) => readParam(task, "ratio", task.imageType === "detail" ? "3:4" : "1:1");
const sizeFor = (task: ApiSuiteTask) => readParam(task, "size", "1K");
const qualityFor = (task: ApiSuiteTask) => readParam(task, "quality", "medium");
const versionGenerationPrompt = (version: ApiTaskVersion, fallback = "") => {
  const snapshot = version.promptSnapshot ?? {};
  const value = snapshot.finalPrompt ?? snapshot.prompt;
  return typeof value === "string" && value.trim() ? value : fallback;
};
const modelFor = (task: ApiSuiteTask) => readParam(task, "model", "gpt-image-2");
const firstStyleValue = (workbench: ApiWorkbench) => {
  const values = { ...(workbench.planSnapshot?.dynamicInput ?? {}), ...(workbench.planSnapshot?.humanInput ?? {}) } as Record<string, unknown>;
  for (const key of ["design_style", "style_guide", "styleGuide", "visual_style"]) {
    if (typeof values[key] === "string" && values[key].trim()) return values[key].trim();
  }
  return "沿用计划模板默认风格，保持商品真实外观、光影和品牌一致性。";
};
const styledPrompt = (task: ApiSuiteTask, styleGuide: string) => `${styleGuide.replace(/[。.!！?？]+$/, "")}。 ${task.promptDraft}`.trim();

function BoardCard({ data }: NodeProps<BoardNode>) {
  const onPreview = data.onPreview ?? (() => undefined);
  const onSelect = data.onSelect ?? (() => undefined);
  const onGenerate = data.onGenerate ?? (() => undefined);
  const onCopy = data.onCopy ?? (() => undefined);
  const onRegenerate = data.onRegenerate ?? (() => undefined);
  const onEdit = data.onEdit ?? (() => undefined);
  const onSelectVersion = data.onSelectVersion ?? (() => undefined);
  const [simulatedProgress, setSimulatedProgress] = useState(0);
  const availableVersions = data.task?.versions ?? [];
  const versionIds = availableVersions.map((version) => version.id).join("|");
  const [selectedVersionId, setSelectedVersionId] = useState(data.version?.id ?? "");
  useEffect(() => {
    if (data.task?.status !== "generating") { setSimulatedProgress(0); return; }
    setSimulatedProgress((value) => value || 4);
    const timer = window.setInterval(() => setSimulatedProgress((value) => Math.min(96, value + Math.max(1, Math.ceil((96 - value) / 10)))), 450);
    return () => window.clearInterval(timer);
  }, [data.task?.status]);
  useEffect(() => {
    if (!availableVersions.some((version) => version.id === selectedVersionId)) setSelectedVersionId(data.version?.id ?? availableVersions[0]?.id ?? "");
  }, [data.version?.id, selectedVersionId, versionIds]);
  if (data.kind === "style") return <article className="wb-card wb-style-card"><Handle type="source" position={Position.Right} /><div className="wb-card-topline"><span className="wb-card-kicker">STYLE GUIDE</span><span className="wb-card-state is-active">已启用</span></div><h3>全局风格卡</h3><p>{data.styleGuide}</p><div className="wb-card-note"><Icon name="check" /> 已同步到每张任务卡第一句</div><button type="button" className="wb-link-button">编辑</button></article>;
  if (data.kind === "base" || data.kind === "reverse-ref") return <article className="wb-card wb-base-card"><Handle type="source" position={Position.Right} /><span className="wb-card-kicker">{data.kind === "reverse-ref" ? "REFERENCE IMAGE" : "BASE IMAGE"}</span><button className="wb-image-button" type="button" onClick={() => data.imageUrl && onPreview({ url: data.imageUrl, title: data.title, subtitle: data.subtitle })}><ImageWithState src={data.imageUrl} alt={data.title} loading="lazy" retryable={false} /></button><h3>{data.title}</h3><p>{data.subtitle}</p></article>;
  const task = data.task;
  if (!task) return null;
  const isOutput = data.kind === "output";
  const version = availableVersions.find((item) => item.id === selectedVersionId) ?? data.version;
  return <article className={`wb-card ${isOutput ? "wb-output-card" : "wb-task-card"}`} onClick={() => onSelect(task)}>
    {!isOutput && <Handle type="target" position={Position.Left} />}
    {isOutput && <span className="wb-output-badge">生成结果</span>}
    <div className="wb-card-topline"><span className="wb-card-kicker">{task.imageType === "main" ? "MAIN IMAGE" : "DETAIL IMAGE"}</span><span className={`wb-card-state state-${task.status}`}>{statusText(task.status)}</span></div>
    {task.status === "generating" && <div className="wb-simulated-progress" role="status" aria-label={`模型生成进度 ${simulatedProgress}%`}><span><i style={{ transform: `scaleX(${simulatedProgress / 100})` }} /></span><b>{simulatedProgress}%</b></div>}
    {isOutput && version?.previewUrl && <button className="wb-output-image" type="button" onClick={(event) => { event.stopPropagation(); onPreview({ url: version.previewUrl, title: task.title, subtitle: `${task.imageType === "main" ? "主图" : "详情页"} · ${ratioFor(task)} · ${sizeFor(task)}` }); }}><ImageWithState src={version.previewUrl} alt={task.title} loading="lazy" retryable={false} /></button>}
    {!isOutput && version?.previewUrl && <button className="wb-output-image" type="button" onClick={(event) => { event.stopPropagation(); onPreview({ url: version.previewUrl, title: task.title, subtitle: `${task.imageType === "main" ? "主图" : "详情页"} · 版本 ${version.versionNumber}` }); }}><ImageWithState src={version.previewUrl} alt={task.title} loading="lazy" retryable={false} /></button>}
    <h3>{task.title}</h3>
    {isOutput && version && <p className="wb-output-source">来自任务卡 · 版本 {version.versionNumber}</p>}
    {data.lineage && <p className="wb-card-lineage">{data.lineage}</p>}
    {!isOutput && <div className="wb-task-stats"><span><b>图片</b><strong>{version ? 1 : 0} 张</strong></span><span><b>参考图</b><strong>{data.referenceCount ?? 0} 张</strong></span><span><b>提示词</b><strong>{task.promptDraft.length} 字</strong></span><span><b>状态</b><strong>{statusText(task.status)}</strong></span></div>}
    <p className="wb-task-prompt">{data.displayPrompt ?? task.promptDraft}</p>
    <div className="wb-card-footer"><span>{modelFor(task)}</span><span>{ratioFor(task)}</span><span>{sizeFor(task)}</span><span>{qualityFor(task)}</span></div>
    {!isOutput && <div className="wb-task-actions"><button type="button" className="wb-card-generate" disabled={task.status === "generating"} onClick={(event) => { event.stopPropagation(); onGenerate(task); }}><Icon name="sparkles" />生成</button><button type="button" disabled={task.status === "generating" || !version} onClick={(event) => { event.stopPropagation(); onRegenerate(task); }}><Icon name="history" />再次生成</button><button type="button" className="wb-card-edit" disabled={!version} onClick={(event) => { event.stopPropagation(); onEdit(task, version); }}><Icon name="edit" />编辑图片</button></div>}
    {isOutput && <div className="wb-output-actions"><button type="button" title="放大预览" onClick={(event) => { event.stopPropagation(); if (version?.previewUrl) onPreview({ url: version.previewUrl, title: task.title }); }}><Icon name="eye" /></button><button type="button" title="编辑图片" disabled={!version} onClick={(event) => { event.stopPropagation(); onEdit(task, version); }}><Icon name="edit" /></button><button type="button" title="复制提示词" onClick={(event) => { event.stopPropagation(); onCopy(task); }}><Icon name="copy" /></button><button type="button" className="wb-action-text" disabled={task.status === "generating"} onClick={(event) => { event.stopPropagation(); version ? onRegenerate(task) : onGenerate(task); }}>{version ? <><Icon name="history" />再次生成</> : <><Icon name="sparkles" />生成</>}</button></div>}
    {version && <div className="wb-card-version-actions"><select aria-label={`选择${task.title}版本`} value={version.id} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedVersionId(event.target.value)}>{availableVersions.slice().sort((left, right) => right.versionNumber - left.versionNumber).map((item) => <option value={item.id} key={item.id}>v{item.versionNumber}{item.isCurrent ? " · 当前" : ""}{item.isFinal ? " · 终版" : ""}</option>)}</select>{version.isCurrent ? <span className="wb-version-status"><Icon name="check" />当前版本</span> : <button type="button" onClick={(event) => { event.stopPropagation(); onSelectVersion(task, version.id, "current"); }}>设为当前</button>}{version.isFinal ? <span className="wb-version-status is-final"><Icon name="check" />已是终版</span> : <button type="button" className="wb-version-final" onClick={(event) => { event.stopPropagation(); onSelectVersion(task, version.id, "final"); }}>设为终版</button>}</div>}
    {!isOutput && <Handle type="source" position={Position.Right} />}
  </article>;
}

const nodeTypes = { boardCard: BoardCard };

function imageEditChildTask(workbench: ApiWorkbench, child: NonNullable<ApiWorkbench["imageEditChildren"]>[number], index: number): ApiSuiteTask {
  const raw = child.task;
  return { id: String(raw.id), suiteId: workbench.suite.id, planSnapshotId: null, planItemId: null, ordinal: 10000 + index, imageType: "detail", title: `编辑子卡片 · ${String(raw.summary ?? "图片编辑")}`, purpose: "图片编辑结果", promptDraft: String(raw.summary ?? ""), promptRevision: 0, sourceInputImageId: null, generationParams: {}, status: (String(raw.status ?? "generating") as ApiSuiteTask["status"]), archivedAt: null, createdAt: String(raw.createdAt ?? ""), updatedAt: String(raw.updatedAt ?? ""), versions: child.versions.map((item) => {
    const attempt = child.attempts.find((entry) => String(entry.id) === String(item.attemptId)) as Record<string, unknown> | undefined;
    const command = attempt?.command as Record<string, unknown> | undefined;
    return { id: item.id, taskId: String(raw.id), slotId: "", attemptId: String(item.attemptId ?? ""), versionNumber: item.versionNumber, objectKey: "", processObjectKeys: [], sha256: "", width: Number(item.width ?? 1), height: Number(item.height ?? 1), mimeType: item.mimeType ?? "image/png", promptSnapshot: typeof command?.prompt === "string" ? { finalPrompt: command.prompt } : {}, contextSnapshot: {}, isCurrent: item.id === raw.currentVersionId, isFinal: item.id === raw.finalVersionId, createdAt: "", previewUrl: item.previewUrl ?? `/api/image-editor/tasks/${String(raw.id)}/versions/${item.id}/preview` };
  }), attempts: child.attempts.map((attempt) => ({ id: String(attempt.id), slotId: "", attemptNo: Number(attempt.attemptNo ?? 1), provider: "image-editor", model: "gpt-image-2", endpoint: "/v1/images/edits", requestSummary: {}, promptSnapshot: {}, promptSha256: "", contextSnapshot: {}, sourceKind: "original", sourceObjectKey: "", sourceInputImageId: null, sourceBaseVersionId: null, status: String(attempt.status ?? "failed") === "succeeded" ? "succeeded" : String(attempt.status ?? "failed") === "generating" ? "running" : "failed", errorCode: typeof attempt.errorCode === "string" ? attempt.errorCode : null, errorMessage: typeof attempt.errorMessage === "string" ? attempt.errorMessage : null, externalRequestId: null, startedAt: String(attempt.createdAt ?? ""), finishedAt: typeof attempt.completedAt === "string" ? attempt.completedAt : null } as ApiSuiteTask["attempts"][number])), slots: [] };
}

function project(workbench: ApiWorkbench, layout: ApiCanvasLayout | null, mode: BoardMode, styleGuide: string, handlers: Pick<BoardData, "onPreview" | "onSelect" | "onGenerate" | "onCopy" | "onRegenerate" | "onEdit" | "onSelectVersion"> = {}) {
  const saved = new Map((layout?.nodes ?? []).map((node) => [node.nodeId, node]));
  const active = workbench.tasks.filter((task) => task.status !== "archived" && (task.originKind === "reverse_import" || !workbench.planSnapshot || task.planSnapshotId === workbench.planSnapshot.id));
  const currentBases = workbench.inputImages.filter((image) => image.currentBaseVersionId);
  const reverseMaterials = new Map<string, { resourceId: string; resourceVersionId: string; title: string; previewUrl: string }>();
  active.forEach((task) => {
    const refs = Array.isArray(task.generationParams?.productMaterialRefs) ? task.generationParams.productMaterialRefs as ApiProductMaterialRef[] : [];
    refs.forEach((ref) => reverseMaterials.set(ref.resourceVersionId, { resourceId: ref.resourceId, resourceVersionId: ref.resourceVersionId, title: ref.title ?? "产品白底图", previewUrl: ref.previewUrl ?? `/api/library/resources/${encodeURIComponent(ref.resourceId)}/preview` }));
  });
  const nodes: BoardNode[] = [];
  const edges: Edge[] = [];
  const baseIds = currentBases.map((image) => `base:${image.currentBaseVersionId}`);
  const styleId = "style:global";
  const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
  const dimensions = (kind: CardKind) => kind === "style" ? { width: 250, height: 190 } : kind === "base" ? { width: 210, height: 220 } : { width: 290, height: 350 };
  const collides = (position: { x: number; y: number }, size: { width: number; height: number }) => occupied.some((item) => position.x < item.x + item.width + 18 && position.x + size.width + 18 > item.x && position.y < item.y + item.height + 18 && position.y + size.height + 18 > item.y);
  const place = (kind: CardKind, preferred: { x: number; y: number }) => {
    const size = dimensions(kind); let position = { ...preferred };
    for (let attempt = 0; attempt < 100 && collides(position, size); attempt += 1) {
      position = { x: attempt % 3 === 2 ? 36 : position.x + size.width + 28, y: attempt % 3 === 2 ? position.y + size.height + 28 : position.y };
    }
    occupied.push({ ...position, ...size });
    return position;
  };
  const stylePosition = place("style", { x: 36, y: 30 });
  nodes.push({ id: styleId, type: "boardCard", position: stylePosition, data: { kind: "style", title: "全局风格卡", styleGuide, ...handlers }, draggable: mode === "compose" });

  if (mode === "compose") {
    currentBases.forEach((image, index) => {
      const id = `base:${image.currentBaseVersionId}`;
      const savedNode = saved.get(id);
      nodes.push({ id, type: "boardCard", position: place("base", savedNode ? { x: savedNode.x, y: savedNode.y } : { x: 36, y: 250 + index * 250 }), data: { kind: "base", title: `白底图 ${image.ordinal}`, subtitle: `${image.width} × ${image.height}`, imageUrl: `/api/suites/${workbench.suite.id}/input-images/${image.id}/base-versions/${image.currentBaseVersionId}/preview`, ...handlers }, draggable: true });
    });
    [...reverseMaterials.values()].forEach((material, index) => {
      const id = `library-base:${material.resourceVersionId}`;
      const savedNode = saved.get(id);
      nodes.push({ id, type: "boardCard", position: place("base", savedNode ? { x: savedNode.x, y: savedNode.y } : { x: 36, y: 250 + (currentBases.length + index) * 250 }), data: { kind: "base", title: material.title, subtitle: `资源库白底图 · ${material.resourceVersionId.slice(0, 8)}`, imageUrl: material.previewUrl, ...handlers }, draggable: true });
    });
    active.forEach((task, index) => {
      const id = `task:${task.id}`;
      const savedNode = saved.get(id);
      const currentVersion = task.versions.find((version) => version.isCurrent) ?? task.versions[0];
      nodes.push({ id, type: "boardCard", position: place("task", savedNode ? { x: savedNode.x, y: savedNode.y } : { x: 350 + (index % 2) * 330, y: 30 + Math.floor(index / 2) * 390 }), data: { kind: "task", title: task.title, task, version: currentVersion, imageUrl: currentVersion?.previewUrl, referenceCount: currentBases.length || workbench.inputImages.length, displayPrompt: styledPrompt(task, styleGuide), ...handlers }, draggable: true });
      if (task.originKind === "reverse_import" && task.reversePlanId && task.reverseReferenceId) {
        const referenceId = `reverse-ref:${task.reverseReferenceId}`; const referenceSaved = saved.get(referenceId);
        nodes.push({ id: referenceId, type: "boardCard", position: place("reverse-ref", referenceSaved ? { x: referenceSaved.x, y: referenceSaved.y } : { x: 36, y: 250 + index * 250 }), data: { kind: "reverse-ref", title: task.title, subtitle: "爆品参考图，仅用于视觉结构", imageUrl: `/api/reverse-plans/${task.reversePlanId}/references/${task.reverseReferenceId}/preview`, ...handlers }, draggable: true });
        edges.push({ id: `${referenceId}->${id}`, source: referenceId, target: id, type: "default" });
      }
      baseIds.forEach((sourceId) => edges.push({ id: `${sourceId}->${id}`, source: sourceId, target: id, type: "default", animated: task.status === "generating" }));
      const materialRefs = Array.isArray(task.generationParams?.productMaterialRefs) ? task.generationParams.productMaterialRefs as ApiProductMaterialRef[] : [];
      materialRefs.forEach((ref) => edges.push({ id: `library-base:${ref.resourceVersionId}->${id}`, source: `library-base:${ref.resourceVersionId}`, target: id, type: "default", animated: task.status === "generating" }));
      edges.push({ id: `${styleId}->${id}`, source: styleId, target: id, type: "smoothstep", style: { strokeDasharray: "5 5", stroke: "#caa434" } });
    });
    (workbench.imageEditChildren ?? []).forEach((child, index) => {
      const raw = child.task as Record<string, unknown>;
      const synthetic = imageEditChildTask(workbench, child, index);
      const id = `edit-child:${synthetic.id}`;
      const childVersion = synthetic.versions.find((version) => version.isCurrent) ?? synthetic.versions[0];
      const childAttempts = Array.isArray(child.attempts) ? child.attempts : [];
      const snapshot = child.snapshot as Record<string, unknown> | null;
      const sourceVersionId = String(raw.sourceVersionId ?? snapshot?.sourceVersionId ?? "");
      const operationCount = Array.isArray(snapshot?.operations) ? snapshot.operations.length : 0;
      const latestAttempt = childAttempts[childAttempts.length - 1] as Record<string, unknown> | undefined;
      const lineage = `来源版本 ${sourceVersionId ? sourceVersionId.slice(0, 8) : "未知"} · ${operationCount || 1} 个操作 · attempt ${String(latestAttempt?.status ?? raw.status ?? "pending")}`;
      nodes.push({ id, type: "boardCard", position: place("task", { x: 700 + (index % 2) * 330, y: 30 + Math.floor(index / 2) * 390 }), data: { kind: "task", title: synthetic.title, task: synthetic, version: childVersion, imageUrl: childVersion?.previewUrl, displayPrompt: synthetic.promptDraft, lineage, ...handlers }, draggable: true });
      const parentTaskId = String(raw.sourceCardId ?? "");
      const sourceId = nodes.some((node) => node.id === `task:${parentTaskId}`) ? `task:${parentTaskId}` : `edit-child:${parentTaskId}`;
      if (nodes.some((node) => node.id === sourceId)) edges.push({ id: `${sourceId}->${id}`, source: sourceId, target: id, type: "smoothstep" });
    });
  } else {
    active.forEach((task, index) => {
      const version = task.versions.find((item) => item.isCurrent) ?? task.versions[0];
      const id = `output:${task.id}`;
      const savedNode = saved.get(id);
      nodes.push({ id, type: "boardCard", position: place("output", savedNode ? { x: savedNode.x, y: savedNode.y } : { x: 340 + (index % 2) * 320, y: 30 + Math.floor(index / 2) * 380 }), data: { kind: "output", title: task.title, task, version, displayPrompt: styledPrompt(task, styleGuide), ...handlers }, draggable: true });
    });
  }
  return { nodes, edges };
}

function PromptLibraryButton({ onNotify }: { onNotify: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<ApiPromptTemplateCopy["stage"] | "">("");
  const [templates, setTemplates] = useState<ApiPromptTemplateCopy[]>([]);
  const [selected, setSelected] = useState<ApiPromptTemplateCopy | null>(null);
  const load = async () => { const listed = await suiteApi.listPromptTemplates(stage || undefined); const full = await Promise.all(listed.map((item) => suiteApi.copyPromptTemplate(item.templateVersionId, item.stage))); setTemplates(full); setSelected(full[0] ?? null); };
  return <><div className="wb-prompt-library"><button type="button" className="wb-prompt-library-toggle" onClick={() => { setOpen((value) => !value); if (!open) load().catch(() => onNotify("提示词库加载失败，请重试")); }}><Icon name="library" />提示词库</button></div>{open && <div className="wb-prompt-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="wb-prompt-modal" role="dialog" aria-modal="true" aria-label="提示词库"><div className="wb-prompt-popover-head"><div><span className="wb-modal-eyebrow">PROMPT LIBRARY</span><strong>提示词库</strong></div><button type="button" aria-label="关闭提示词库" onClick={() => setOpen(false)}><Icon name="x" /></button></div><select value={stage} onChange={(event) => { const next = event.target.value as typeof stage; setStage(next); suiteApi.listPromptTemplates(next || undefined).then(async (items) => { const full = await Promise.all(items.map((item) => suiteApi.copyPromptTemplate(item.templateVersionId, item.stage))); setTemplates(full); setSelected(full[0] ?? null); }).catch(() => onNotify("阶段模板加载失败")); }}><option value="">全部阶段</option><option value="base_refine">底图精修</option><option value="plan">计划生成</option><option value="task_image">单卡创作</option></select><div className="wb-prompt-list">{templates.map((template) => <button type="button" key={template.templateVersionId} className={selected?.templateVersionId === template.templateVersionId ? "is-selected" : ""} onClick={() => setSelected(template)}><strong>{template.name}</strong><span>{template.stage} · v{template.versionNo}</span></button>)}</div>{selected && <div className="wb-prompt-detail"><strong>{selected.name}</strong><pre>{selected.body}</pre><button type="button" onClick={() => navigator.clipboard.writeText(selected.body).then(() => onNotify("提示词已复制")).catch(() => onNotify("复制失败，请重试"))}><Icon name="copy" />复制提示词</button></div>}</section></div>}</>;
}

function WhiteResourcePicker({ task, onBound, onNotify }: { task: ApiSuiteTask; onBound: () => Promise<void>; onNotify: (message: string) => void }) {
  const [items, setItems] = useState<ApiLibraryResource[]>([]); const [selected, setSelected] = useState<ApiProductMaterialRef[]>([]); const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false);
  useEffect(() => { if (task.originKind !== "reverse_import") return; suiteApi.listLibraryResources({ resourceType: "base_image", status: "published", pageSize: 100 }).then((result) => setItems(result.items)).catch(() => onNotify("白底图资源加载失败")); }, [task.id, task.originKind, onNotify]);
  useEffect(() => { const refs = Array.isArray(task.generationParams?.productMaterialRefs) ? task.generationParams.productMaterialRefs as ApiProductMaterialRef[] : []; setSelected(refs.slice().sort((a, b) => a.order - b.order)); }, [task.id, task.generationParams]);
  if (task.originKind !== "reverse_import") return null;
  const toggle = (item: ApiLibraryResource) => setSelected((current) => current.some((ref) => ref.resourceId === item.id) ? current.filter((ref) => ref.resourceId !== item.id) : current.length >= 3 ? current : [...current, { libraryReferenceId: "", resourceId: item.id, resourceVersionId: item.resourceVersionId, order: current.length + 1, title: item.title, previewUrl: item.previewUrl ?? `/api/library/resources/${encodeURIComponent(item.id)}/preview` }]);
  const move = (index: number, delta: number) => setSelected((current) => { const next = current.slice(); const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next.map((item, order) => ({ ...item, order: order + 1 })); });
  const save = async () => { if (!selected.length) return; setLoading(true); try { await suiteApi.bindWhiteResources(task.id, selected.map((item) => item.resourceId)); await onBound(); setOpen(false); onNotify(task.sourceRevision ? "已更换白底图并创建新的任务源版本" : "白底图已绑定"); } catch { onNotify("白底图绑定失败"); } finally { setLoading(false); } };
  return <><div className="wb-inspector-field"><span>产品白底图</span><div className="wb-material-summary">{selected.length ? selected.map((item, index) => <span key={item.resourceId}>{index + 1}. {item.title ?? item.resourceId.slice(0, 8)}</span>) : <small>尚未绑定，最多选择 3 张</small>}</div><button type="button" className="wb-primary-action" onClick={() => setOpen(true)}>添加产品白底图</button><small>{selected.length ? `已冻结 ${selected.length} 个资源版本 · 源版本 ${task.sourceRevision ?? 1}` : "从图片资源库选择已发布白底图"}</small></div>{open && <div className="wb-prompt-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="wb-prompt-modal wb-white-picker" role="dialog" aria-modal="true" aria-label="选择产品白底图"><div className="wb-prompt-popover-head"><div><span className="wb-modal-eyebrow">PRODUCT MATERIALS</span><strong>选择产品白底图</strong><small>最多 3 张，按顺序作为主图和补充角度</small></div><button type="button" aria-label="关闭白底图选择器" onClick={() => setOpen(false)}><Icon name="x" /></button></div><div className="wb-white-picker-grid">{items.map((item) => { const active = selected.some((ref) => ref.resourceId === item.id); return <button type="button" key={item.id} className={`wb-white-picker-item ${active ? "is-selected" : ""}`} onClick={() => toggle(item)}><span className="wb-picker-check">{active ? "✓" : ""}</span>{item.previewUrl && <img src={item.previewUrl} alt={item.title} /> }<strong>{item.title}</strong><small>版本 {item.resourceVersionId.slice(0, 8)}</small></button>; })}</div>{selected.length > 0 && <div className="wb-white-picker-order"><strong>已选顺序</strong>{selected.map((item, index) => <div key={item.resourceId}><span>{index + 1}. {item.title}</span><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>上移</button><button type="button" disabled={index === selected.length - 1} onClick={() => move(index, 1)}>下移</button></div>)}</div>}<div className="wb-prompt-modal-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="wb-primary-action" disabled={!selected.length || loading} onClick={() => void save()}>{loading ? "保存中…" : "确认绑定"}</button></div></section></div>}</>;
}

function ImageEditorModal({ task, version, onClose, onSubmit, onOperationAdded, onRegenerate = async () => undefined }: { task: ApiSuiteTask; version: ApiTaskVersion; onClose: () => void; onSubmit: (spec: Record<string, unknown>, instruction: string) => Promise<void>; onOperationAdded?: (operation: DraftOperation, instruction: string) => Promise<void>; onRegenerate?: () => Promise<void> }) {
  const freshOperationId = (type: DraftOperation["type"]) => `${type}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  const [tool, setTool] = useState<EditTool>("re_edit");
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<MaskStroke | null>(null);
  const [maskMode, setMaskMode] = useState<"draw" | "erase">("draw");
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("新品主视觉");
  const [originalText, setOriginalText] = useState("");
  const [newText, setNewText] = useState("");
  const [textOperationId, setTextOperationId] = useState(() => freshOperationId("add_text"));
  const [brush, setBrush] = useState(42);
  const [expand, setExpand] = useState("all");
  const [ratio, setRatio] = useState("original");
  const [instruction, setInstruction] = useState(() => versionGenerationPrompt(version, task.promptDraft));
  const [addTextPrompt, setAddTextPrompt] = useState("");
  const [changeTextPrompt, setChangeTextPrompt] = useState("保持原有排版、字体感觉、颜色、透视和光影，只替换文字内容");
  const [redrawPrompt, setRedrawPrompt] = useState("");
  const [erasePrompt, setErasePrompt] = useState("移除选区中的目标，并根据周围画面自然补全背景，保持原有光线、纹理和透视关系");
  const [operations, setOperations] = useState<DraftOperation[]>([]);
  const committedOperationIds = useRef<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [ocrBlocks, setOcrBlocks] = useState<Array<{ id: string; text: string; confidence: number; bounds: { x: number; y: number; width: number; height: number }; rotation: number }>>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [textRegion, setTextRegion] = useState({ x: 0.36, y: 0.42, width: 0.28, height: 0.1, rotation: 0 });
  const [capabilities, setCapabilities] = useState<ImageEditCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [feather, setFeather] = useState(0.08);
  const [redoStrokes, setRedoStrokes] = useState<MaskStroke[]>([]);
  const [regionStart, setRegionStart] = useState<{ x: number; y: number } | null>(null);
  const [activeRegion, setActiveRegion] = useState<typeof textRegion | null>(null);
  const [frame, setFrame] = useState<ImageFrame>({ left: 0, top: 0, width: 1, height: 1 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const textNodeRef = useRef<Konva.Text | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const runOcr = useCallback(async () => { setOcrLoading(true); try { const result = await suiteApi.recognizeImageEditText(task.id, version.id); setOcrBlocks(result.blocks ?? []); if (result.blocks?.[0]) { setOriginalText(result.blocks[0].text); setTextRegion({ ...result.blocks[0].bounds, rotation: result.blocks[0].rotation }); } } catch { setOcrBlocks([]); setEditorError("文字识别失败，可重新识别或手工框选文字区域"); } finally { setOcrLoading(false); } }, [task.id, version.id]);
  useEffect(() => { suiteApi.imageEditorCapabilities().then((result) => setCapabilities(result.capabilities)).catch(() => setCapabilityError("能力状态暂时不可用")); }, []);
  useEffect(() => { suiteApi.getImageEditDraft(task.id).then((draft) => { const restored = (draft.operations as unknown as DraftOperation[]).filter((item) => item.sourceVersionId === version.id); committedOperationIds.current = new Set(restored.map((item) => item.operationId)); setOperations(restored); const firstText = restored.find((item) => item.type === "add_text"); if (firstText) { const payload = firstText.payload; setTextOperationId(firstText.operationId); setText(String(payload.text ?? "")); setAddTextPrompt(String(payload.prompt ?? "")); if (payload.region && typeof payload.region === "object") setTextRegion(payload.region as typeof textRegion); } }).catch(() => undefined); }, [task.id, version.id]);
  const updateFrame = useCallback(() => { const image = imageRef.current; const canvas = canvasRef.current; if (!image || !canvas) return; const imageRect = image.getBoundingClientRect(); const canvasRect = canvas.getBoundingClientRect(); if (!imageRect.width || !imageRect.height) return; setFrame({ left: imageRect.left - canvasRect.left, top: imageRect.top - canvasRect.top, width: imageRect.width, height: imageRect.height }); }, []);
  useEffect(() => { const observer = new ResizeObserver(updateFrame); if (canvasRef.current) observer.observe(canvasRef.current); if (imageRef.current) observer.observe(imageRef.current); updateFrame(); return () => observer.disconnect(); }, [updateFrame]);
  useEffect(() => { if (tool === "change_text" && !ocrBlocks.length) void runOcr(); }, [runOcr, tool]);
  useEffect(() => { const transformer = transformerRef.current; if (!transformer) return; const node = textNodeRef.current; if (!node || !["add_text", "change_text"].includes(tool)) { transformer.nodes([]); transformer.getLayer()?.batchDraw(); return; } transformer.nodes([node]); transformer.getLayer()?.batchDraw(); }, [tool, textOperationId, text, newText, textRegion]);
  const pointFromEvent = (event: { target: { getStage(): Konva.Stage | null } }) => { const point = event.target.getStage()?.getPointerPosition() ?? { x: 0, y: 0 }; return { x: Math.max(0, Math.min(1, point.x / Math.max(1, frame.width))), y: Math.max(0, Math.min(1, point.y / Math.max(1, frame.height))) }; };
  const startStroke = (event: { target: { getStage(): Konva.Stage | null } }) => { const point = pointFromEvent(event); if (["inpaint", "erase"].includes(tool)) { setActiveStroke({ mode: maskMode, points: [point], size: brush / Math.max(1, Math.min(frame.width, frame.height)) }); setRedoStrokes([]); return; } if (tool === "change_text" && event.target === event.target.getStage()) { setRegionStart(point); setActiveRegion({ x: point.x, y: point.y, width: 0, height: 0, rotation: 0 }); } };
  const movePointer = (event: { target: { getStage(): Konva.Stage | null } }) => { const point = pointFromEvent(event); setPointer({ x: point.x * frame.width, y: point.y * frame.height }); if (activeStroke) setActiveStroke((stroke) => stroke ? { ...stroke, points: [...stroke.points, point] } : stroke); if (regionStart) setActiveRegion({ x: Math.min(regionStart.x, point.x), y: Math.min(regionStart.y, point.y), width: Math.abs(point.x - regionStart.x), height: Math.abs(point.y - regionStart.y), rotation: 0 }); };
  const finishStroke = () => { if (activeStroke) { setStrokes((current) => [...current, activeStroke]); setActiveStroke(null); return; } if (activeRegion && activeRegion.width > 0 && activeRegion.height > 0) setTextRegion(activeRegion); setRegionStart(null); setActiveRegion(null); };
  const undo = () => { setStrokes((current) => { if (current.length) setRedoStrokes((redo) => [...redo, current[current.length - 1]]); return current.slice(0, -1); }); };
  const redo = () => { setRedoStrokes((current) => { const item = current[current.length - 1]; if (!item) return current; setStrokes((value) => [...value, item]); return current.slice(0, -1); }); };
  const operationFor = (selectedTool = tool): DraftOperation => {
    const type = selectedTool === "inpaint" ? "redraw" : selectedTool === "expand" ? "outpaint" : selectedTool as DraftOperation["type"];
    const prompt = selectedTool === "re_edit" ? instruction : selectedTool === "add_text" ? addTextPrompt : selectedTool === "change_text" ? changeTextPrompt : selectedTool === "inpaint" ? redrawPrompt : selectedTool === "erase" ? erasePrompt : "";
    const summary = selectedTool === "add_text" ? `添加文本：${text}` : selectedTool === "change_text" ? `改文字：${originalText || "原文字"} → ${newText}` : selectedTool === "inpaint" ? "局部重绘选区" : selectedTool === "erase" ? "消除笔移除选区" : selectedTool === "expand" ? `扩图：${expand} · ${ratio}` : "重新编辑提示词";
    const existing = selectedTool === "add_text" ? textOperationId : operations.find((item) => item.type === type)?.operationId;
    return { operationId: existing ?? freshOperationId(type), type, summary, sourceVersionId: version.id, payload: { text, originalText, newText, region: textRegion, strokes: strokes.map((stroke) => ({ mode: stroke.mode, points: stroke.points, width: stroke.size })), feather, direction: expand, targetRatio: ratio, prompt } };
  };
  const validationError = () => { if (tool === "re_edit" && !instruction.trim()) return "请填写编辑提示词"; if (tool === "add_text" && (!text.trim() || !addTextPrompt.trim())) return "请填写精确文字和添加文字要求"; if (tool === "change_text" && (!originalText.trim() || !newText.trim() || !changeTextPrompt.trim())) return "请确认原文字、新文字和替换要求"; if (tool === "inpaint" && (!strokes.length || !redrawPrompt.trim())) return "请绘制选区并填写重绘要求"; if (tool === "erase" && !strokes.length) return "请先绘制要清除的选区"; return ""; };
  const addOperation = async () => { const error = validationError(); if (error) { setEditorError(error); return; } const next = operationFor(); setSaving(true); setEditorError(""); try { await onOperationAdded?.(next, next.summary); committedOperationIds.current.add(next.operationId); setOperations((current) => [...current.filter((item) => item.operationId !== next.operationId), next]); } catch (errorValue) { setEditorError(errorValue instanceof Error ? errorValue.message : "操作保存失败"); } finally { setSaving(false); } };
  useEffect(() => { if (tool === "regenerate") return; const next = operationFor(); const current = operations.find((item) => item.operationId === next.operationId); if (!current || !committedOperationIds.current.has(next.operationId) || (current.summary === next.summary && JSON.stringify(current.payload) === JSON.stringify(next.payload))) return; const timer = window.setTimeout(() => { setOperations((items) => items.map((item) => item.operationId === next.operationId ? next : item)); void onOperationAdded?.(next, next.summary).catch(() => setEditorError("对话操作同步失败，请重试")); }, 250); return () => window.clearTimeout(timer); }, [tool, text, originalText, newText, textRegion, strokes, feather, expand, ratio, instruction, addTextPrompt, changeTextPrompt, redrawPrompt, erasePrompt, textOperationId, operations]);
  const submit = async () => { setSaving(true); setEditorError(""); try { await onSubmit({ schemaVersion: "image-edit-v1", sourceVersionId: version.id, operations }, operations.map((item) => item.summary).join("；")); } catch (errorValue) { setEditorError(errorValue instanceof Error ? errorValue.message : "生成提交失败"); } finally { setSaving(false); } };
  const selectOperation = (item: DraftOperation) => { const payload = item.payload; setEditorError(""); if (item.type === "add_text") { setTool("add_text"); setTextOperationId(item.operationId); setText(String(payload.text ?? "")); setAddTextPrompt(String(payload.prompt ?? "")); } else if (item.type === "change_text") { setTool("change_text"); setOriginalText(String(payload.originalText ?? "")); setNewText(String(payload.newText ?? "")); setChangeTextPrompt(String(payload.prompt ?? "")); } else if (item.type === "redraw") { setTool("inpaint"); setRedrawPrompt(String(payload.prompt ?? "")); } else if (item.type === "erase") { setTool("erase"); setErasePrompt(String(payload.prompt ?? "")); } else if (item.type === "outpaint") setTool("expand"); else setTool("re_edit"); if (payload.region && typeof payload.region === "object") setTextRegion(payload.region as typeof textRegion); if (Array.isArray(payload.strokes)) setStrokes((payload.strokes as Array<{ mode?: "draw" | "erase"; points: MaskStroke["points"]; width: number }>).map((stroke) => ({ mode: stroke.mode ?? "draw", points: stroke.points, size: stroke.width }))); };
  const updateTextRegion = (node: Konva.Text, transformed = false) => { const scaleX = transformed ? node.scaleX() : 1; const scaleY = transformed ? node.scaleY() : 1; const width = Math.max(24 / frame.width, node.width() * scaleX / frame.width); const height = Math.max(18 / frame.height, node.height() * scaleY / frame.height); if (transformed) { node.scaleX(1); node.scaleY(1); } setTextRegion({ x: Math.max(0, Math.min(1 - width, (node.x() - width * frame.width / 2) / frame.width)), y: Math.max(0, Math.min(1 - height, (node.y() - height * frame.height / 2) / frame.height)), width: Math.min(1, width), height: Math.min(1, height), rotation: node.rotation() }); };
  const toolList: Array<[EditTool, string, string]> = [["re_edit", "重新编辑", "imageToImage"], ["regenerate", "再次生成", "currentVersionInput"], ["add_text", "添加文本", "addText"], ["change_text", "改文字", "changeText"], ["inpaint", "局部重绘", "redraw"], ["erase", "消除笔", "erase"], ["expand", "扩图", "outpaint"]];
  const activeCapability = toolList.find(([value]) => value === tool)?.[2];
  const capabilityAvailable = (value: EditTool, capability: string) => capabilities?.[capability] !== false && (value !== "change_text" || capabilities?.ocr !== false);
  const capabilityReady = tool === "regenerate" ? capabilities?.currentVersionInput !== false : !capabilities || capabilityAvailable(tool, activeCapability ?? "");
  const targetSize = (() => { const ratioValue = ratio === "original" ? version.width / Math.max(1, version.height) : Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]); if (!Number.isFinite(ratioValue) || ratioValue <= 0) return { width: version.width, height: version.height }; if (ratioValue >= version.width / Math.max(1, version.height)) return { width: Math.max(version.width, Math.ceil(version.height * ratioValue)), height: version.height }; return { width: version.width, height: Math.max(version.height, Math.ceil(version.width / ratioValue)) }; })();
  const textVisible = tool === "add_text" || tool === "change_text";
  const textOperations = operations.filter((item) => item.type === "add_text");
  const hasActiveTextOperation = textOperations.some((item) => item.operationId === textOperationId);
  return <div className="wb-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="wb-editor-modal" role="dialog" aria-modal="true" aria-label="图片编辑器">
      <header className="wb-editor-head"><div><strong>{task.title}</strong><small>基于版本 v{version.versionNumber}，原版本与提示词快照不会被覆盖</small></div><button type="button" aria-label="关闭图片编辑器" onClick={onClose}><Icon name="x" /></button></header>
      <div className="wb-editor-body">{tool === "change_text" && <div className="wb-ocr-blocks" role="status"><strong>识别文字</strong>{ocrLoading ? <span>识别中…</span> : <><button type="button" onClick={() => void runOcr()}>重新识别</button>{ocrBlocks.length ? ocrBlocks.map((block) => <button type="button" key={block.id} onClick={() => { setOriginalText(block.text); setTextRegion({ ...block.bounds, rotation: block.rotation }); }}>{block.text} · {Math.round(block.confidence * 100)}%</button>) : <span>未识别到文字，请在图片上拖拽框选原文字区域</span>}</>}</div>}
        <aside className="wb-editor-tools"><strong>编辑工具</strong>{toolList.map(([value, label, capability]) => <button key={value} type="button" className={tool === value ? "is-active" : ""} disabled={!capabilityAvailable(value, capability)} onClick={() => { setTool(value); setEditorError(""); }}>{label}<small>{!capabilityAvailable(value, capability) ? "不可用" : capabilities ? "可用" : "检查中"}</small></button>)}<p>{["inpaint", "erase"].includes(tool) ? "画笔圆心和落笔位置使用同一显示坐标系" : tool === "change_text" ? "先 OCR 识别；失败时手工框选原文字" : "调整操作后添加到对话，生成时才冻结"}</p>{capabilityError && <p className="wb-editor-error">{capabilityError}</p>}</aside>
        <div className="wb-editor-stage"><div className="wb-editor-canvas" ref={canvasRef}><img ref={imageRef} onLoad={updateFrame} src={version.previewUrl} alt={task.title} /><Stage width={frame.width} height={frame.height} style={{ position: "absolute", left: frame.left, top: frame.top }} onMouseDown={startStroke} onMousemove={movePointer} onMouseup={finishStroke} onMouseleave={() => { setPointer(null); finishStroke(); }}><Layer>{ocrBlocks.map((block) => <KonvaRect key={`ocr-${block.id}`} x={block.bounds.x * frame.width} y={block.bounds.y * frame.height} width={block.bounds.width * frame.width} height={block.bounds.height * frame.height} stroke="#c39416" dash={[7, 5]} strokeWidth={1.5} listening={false} />)}{strokes.map((stroke, index) => <Line key={index} points={stroke.points.flatMap((point) => [point.x * frame.width, point.y * frame.height])} stroke={stroke.mode === "erase" ? "#64748b" : "#e45757"} opacity={stroke.mode === "erase" ? 0.46 : 0.62} strokeWidth={stroke.size * Math.min(frame.width, frame.height)} lineCap="round" lineJoin="round" globalCompositeOperation={stroke.mode === "erase" ? "destination-out" : "source-over"} />)}{activeStroke && <Line points={activeStroke.points.flatMap((point) => [point.x * frame.width, point.y * frame.height])} stroke="#e45757" opacity={0.62} strokeWidth={activeStroke.size * Math.min(frame.width, frame.height)} lineCap="round" lineJoin="round" />}{activeRegion && <KonvaRect x={activeRegion.x * frame.width} y={activeRegion.y * frame.height} width={activeRegion.width * frame.width} height={activeRegion.height * frame.height} stroke="#3d8bfd" dash={[6, 4]} strokeWidth={1.5} />}{textOperations.map((item) => { const payload = item.payload; const selected = tool === "add_text" && item.operationId === textOperationId; const region = selected || !payload.region || typeof payload.region !== "object" ? textRegion : payload.region as typeof textRegion; return <KonvaText key={item.operationId} ref={selected ? textNodeRef : undefined} text={selected ? text : String(payload.text ?? "")} x={(region.x + region.width / 2) * frame.width} y={(region.y + region.height / 2) * frame.height} offsetX={region.width * frame.width / 2} offsetY={region.height * frame.height / 2} width={region.width * frame.width} height={region.height * frame.height} fill="#ffffff" fontSize={Math.max(14, region.height * frame.height * 0.55)} rotation={region.rotation} draggable={selected} shadowColor="#000" shadowBlur={4} onClick={() => selectOperation(item)} onTap={() => selectOperation(item)} onDragEnd={selected ? (event) => updateTextRegion(event.target as Konva.Text) : undefined} onTransformEnd={selected ? (event) => updateTextRegion(event.target as Konva.Text, true) : undefined} />; })}{textVisible && ((tool === "change_text") || (tool === "add_text" && !hasActiveTextOperation)) && <KonvaText ref={textNodeRef} text={tool === "change_text" ? newText || originalText : text} x={(textRegion.x + textRegion.width / 2) * frame.width} y={(textRegion.y + textRegion.height / 2) * frame.height} offsetX={textRegion.width * frame.width / 2} offsetY={textRegion.height * frame.height / 2} width={textRegion.width * frame.width} height={textRegion.height * frame.height} fill="#ffffff" fontSize={Math.max(14, textRegion.height * frame.height * 0.55)} rotation={textRegion.rotation} draggable shadowColor="#000" shadowBlur={4} onDragEnd={(event) => updateTextRegion(event.target as Konva.Text)} onTransformEnd={(event) => updateTextRegion(event.target as Konva.Text, true)} />}{textVisible && <Transformer ref={transformerRef} borderDash={[6, 4]} borderStroke="#3d8bfd" anchorStroke="#3d8bfd" anchorFill="#ffffff" rotateAnchorOffset={22} enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} boundBoxFunc={(oldBox, newBox) => newBox.width < 24 || newBox.height < 18 ? oldBox : newBox} />}{["inpaint", "erase"].includes(tool) && pointer && <KonvaCircle x={pointer.x} y={pointer.y} radius={brush / 2} stroke={maskMode === "erase" ? "#475569" : "#dc3f3f"} dash={maskMode === "erase" ? [4, 3] : undefined} strokeWidth={1.5} listening={false} />}</Layer></Stage>{tool === "expand" && <div className="wb-outpaint-overlay"><span>待扩展区域</span><strong>{targetSize.width} × {targetSize.height}</strong><small>锚点：{expand === "left" ? "右侧" : expand === "right" ? "左侧" : "中心"}</small></div>}</div><div className="wb-editor-bottom"><span>{strokes.length ? `已记录 ${strokes.length} 条蒙版笔画` : "未绘制选区"}</span>{["inpaint", "erase"].includes(tool) && <div className="wb-mask-mode" role="group" aria-label="蒙版修正模式"><button type="button" className={maskMode === "draw" ? "is-active" : ""} onClick={() => setMaskMode("draw")}>绘制选区</button><button type="button" className={maskMode === "erase" ? "is-active" : ""} onClick={() => setMaskMode("erase")}>擦除选区</button></div>}<button type="button" disabled={!strokes.length} onClick={undo}>撤销</button><button type="button" disabled={!redoStrokes.length} onClick={redo}>重做</button><button type="button" disabled={!strokes.length} onClick={() => { setStrokes([]); setRedoStrokes([]); }}>清空</button></div></div>
        <aside className="wb-editor-options">{tool === "re_edit" && <label>版本详细提示词<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>}{tool === "add_text" && <><div className="wb-editor-option-head"><strong>文字区域</strong><button type="button" onClick={() => { setTextOperationId(freshOperationId("add_text")); setText(""); setAddTextPrompt(""); setTextRegion({ x: 0.36, y: 0.42, width: 0.28, height: 0.1, rotation: 0 }); }}>新建文字框</button></div><label>精确文字<input value={text} onChange={(event) => setText(event.target.value)} /></label><label>添加文字要求<textarea value={addTextPrompt} onChange={(event) => setAddTextPrompt(event.target.value)} placeholder="描述文字的视觉感觉，以及与画面光线、透视的关系" /></label><button type="button" className="wb-danger-link" onClick={() => { const id = textOperationId; setOperations((current) => current.filter((item) => item.operationId !== id)); void suiteApi.removeImageEditOperation(task.id, id); setTextOperationId(freshOperationId("add_text")); setText(""); }}>删除当前文字框</button></>}{tool === "change_text" && <><label>原文字<input value={originalText} onChange={(event) => setOriginalText(event.target.value)} placeholder="OCR 失败时手工确认" /></label><label>新文字<input value={newText} onChange={(event) => setNewText(event.target.value)} /></label><label>替换要求<textarea value={changeTextPrompt} onChange={(event) => setChangeTextPrompt(event.target.value)} /></label><small>可拖拽虚线框校正识别区域</small></>}{["inpaint", "erase"].includes(tool) && <><label>笔刷大小<input type="range" min="12" max="120" value={brush} onChange={(event) => setBrush(Number(event.target.value))} /><output>{brush}px</output></label><label>边缘羽化<input type="range" min="0" max="40" value={Math.round(feather * 100)} onChange={(event) => setFeather(Number(event.target.value) / 100)} /><output>{Math.round(feather * 100)}%</output></label>{tool === "inpaint" ? <label>重绘要求<textarea value={redrawPrompt} onChange={(event) => setRedrawPrompt(event.target.value)} placeholder="描述选区中要重绘成什么，以及需要保留的画面关系" /></label> : <label>清除要求<textarea value={erasePrompt} onChange={(event) => setErasePrompt(event.target.value)} /></label>}</>}{tool === "expand" && <><label>扩图方向<select value={expand} onChange={(event) => setExpand(event.target.value)}><option value="all">四周</option><option value="horizontal">左右</option><option value="vertical">上下</option><option value="left">向左</option><option value="right">向右</option></select></label><label>目标比例<select value={ratio} onChange={(event) => setRatio(event.target.value)}><option value="original">原比例</option><option value="1:1">1:1</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="9:16">9:16</option><option value="16:9">16:9</option></select></label><output>目标尺寸 {targetSize.width} × {targetSize.height}</output></>}{tool === "regenerate" && <p>再次生成只在当前卡片下新增版本，不创建子卡片。</p>}<div className="wb-editor-operations">{operations.map((item) => <div key={item.operationId}><button type="button" className="wb-operation-edit" onClick={() => selectOperation(item)}>{item.summary}</button><button type="button" onClick={() => { setOperations((current) => current.filter((entry) => entry.operationId !== item.operationId)); void suiteApi.removeImageEditOperation(task.id, item.operationId); }}>移除</button></div>)}</div></aside>
        <footer className="wb-editor-footer"><span>已加入对话 {operations.length} 项</span>{editorError && <strong role="alert">{editorError}</strong>}<button type="button" onClick={onClose}>取消</button>{tool !== "regenerate" && <button type="button" disabled={saving || !capabilityReady} onClick={() => void addOperation()}>{saving ? "保存中…" : operations.some((item) => item.operationId === operationFor().operationId) ? "更新对话操作" : "添加到对话"}</button>}{tool === "regenerate" ? <button type="button" className="wb-primary-action" disabled={saving || !capabilityReady} onClick={() => { setSaving(true); onRegenerate().then(onClose).catch((errorValue) => setEditorError(errorValue instanceof Error ? errorValue.message : "再次生成失败")).finally(() => setSaving(false)); }}>{saving ? "提交中…" : "再次生成当前版本"}</button> : <button type="button" className="wb-primary-action" disabled={saving || !operations.length || !capabilityReady} onClick={() => void submit()}>{saving ? "提交中…" : "冻结并生成子卡片"}</button>}</footer>
      </div>
    </section>
  </div>;
}

export function WorkbenchBoardPage({ suiteId, navigate }: { suiteId: string; navigate: (to: string) => void }) {
  return <ReactFlowProvider><WorkbenchBoardInner suiteId={suiteId} navigate={navigate} /></ReactFlowProvider>;
}

function WorkbenchBoardInner({ suiteId, navigate }: { suiteId: string; navigate: (to: string) => void }) {
  const [workbench, setWorkbench] = useState<ApiWorkbench | null>(null);
  const [mode, setMode] = useState<BoardMode>("compose");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const nodesRef = useRef<BoardNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editor, setEditor] = useState<{ task: ApiSuiteTask; version: ApiTaskVersion } | null>(null);
  const [toast, setToast] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const layoutVersionRef = useRef(0);
  const layoutSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const { fitView } = useReactFlow();
  const styleGuide = useMemo(() => workbench ? firstStyleValue(workbench) : "", [workbench]);
  const selectedTask = workbench?.tasks.find((task) => task.id === selectedTaskId) ?? (() => { if (!workbench || !selectedTaskId) return null; const index = (workbench.imageEditChildren ?? []).findIndex((child) => String(child.task.id) === selectedTaskId); return index >= 0 ? imageEditChildTask(workbench, workbench.imageEditChildren![index], index) : null; })();
  const selectedIsImageEditChild = Boolean(workbench?.imageEditChildren?.some((child) => String(child.task.id) === selectedTask?.id));
  useEffect(() => { setPromptDraft(selectedTask?.promptDraft ?? ""); }, [selectedTask?.id, selectedTask?.promptDraft]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2200); };
  const reload = useCallback(async () => {
    const next = await suiteApi.getWorkbench(suiteId);
    setWorkbench(next);
    layoutVersionRef.current = next.layout?.layoutVersion ?? 0;
    setViewport(next.layout?.viewport ?? { x: 0, y: 0, zoom: 1 });
    const projected = project(next, next.layout, mode, firstStyleValue(next), { onPreview: setPreview, onSelect: (task) => setSelectedTaskId(task.id), onGenerate: (task) => generateOne(task).catch(() => notify("生成提交失败")), onCopy: (task) => copyPrompt(task).catch(() => notify("复制失败")), onRegenerate: (task) => regenerateTask(task).catch(() => notify("重新生成提交失败")), onEdit: (task, version) => { if (version) setEditor({ task, version }); }, onSelectVersion: (task, versionId, selection) => selectVersion(task, versionId, selection).catch(() => notify("版本选择失败")) });
    const savedIds = new Set((next.layout?.nodes ?? []).map((node) => node.nodeId));
    const needsFit = !next.layout || projected.nodes.some((node) => !savedIds.has(node.id));
    nodesRef.current = projected.nodes;
    setNodes(projected.nodes);
    setEdges(projected.edges);
    if (needsFit) window.setTimeout(() => fitView({ padding: 0.12, duration: 0 }), 0);
    setSelectedTaskId((current) => current && (next.tasks.some((task) => task.id === current) || next.imageEditChildren?.some((child) => String(child.task.id) === current)) ? current : next.tasks.find((task) => task.status !== "archived")?.id ?? null);
  }, [fitView, mode, setNodes, suiteId]);
  useEffect(() => { reload().catch(() => notify("工作台加载失败，请重试")); }, [reload]);
  useEffect(() => {
    const ordinaryTaskRunning = workbench?.tasks.some((task) => task.status === "generating");
    const editChildRunning = workbench?.imageEditChildren?.some((child) => String(child.task.status) === "generating");
    if (!ordinaryTaskRunning && !editChildRunning) return;
    const timer = window.setInterval(() => { reload().catch(() => undefined); }, 1800);
    return () => window.clearInterval(timer);
  }, [reload, workbench]);
  const persistLayout = useCallback((nextNodes: BoardNode[], nextViewport = viewport) => {
    const nodesToSave = nextNodes.map((node) => ({ nodeId: node.id, x: node.position.x, y: node.position.y }));
    layoutSaveQueue.current = layoutSaveQueue.current.catch(() => undefined).then(async () => {
      try {
        const saved = await suiteApi.saveLayout(suiteId, { layoutVersion: layoutVersionRef.current, viewport: nextViewport, nodes: nodesToSave, groups: [] });
        layoutVersionRef.current = saved.layoutVersion;
      } catch { notify("画布布局保存失败，请重试"); }
    });
    return layoutSaveQueue.current;
  }, [suiteId, viewport]);
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => { const next = applyNodeChanges(changes, nodesRef.current); nodesRef.current = next; onNodesChange(changes); if (changes.some((change) => change.type === "position" && change.dragging === false)) persistLayout(next).catch(() => undefined); }, [onNodesChange, persistLayout]);
  const updateTaskParams = async (patch: Record<string, unknown>) => { if (!selectedTask || selectedIsImageEditChild) return; await suiteApi.updateTask(selectedTask.id, { generationParams: { ...selectedTask.generationParams, ...patch } }); await reload(); notify("已保存当前卡片参数"); };
  const savePrompt = async () => { if (!selectedTask || selectedIsImageEditChild) return; await suiteApi.updateTask(selectedTask.id, { promptDraft }); await reload(); notify("提示词已保存"); };
  const generateOne = async (task: ApiSuiteTask, promptOverride?: string) => { if (workbench?.imageEditChildren?.some((child) => String(child.task.id) === task.id)) return regenerateTask(task); await suiteApi.generateTask(task.id, promptOverride ?? task.promptDraft); await reload(); notify("已提交单卡生成"); };
  const submitEdit = async (task: ApiSuiteTask, spec: Record<string, unknown>, instruction: string) => {
    const operations = Array.isArray(spec.operations) ? spec.operations : [];
    for (const operation of operations) await suiteApi.upsertImageEditOperation(task.id, operation as Record<string, unknown>, instruction);
    await suiteApi.submitImageEdit(task.id, { sourceCardId: task.id, sourceVersionId: String(spec.sourceVersionId ?? ""), parentVersionId: String(spec.sourceVersionId ?? ""), summary: instruction });
    setEditor(null); await reload(); notify("编辑已加入对话，正在生成子卡片");
  };
  const persistEditOperation = async (task: ApiSuiteTask, operation: DraftOperation, instruction: string) => { await suiteApi.upsertImageEditOperation(task.id, operation as unknown as Record<string, unknown>, instruction); };
  const regenerateTask = async (task: ApiSuiteTask) => { const child = workbench?.imageEditChildren?.find((item) => String(item.task.id) === task.id); if (child) { const latest = child.attempts[child.attempts.length - 1]; if (latest && String(latest.status) === "failed") await suiteApi.retryImageEdit(String(latest.id)); else await suiteApi.regenerateImageEditTask(task.id, task.promptDraft); } else await suiteApi.generateTask(task.id, task.promptDraft); await reload(); notify("已提交再次生成"); };
  const selectVersion = async (task: ApiSuiteTask, versionId: string, selection: "current" | "final") => { const isImageEditChild = Boolean(workbench?.imageEditChildren?.some((child) => String(child.task.id) === task.id)); if (isImageEditChild) await suiteApi.selectImageEditVersion(task.id, versionId, selection); else await suiteApi.selectTaskVersion(task.id, versionId, selection); await reload(); notify(selection === "final" ? "已设为终版" : "已切换当前版本"); };
  const generateAll = async () => { if (!workbench) return; const tasks = workbench.tasks.filter((task) => task.status !== "archived" && (task.originKind !== "reverse_import" || task.sourceLibraryReferenceId)); if (tasks.length) { await suiteApi.generateBatch(suiteId, tasks.map((task) => task.id)); await reload(); notify(`已提交 ${tasks.length} 个任务`); } };
  const copyPrompt = async (task: ApiSuiteTask) => { await navigator.clipboard.writeText(styledPrompt(task, styleGuide)); notify("提示词已复制"); };
  if (!workbench) return <div className="suite-shell"><main className="suite-main"><div className="flow-loading">正在恢复套图工作台…</div></main></div>;
  const currentVersion = selectedTask?.versions.find((version) => version.isCurrent) ?? selectedTask?.versions[0];
  const activeTasks = workbench.tasks.filter((task) => task.status !== "archived");
  const isGenerating = activeTasks.some((task) => task.status === "generating") || Boolean(workbench.imageEditChildren?.some((child) => String(child.task.status) === "generating"));
  return <div className="suite-shell flow-shell wb-shell"><header className="suite-topbar wb-topbar"><button className="suite-brand" type="button" onClick={() => navigate(`/suites/${suiteId}`)}><img src="/logo.png" alt="" width={36} height={36} style={{ objectFit: "contain", flexShrink: 0 }} /><strong>PicAgent</strong></button><div className="suite-breadcrumb"><button type="button" onClick={() => navigate(`/suites/${suiteId}`)}>套图创建</button><i>/</i><strong>{workbench.suite.name}</strong></div><div className="wb-view-switch" role="tablist" aria-label="工作台视图"><button className={mode === "compose" ? "is-active" : ""} type="button" onClick={() => setMode("compose")}>创作板</button><button className={mode === "gallery" ? "is-active" : ""} type="button" onClick={() => setMode("gallery")}>成品展示板</button></div><div className="suite-top-actions"><span className="suite-status"><b></b>{isGenerating ? "生成中" : "已保存"}</span></div></header><main className="suite-main wb-main"><section className="wb-workspace"><div className="wb-canvas-panel"><div className="wb-canvas-toolbar"><div><strong>{mode === "compose" ? "故事板" : "成品展示"}</strong><span>{mode === "compose" ? "每张白底图都可连接到生成任务" : `${activeTasks.length} 张任务卡 · 选择卡片查看详情`}</span></div><div className="wb-canvas-actions">{mode === "compose" && <button type="button" className="wb-primary-action" disabled={isGenerating} onClick={() => generateAll().catch(() => notify("批量生成提交失败"))}>{isGenerating ? "生成中…" : "生成全部"}</button>}<button type="button" onClick={() => fitView({ padding: 0.18, duration: 250 })} title="适应视图"><Icon name="fit" /></button><button type="button" onClick={() => navigate(`/suites/${suiteId}`)}>修改计划</button></div></div><div className={`wb-canvas wb-canvas-${mode}`}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={handleNodesChange} onMoveEnd={(_, next) => { setViewport(next); persistLayout(nodesRef.current, next).catch(() => undefined); }} defaultViewport={viewport} onNodeClick={(_, node) => { if (node.data.task) setSelectedTaskId(node.data.task.id); if (node.data.imageUrl && (node.data.kind === "base" || node.data.kind === "reverse-ref")) setPreview({ url: node.data.imageUrl, title: node.data.title, subtitle: node.data.subtitle }); }} nodesDraggable nodesConnectable={false} fitView={false}><Background gap={20} size={1} color="#e4e7eb" /><Controls showInteractive={false} /></ReactFlow></div></div><aside className="wb-rail"><div className="wb-rail-head"><div><span>当前参数</span><strong>{selectedTask ? selectedTask.title : "选择一张任务卡"}</strong></div><div className="wb-parameter-pills"><span>{selectedTask ? modelFor(selectedTask) : "gpt-image-2"}</span><span>{selectedTask ? ratioFor(selectedTask) : "1:1"}</span><span>{selectedTask ? sizeFor(selectedTask) : "1K"}</span></div></div><div className="wb-mode-explainer"><span>当前模式</span><strong>{selectedTask?.originKind === "reverse_import" ? "爆品图反推任务组" : "套图模式"}</strong><p>同一画布中统一管理参考图、白底图、任务提示词和生成结果。</p></div><div className="wb-reference-strip"><div><strong>{workbench.inputImages.length}</strong><span>输入图</span></div><div><strong>{activeTasks.length}</strong><span>任务卡</span></div><div><strong>{workbench.planSnapshot?.items.length ?? 0}</strong><span>计划项</span></div></div>{selectedTask ? <div className="wb-inspector-body"><div className="wb-selected-title"><span>{selectedTask.imageType === "main" ? "主图任务" : "详情页任务"}</span><strong>{selectedTask.title}</strong></div><div className="wb-inspector-prompt"><span>当前提示词</span><pre>{currentVersion ? versionGenerationPrompt(currentVersion, styledPrompt({ ...selectedTask, promptDraft }, styleGuide)) : styledPrompt({ ...selectedTask, promptDraft }, styleGuide)}</pre></div><label className="wb-inspector-field"><span>提示词草稿</span><textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} /></label><WhiteResourcePicker task={selectedTask} onBound={reload} onNotify={notify} />{selectedTask.originKind === "reverse_import" && <label className="wb-inspector-field wb-checkbox-field"><span>爆品图参考</span><input type="checkbox" checked={selectedTask.generationParams?.explosiveReferenceEnabled !== false} onChange={(event) => updateTaskParams({ explosiveReferenceEnabled: event.target.checked }).catch(() => notify("参考图开关保存失败"))} /><small>默认携带爆品图，仅参考构图、光影和版式</small></label>}<label className="wb-inspector-field"><span>比例</span><select value={ratioFor(selectedTask)} onChange={(event) => updateTaskParams({ ratio: event.target.value }).catch(() => notify("比例保存失败"))}><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option><option>16:9</option></select></label><label className="wb-inspector-field"><span>尺寸</span><select value={sizeFor(selectedTask)} onChange={(event) => updateTaskParams({ size: event.target.value }).catch(() => notify("尺寸保存失败"))}><option>1K</option><option>2K</option><option>4K</option></select></label><label className="wb-inspector-field"><span>清晰度</span><select value={qualityFor(selectedTask)} onChange={(event) => updateTaskParams({ quality: event.target.value }).catch(() => notify("清晰度保存失败"))}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><div className="wb-inspector-actions"><button type="button" className="wb-primary-action" onClick={() => savePrompt().catch(() => notify("提示词保存失败"))}>保存提示词</button><button type="button" className="wb-primary-action" disabled={selectedTask.originKind === "reverse_import" && !selectedTask.sourceLibraryReferenceId} onClick={() => generateOne(selectedTask, promptDraft).catch(() => notify("生成提交失败"))}>创作</button><button type="button" onClick={() => copyPrompt({ ...selectedTask, promptDraft }).catch(() => notify("复制失败"))}><Icon name="copy" />复制提示词</button>{currentVersion && <button type="button" onClick={() => setEditor({ task: selectedTask, version: currentVersion })}><Icon name="edit" />编辑图片</button>}</div></div> : <div className="wb-inspector-empty">从故事板选择任务卡，查看提示词和输出参数。</div>}<PromptLibraryButton onNotify={notify} /></aside></section></main>{editor && <ImageEditorModal task={editor.task} version={editor.version} onClose={() => setEditor(null)} onOperationAdded={(operation, instruction) => persistEditOperation(editor.task, operation, instruction)} onRegenerate={() => regenerateTask(editor.task)} onSubmit={(spec, instruction) => submitEdit(editor.task, spec, instruction)} />}{preview && <div className="flow-image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><section className="flow-image-preview" role="dialog" aria-modal="true" aria-labelledby="wb-preview-title"><header><div><p>IMAGE PREVIEW</p><h2 id="wb-preview-title">{preview.title}</h2><span>{preview.subtitle}</span></div><button type="button" aria-label="关闭图片预览" onClick={() => setPreview(null)}><Icon name="x" /></button></header><div className="flow-image-preview-stage"><img src={preview.url} alt={preview.title} /></div></section></div>}{toast && <div className="suite-toast show" role="status">{toast}</div>}</div>;
}
