import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BoardPage routes the suite workbench through the compose/gallery surface", async () => {
  const board = await readFile("src/pages/BoardPage.tsx", "utf8");
  const workbench = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(board, /return <WorkbenchBoardPage/);
  assert.match(workbench, /创作板/);
  assert.match(workbench, /成品展示板/);
  assert.doesNotMatch(workbench, /group:main|group:detail/);
});

test("every current base image is connected to every active task", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /const baseIds = currentBases\.map/);
  assert.match(source, /baseIds\.forEach\(\(sourceId\) => edges\.push/);
  assert.match(source, /styleId\}->\$\{id\}/);
});

test("task cards carry the global style prefix and generation parameters", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /styledPrompt\(task, styleGuide\)/);
  assert.match(source, /modelFor\(task\)/);
  assert.match(source, /ratioFor\(task\)/);
  assert.match(source, /sizeFor\(task\)/);
  assert.match(source, /qualityFor\(task\)/);
  assert.match(source, /version\?\.previewUrl/);
});

test("canvas labels use card metadata instead of main/detail group nodes", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /MAIN IMAGE/);
  assert.match(source, /DETAIL IMAGE/);
  assert.match(source, /wb-task-stats/);
  assert.match(source, /wb-card-footer/);
});

test("task selection prioritizes prompt details and the template library opens as a modal", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  const css = await readFile("public/assets/suite-workbench.css", "utf8");
  assert.match(source, /wb-inspector-prompt/);
  assert.match(source, /node\.data\.kind === "base"/);
  assert.match(source, /wb-prompt-modal-backdrop/);
  assert.match(css, /\.wb-prompt-modal-backdrop \{ position: fixed;/);
  assert.match(css, /\.wb-canvas \{[^}]*border: 1px solid/);
});

test("starting creation materializes plan items as task cards before navigation", async () => {
  const source = await readFile("src/pages/StartPage.tsx", "utf8");
  assert.match(source, /const readiness=await suiteApi\.startCreationCheck\(suite\.id\)/);
  assert.match(source, /await suiteApi\.createTasks\(suite\.id,readiness\.planSnapshotId\)/);
  assert.match(source, /createTasks[\s\S]*navigate\(`\/suites\/\$\{suite\.id\}\/board`\)/);
});

test("StartPage clears transient upload state when switching routes or suites", async () => {
  const source = await readFile("src/pages/StartPage.tsx", "utf8");
  assert.match(source, /setUploadProgress\(\[\]\)/);
  assert.match(source, /setCurrentId\(null\)/);
  assert.match(source, /setPreviewVersionIds\(\{\}\)/);
});

test("image loading wrappers preserve the fixed preview proportions", async () => {
  const css = await readFile("public/assets/suite-start.css", "utf8");
  assert.match(css, /\.start-image-card \.image-state \{ height: 220px; min-height: 220px; \}/);
  assert.match(css, /\.start-image-card \.image-state > img \{ height: 100%; min-height: 0; \}/);
  assert.match(css, /\.start-version-strip \.image-state \{ height: 58px; min-height: 58px; \}/);
});

