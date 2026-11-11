(function () {
  const cards = [
    { id: "card-1", title: "品牌首图", type: "主图 01", prompt: "保留 GAN65-BK 产品真实外观与接口结构，白色纯净背景，产品居中偏下构图，突出 65W 三口快充卖点，商业电商摄影，柔和棚拍光线，无额外文字。", image: "assets/gan65-product-tight.jpg", ratio: "1:1", size: "1K", model: "三万蕉 2", template: "全平台主图 · v2" },
    { id: "card-2", title: "使用场景图", type: "主图 02", prompt: "以 GAN65-BK 为画面主体，放置在整洁的办公桌面，笔记本电脑、平板与手机同时充电，真实比例，浅灰背景，明亮自然光，保留产品颜色、轮廓和接口，不添加虚构品牌。", image: "assets/tokyo-desk-v3.jpg", ratio: "4:3", size: "1K", model: "三万蕉 2", template: "全平台主图 · v2" },
    { id: "card-3", title: "核心卖点图", type: "主图 03", prompt: "产品主体保持真实，使用简洁的三分构图展示多设备快充关系，画面留出中文卖点安全区，光影干净，商业产品摄影，禁止改变产品结构与 Logo。", image: "assets/gan65-product.jpg", ratio: "1:1", size: "1K", model: "三万蕉 2", template: "全平台主图 · v2" },
    { id: "card-4", title: "参数说明图", type: "主图 04", prompt: "以 GAN65-BK 产品为中心的参数说明场景，展示 USB-C x2、USB-A x1 和 65W 信息区域，排版克制，产品比例准确，背景留白，禁止编造产品参数。", image: "assets/gan65-product-tight.jpg", ratio: "1:1", size: "1K", model: "三万蕉 2", template: "全平台主图 · v2" },
  ];
  const promptCards = [
    { id: "clean", title: "产品白底图精修", tags: ["白底", "系统预置"], text: "保留产品真实外观、颜色、材质、品牌标识和关键结构，清理杂乱背景并生成干净白底商品图。", body: "请基于上传的商品源图进行产品白底图精修：保持产品主体、外形、颜色、材质、品牌标识和关键文字一致；清理杂乱背景并生成纯白背景商品图，边缘自然，不添加虚构内容。" },
    { id: "main", title: "主图卖点强化", tags: ["主图", "卖点"], text: "突出一个核心卖点，保留产品真实结构，适用于电商主图首屏和卖点图。", body: "基于产品白底图生成电商主图：保持产品外观与品牌标识真实，围绕一个核心卖点组织画面，构图清晰，主体突出，保留文字安全区。" },
    { id: "detail", title: "详情页整套规划", tags: ["详情页", "套图"], text: "生成有顺序的详情页图片计划，覆盖场景、卖点、参数和购买理由。", body: "生成一套详情页图片计划：按首图、场景、核心卖点、细节参数、购买理由的顺序组织，每张图片输出独立的中文生图提示词，不编造产品信息。" },
    { id: "style", title: "极简商业摄影风格", tags: ["风格", "我的"], text: "克制留白、柔和棚拍光线、清晰产品轮廓，适合高端电商产品。", body: "采用极简商业摄影风格：克制留白、柔和棚拍光线、干净背景、清晰产品轮廓、低干扰构图，保持真实产品比例和细节。" },
  ];
  const styles = [
    { title: "极简商业摄影", text: "柔和棚拍光线、克制留白、清晰产品轮廓。", tags: ["电商", "通用"] },
    { title: "环保自然叙事", text: "自然材质、柔和日光、可持续生活方式场景。", tags: ["环保", "场景"] },
    { title: "科技精密感", text: "冷静中性背景、细节光、理性构图和参数秩序。", tags: ["3C", "卖点"] },
  ];

  const grid = document.querySelector("[data-card-grid]");
  const canvasMeta = document.querySelector(".suite-canvas-toolbar span");
  const workspace = document.querySelector("[data-workspace]");
  const canvas = document.querySelector("[data-canvas]");
  const creationRail = document.querySelector("[data-creation-rail]");
  const dialog = document.querySelector("[data-card-dialog]");
  const previewDialog = document.querySelector("[data-preview-dialog]");
  const previewImage = document.querySelector("[data-preview-image]");
  const previewTitle = document.querySelector("[data-preview-title]");
  const previewSubtitle = document.querySelector("[data-preview-subtitle]");
  const deleteDialog = document.querySelector("[data-delete-dialog]");
  const libraryDialog = document.querySelector("[data-library]");
  const dialogBody = document.querySelector("[data-dialog-body]");
  const dialogTitle = document.querySelector("[data-dialog-title]");
  const dialogSubtitle = document.querySelector("[data-dialog-subtitle]");
  const promptList = document.querySelector("[data-prompt-list]");
  const styleList = document.querySelector("[data-style-list]");
  const toast = document.querySelector("[data-toast]");
  const creativePrompt = document.querySelector("[data-creative-prompt]");
  let selectedId = null;
  let draft = null;
  let currentMode = "compose";
  let promptFilter = "全部";
  let styleFilter = "全部";
  let activeLibraryTab = "prompts";
  let zoom = 100;
  let toastTimer = null;

  function escapeHtml(value) { return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]); }
  function notify(message) { toast.textContent = message; toast.classList.add("show"); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200); }

  function renderCards() {
    canvasMeta.textContent = `${cards.length} 张图片 · 1:1 · 1024 × 1024`;
    grid.innerHTML = cards.map((card, index) => `
      <article class="suite-card" data-card-id="${card.id}">
        ${currentMode === "compose" ? `<button class="suite-card-edit" type="button" data-edit-card="${card.id}" aria-label="编辑${escapeHtml(card.title)}" title="编辑卡片"><svg><use href="assets/icons.svg#editor"></use></svg></button>` : ""}
        <button class="suite-card-media suite-card-preview" type="button" data-preview-card="${card.id}" aria-label="放大预览${escapeHtml(card.title)}"><img src="${card.image}" alt="${escapeHtml(card.title)}候选图"><span class="suite-card-state ${card.status === "generating" ? "generating" : ""}">${card.status === "generating" ? "生成中" : "GENERATED"}</span></button>
        <div class="suite-card-info"><strong>${escapeHtml(card.title)}<span class="suite-card-index">${String(index + 1).padStart(2, "0")}</span></strong><span>${card.type} · ${card.ratio} · ${card.model}</span></div>
      </article>`).join("");
  }

  function openPreview(id) {
    const card = cards.find((item) => item.id === id); if (!card) return;
    previewImage.src = card.image;
    previewImage.alt = `${card.title}预览`;
    previewTitle.textContent = card.title;
    previewSubtitle.textContent = `${card.type} · ${card.ratio} · ${card.model}`;
    previewDialog.showModal();
  }

  function updateZoom(nextZoom) {
    zoom = Math.max(50, Math.min(150, nextZoom));
    document.querySelector("[data-zoom-value]").textContent = `${zoom}%`;
    canvas.style.setProperty("--canvas-zoom", `${zoom / 100}`);
  }

  function setMode(mode) {
    currentMode = mode;
    workspace.classList.toggle("compose-mode", mode === "compose");
    workspace.classList.toggle("gallery-mode", mode === "gallery");
    canvas.classList.toggle("compose-canvas", mode === "compose");
    canvas.classList.toggle("gallery-canvas", mode === "gallery");
    creationRail.hidden = mode === "gallery";
    document.querySelectorAll("[data-mode]").forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
    document.querySelector(".suite-heading h1").textContent = mode === "compose" ? "创作板" : "成品展示板";
    document.querySelector(".suite-heading p:not(.suite-eyebrow)").textContent = mode === "compose" ? "调整当前提示词和生成参数，创建新的套图结果。" : "浏览已生成的图片卡片，点击图片可放大预览。";
    renderCards();
  }

  function setLibraryTab(tab) {
    activeLibraryTab = tab;
    document.querySelectorAll("[data-library-tab]").forEach((button) => {
      const active = button.dataset.libraryTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const promptTools = document.querySelector("[data-prompt-tools]");
    const styleTools = document.querySelector("[data-style-tools]");
    promptTools.hidden = tab !== "prompts";
    styleTools.hidden = tab !== "styles";
    promptList.hidden = tab !== "prompts";
    styleList.hidden = tab !== "styles";
    if (tab === "prompts") renderPromptCards();
    else renderStyles();
  }

  function renderPromptCards() {
    const query = (document.querySelector("[data-prompt-search]")?.value || "").trim().toLowerCase();
    const list = promptCards.filter((item) => (promptFilter === "全部" || item.tags.includes(promptFilter)) && (!query || `${item.title}${item.text}${item.tags.join("")}`.toLowerCase().includes(query)));
    promptList.innerHTML = list.length ? list.map((item) => `<article class="suite-prompt-item"><div class="suite-prompt-item-head"><div><strong>${item.title}</strong><p>${item.text}</p><small>${item.tags.join(" · ")}</small></div><button type="button" data-insert-prompt="${item.id}">插入</button></div></article>`).join("") : `<p class="suite-empty-library">没有匹配的提示词卡。</p>`;
  }
  function renderStyles() {
    const query = (document.querySelector("[data-style-search]")?.value || "").trim().toLowerCase();
    const list = styles.filter((item) => (styleFilter === "全部" || item.tags.includes(styleFilter)) && (!query || `${item.title}${item.text}${item.tags.join("")}`.toLowerCase().includes(query)));
    styleList.innerHTML = list.length ? list.map((item) => `<article class="suite-prompt-item"><div class="suite-prompt-item-head"><div><strong>${item.title}</strong><p>${item.text}</p><small>${item.tags.join(" · ")}</small></div><button type="button" data-apply-style="${item.title}">应用</button></div></article>`).join("") : `<p class="suite-empty-library">没有匹配的风格。</p>`;
  }

  function openEditor(id) {
    const card = cards.find((item) => item.id === id); if (!card) return;
    selectedId = id; draft = { ...card }; dialogTitle.textContent = card.title; dialogSubtitle.textContent = `${card.type} · 卡片 ${cards.findIndex((item) => item.id === id) + 1} / ${cards.length}`;
    dialogBody.innerHTML = `<section><span class="suite-section-label">图片素材</span><div class="suite-dialog-assets"><img src="${card.image}" alt="${card.title}当前图片"><div><strong>精修白底图 · 1 张</strong><span>同时引用原始实拍图作为商品保真依据</span></div></div></section><div class="suite-dialog-fields"><label class="suite-field"><span>卡片标题</span><input data-draft-title value="${escapeHtml(card.title)}"></label><label class="suite-field"><span>生图模板</span><select data-draft-template><option ${card.template === "全平台主图 · v2" ? "selected" : ""}>全平台主图 · v2</option><option ${card.template === "全平台详情页 · v1" ? "selected" : ""}>全平台详情页 · v1</option><option ${card.template === "美食类主图 · v1" ? "selected" : ""}>美食类主图 · v1</option></select></label></div><label class="suite-field" style="margin-top:18px"><span>提示词</span><textarea data-draft-prompt>${escapeHtml(card.prompt)}</textarea></label><div class="suite-dialog-params"><label class="suite-field"><span>模型</span><select data-draft-model><option ${card.model === "三万蕉 2" ? "selected" : ""}>三万蕉 2</option><option ${card.model === "Gemini Image" ? "selected" : ""}>Gemini Image</option></select></label><label class="suite-field"><span>比例</span><select data-draft-ratio><option ${card.ratio === "1:1" ? "selected" : ""}>1:1</option><option ${card.ratio === "4:3" ? "selected" : ""}>4:3</option><option ${card.ratio === "3:4" ? "selected" : ""}>3:4</option></select></label><label class="suite-field"><span>尺寸</span><select data-draft-size><option ${card.size === "1K" ? "selected" : ""}>1K</option><option ${card.size === "2K" ? "selected" : ""}>2K</option></select></label></div>`;
    dialog.showModal();
  }
  function closeEditor() { dialog.close(); selectedId = null; draft = null; }
  function syncDraft() { if (!draft) return; draft.title = dialogBody.querySelector("[data-draft-title]").value.trim() || draft.title; draft.prompt = dialogBody.querySelector("[data-draft-prompt]").value.trim(); draft.template = dialogBody.querySelector("[data-draft-template]").value; draft.ratio = dialogBody.querySelector("[data-draft-ratio]").value; draft.size = dialogBody.querySelector("[data-draft-size]").value; draft.model = dialogBody.querySelector("[data-draft-model]").value; }
  function saveCard() { syncDraft(); const index = cards.findIndex((item) => item.id === selectedId); if (index < 0) return; cards[index] = { ...cards[index], ...draft }; renderCards(); closeEditor(); notify("已保存卡片修改"); }
  function regenerate() { syncDraft(); const card = cards.find((item) => item.id === selectedId); if (!card) return; Object.assign(card, draft, { status: "generating" }); renderCards(); closeEditor(); notify("已提交单卡重新生成"); window.setTimeout(() => { card.status = "generated"; renderCards(); notify("卡片已生成新结果"); }, 1800); }
  function deleteCard() { const index = cards.findIndex((item) => item.id === selectedId); if (index < 0) return; cards.splice(index, 1); deleteDialog.close(); closeEditor(); renderCards(); notify("已删除卡片"); }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-mode], [data-edit-card], [data-preview-card], [data-save], [data-cancel], [data-close-dialog], [data-close-preview], [data-regenerate], [data-delete], [data-confirm-delete], [data-canvas-action], [data-open-library], [data-close-library], [data-library-tab], [data-insert-prompt], [data-apply-style], [data-create], [data-add-asset], [data-prompt-filter], [data-style-filter]");
    if (!target) return;
    if (target.matches("[data-mode]")) setMode(target.dataset.mode);
    if (target.matches("[data-edit-card]")) openEditor(target.dataset.editCard);
    if (target.matches("[data-preview-card]")) openPreview(target.dataset.previewCard);
    if (target.matches("[data-save]")) saveCard();
    if (target.matches("[data-cancel], [data-close-dialog]")) closeEditor();
    if (target.matches("[data-regenerate]")) { if (selectedId) regenerate(); }
    if (target.matches("[data-delete]")) deleteDialog.showModal();
    if (target.matches("[data-confirm-delete]")) deleteCard();
    if (target.matches("[data-close-preview]")) previewDialog.close();
    if (target.matches("[data-canvas-action]")) {
      const action = target.dataset.canvasAction;
      if (action === "zoom-in") updateZoom(zoom + 10);
      if (action === "zoom-out") updateZoom(zoom - 10);
      if (action === "fit") { updateZoom(100); notify("画布已适应当前视图"); }
      if (action === "download") notify("原型阶段：下载入口已预留");
      if (action === "undo") notify("原型阶段：已撤销最近一次画布操作");
      if (action === "redo") notify("原型阶段：已重做最近一次画布操作");
    }
    if (target.matches("[data-open-library]")) { setLibraryTab(activeLibraryTab); libraryDialog.showModal(); }
    if (target.matches("[data-close-library]")) libraryDialog.close();
    if (target.matches("[data-library-tab]")) setLibraryTab(target.dataset.libraryTab);
    if (target.matches("[data-prompt-filter]")) { promptFilter = target.dataset.promptFilter; document.querySelectorAll("[data-prompt-filter]").forEach((button) => button.classList.toggle("active", button === target)); renderPromptCards(); }
    if (target.matches("[data-insert-prompt]")) { const item = promptCards.find((prompt) => prompt.id === target.dataset.insertPrompt); if (item) { creativePrompt.value = item.body; libraryDialog.close(); notify(`已插入“${item.title}”模板`); } }
    if (target.matches("[data-style-filter]")) { styleFilter = target.dataset.styleFilter; document.querySelectorAll("[data-style-filter]").forEach((button) => button.classList.toggle("active", button === target)); renderStyles(); }
    if (target.matches("[data-apply-style]")) { creativePrompt.value = `${creativePrompt.value}\n\n视觉风格：${target.dataset.applyStyle}。`; libraryDialog.close(); notify(`已应用“${target.dataset.applyStyle}”风格`); }
    if (target.matches("[data-create]")) { const card = cards[0]; if (card) { card.status = "generating"; renderCards(); notify("已提交套图生成"); window.setTimeout(() => { card.status = "generated"; renderCards(); notify("套图生成完成"); }, 1800); } }
    if (target.matches("[data-add-asset]")) notify("原型阶段：参考图上传入口已预留");
  });
  document.querySelector("[data-prompt-search]")?.addEventListener("input", renderPromptCards);
  document.querySelector("[data-style-search]")?.addEventListener("input", renderStyles);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeEditor(); });
  previewDialog.addEventListener("click", (event) => { if (event.target === previewDialog) previewDialog.close(); });
  libraryDialog.addEventListener("click", (event) => { if (event.target === libraryDialog) libraryDialog.close(); });
  updateZoom(100); setMode("compose");
})();