test("thumbnail label styles do not capture ImageWithState wrappers", async () => {
  const css = await readFile("public/assets/suite-start.css", "utf8");
  assert.match(css, /\.start-thumbnail-select > span:last-child \{/);
  assert.doesNotMatch(css, /\.start-thumbnail-select span \{/);
  assert.match(css, /\.start-version-strip > button > span:last-child \{/);
  assert.doesNotMatch(css, /\.start-version-strip span \{/);
});

test("thumbnail strip reserves its row and never exposes a vertical scrollbar", async () => {
  const css = await readFile("public/assets/suite-start.css", "utf8");
  assert.match(css, /\.start-thumbnail-strip \{[^}]*min-height: 58px;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/);
});

test("planning and category prompt requests expose slow simulated progress", async () => {
  const source = await readFile("src/pages/StartPage.tsx", "utf8");
  const css = await readFile("public/assets/suite-start.css", "utf8");
  assert.match(source, /structureProgress/);
  assert.match(source, /categoryProgressById/);
  assert.match(source, /aria-label={`结构计划生成进度 \${structureProgress}%`}/);
  assert.match(source, /aria-label={`\${DETAIL_CATEGORY_NAMES\[request\.categoryCode\] \?\? request\.categoryCode}生成进度 \${progress}%`}/);
  assert.match(css, /\.start-simulated-progress/);
  assert.match(css, /\.start-row-progress/);
});

test("brief fields separate confirmed facts from visual direction guidance", async () => {
  const source = await readFile("src/pages/StartPage.tsx", "utf8");
  assert.match(source, /产品参数：\\n- 尺寸：125 × 65 × 40 mm/);
  assert.match(source, /不得虚构：\\n- DPI 数值/);
  assert.match(source, /填写已确认的产品参数、事实和必须展示的卖点/);
  assert.match(source, /设计方向：\\n- 整体风格：科技、轻量、年轻化/);
  assert.match(source, /禁止内容：\\n- 不改变产品外壳颜色/);
  assert.match(source, /产品参数请填写在上一个输入框/);
});

test("workbench canvas is constrained to the visible workspace", async () => {
  const css = await readFile("public/assets/suite-workbench.css", "utf8");
  assert.match(css, /\.wb-main \{[^}]*height: auto;[^}]*overflow: hidden;/);
  assert.match(css, /\.wb-canvas-panel \{[^}]*min-height: 0;[^}]*overflow: hidden;/);
  assert.match(css, /\.wb-canvas \{[^}]*overflow: hidden;/);
});

test("layout saves are serialized and advance the server version between requests", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /const layoutVersionRef = useRef\(0\)/);
  assert.match(source, /const layoutSaveQueue = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(source, /layoutSaveQueue\.current = layoutSaveQueue\.current\.catch/);
  assert.match(source, /layoutVersion: layoutVersionRef\.current/);
  assert.match(source, /layoutVersionRef\.current = saved\.layoutVersion/);
});

test("generated images open an editor with the seven V1 image-edit tools", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  const css = await readFile("public/assets/suite-workbench.css", "utf8");
  for (const label of ["添加文本", "改文字", "局部重绘", "消除笔", "扩图", "重新编辑", "再次生成"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /画面微调/);
  assert.doesNotMatch(source, /超清/);
  assert.match(source, /ImageEditorModal/);
  assert.match(source, /MaskStroke/);
  assert.match(source, /onMouseDown={startStroke}/);
  assert.match(source, /编辑提示词/);
  assert.match(source, /image-edit-v1/);
  assert.match(css, /\.wb-editor-backdrop \{ position: fixed;/);
  assert.match(css, /\.wb-editor-canvas svg \{ position:absolute;/);
});

test("compose cards expose image editing and use one coherent version selector", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  const css = await readFile("public/assets/suite-workbench.css", "utf8");
  assert.match(source, /wb-card-edit/);
  assert.match(source, /编辑图片/);
  assert.match(source, /wb-version-status/);
  assert.match(source, /设为当前/);
  assert.match(source, /已是终版/);
  assert.match(source, /选择\$\{task\.title\}版本/);
  assert.match(source, /editChildRunning/);
  assert.match(source, /生成结果/);
  assert.match(source, /来自任务卡/);
  assert.match(source, /wb-simulated-progress[\s\S]*scaleX/);
  assert.match(css, /\.wb-card-version-actions/);
  assert.match(css, /\.wb-version-status/);
});

test("image editor uses the selected version prompt and operation-specific prompt fields", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /versionGenerationPrompt/);
  assert.match(source, /version\.promptSnapshot/);
  assert.match(source, /添加文字要求/);
  assert.match(source, /替换要求/);
  assert.match(source, /重绘要求/);
  assert.match(source, /清除要求/);
  assert.doesNotMatch(source, /fontFamily|textColor|textEffect/);
});

test("text regions use a dashed Konva transformer and the overlay follows the rendered image frame", async () => {
  const source = await readFile("src/pages/WorkbenchBoardPage.tsx", "utf8");
  assert.match(source, /Transformer/);
  assert.match(source, /borderDash/);
  assert.match(source, /textOperations\.map/);
  assert.match(source, /onClick=\{\(\) => selectOperation\(item\)\}/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /Stage width=\{frame\.width\} height=\{frame\.height\}/);
  assert.match(source, /maskMode/);
  assert.match(source, /擦除选区/);
  assert.match(source, /KonvaCircle/);
});

test("image editor fills the viewport without clipping its fixed action footer", async () => {
  const css = await readFile("public/assets/suite-workbench.css", "utf8");
  assert.match(css, /\.wb-editor-modal \{[^}]*height: calc\(100dvh - 24px\);[^}]*grid-template-rows: auto minmax\(0,1fr\);/);
  assert.match(css, /\.wb-editor-body \{[^}]*min-height:0;[^}]*overflow:hidden;/);
  assert.match(css, /\.wb-editor-tools, \.wb-editor-options \{[^}]*overflow-y:auto;/);
  assert.match(css, /\.wb-editor-footer \{[^}]*position:sticky;/);
});
