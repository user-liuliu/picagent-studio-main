const templates = {
  main: [
    ['main-white', '白底商品主图', '保持产品真实外观，突出清晰轮廓与商品主体。'],
    ['main-scene', '场景主图', '提炼场景关系、主体占比与商业光影。'],
    ['main-selling', '卖点信息主图', '还原卖点信息层级、标签和局部展示结构。'],
    ['main-promo', '促销活动主图', '提炼活动信息、价格区和直接转化结构。']
  ],
  detail: [
    ['detail-hero', '首屏 / 品牌表达', '提炼首屏气质、品牌表达和大标题留白。'],
    ['detail-selling', '核心卖点', '提炼卖点表达、信息层级和产品聚焦关系。'],
    ['detail-scene', '生活场景', '提炼生活方式场景、使用关系和空间层次。'],
    ['detail-close', '细节特写', '提炼材质、局部结构和微距展示方式。'],
    ['detail-spec', '尺寸规格', '提炼尺寸标注、参数区和辅助线关系。'],
    ['detail-trust', '促销 / 信任背书', '提炼权益、认证和信任信息的排版结构。']
  ]
};

const sampleImages = [
  { id: 'ref-1', name: '爆品参考图-01.jpg', src: 'assets/gan65-product-tight.jpg', template: 'main-white', status: '待反推', prompt: '' },
  { id: 'ref-2', name: '爆品参考图-02.jpg', src: 'assets/tokyo-desk-v3.jpg', template: 'main-scene', status: '待反推', prompt: '' },
  { id: 'ref-3', name: '爆品参考图-03.jpg', src: 'assets/gan65-product.jpg', template: 'main-selling', status: '待反推', prompt: '' },
  { id: 'ref-4', name: '爆品参考图-04.jpg', src: 'assets/gan65-product-tight.jpg', template: 'main-promo', status: '待反推', prompt: '' }
];

const state = { mode: 'main', images: sampleImages, selectedId: 'ref-1', baselineId: 'ref-1' };
const els = {
  tabs: [...document.querySelectorAll('[data-mode]')],
  grid: document.querySelector('[data-image-grid]'),
  fileInput: document.querySelector('[data-file-input]'),
  dropzone: document.querySelector('[data-dropzone]'),
  modeNote: document.querySelector('[data-mode-note]'),
  modeTitle: document.querySelector('[data-mode-title]'),
  counter: document.querySelector('[data-counter]'),
  inspector: document.querySelector('[data-inspector]'),
  toast: document.querySelector('[data-toast]'),
  reverseAll: document.querySelector('[data-reverse-all]'),
  saveAll: document.querySelector('[data-save-all]'),
  enterCanvas: [...document.querySelectorAll('[data-enter-canvas]')]
};

function modeTemplates() { return templates[state.mode]; }
function templateName(id) { return modeTemplates().find(([key]) => key === id)?.[1] || '请选择模板'; }
function templateDescription(id) { return modeTemplates().find(([key]) => key === id)?.[2] || ''; }
function promptFor(image) {
  const family = state.mode === 'detail' ? '详情页单屏商业视觉' : '电商主图商业视觉';
  const colorLine = state.mode === 'detail' ? '与本组首张详情图保持统一色彩秩序，但不带入其他图片的场景和道具。' : '保持参考画面自身的色彩秩序，不引入其他图片的非色彩元素。';
  return `以上传的产品图作为唯一产品外观参考，严格保持产品真实品类、轮廓、比例、结构、颜色、材质、包装和可见细节不变。生成一张${family}，提炼“${templateName(image.template)}”所对应的构图骨架、主体位置、空间层次、材质表现、商业光影和信息排版逻辑。${colorLine}画面中的主体应保持清晰、完整、比例自然，留出适合标题和卖点信息的安全区域。文字只使用后续确认的真实文案，不新增未经确认的品牌、参数、功效或促销信息；必须避免产品结构漂移、标签变形、额外商品和无关装饰。${templateDescription(image.template)}输出为可直接用于后续生图的中文提示词。`;
}

function render() {
  els.tabs.forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  els.modeTitle.textContent = state.mode === 'main' ? '主图反推' : '详情图反推';
  els.modeNote.textContent = state.mode === 'main'
    ? '每张参考主图独立提炼版式、信息层级和商业转化结构。'
    : '每张详情图独立处理；默认以第 1 张图建立系列色彩基准。';
  els.counter.innerHTML = `<strong>${state.images.length}</strong> 张参考图 · <strong>${state.images.filter((image) => image.status === '已生成').length}</strong> 条提示词`;
  els.grid.innerHTML = state.images.map((image, index) => `
    <article class="reverse-image-card ${image.id === state.selectedId ? 'selected' : ''}" data-card-id="${image.id}" draggable="true">
      <div class="reverse-image-top"><img src="${image.src}" alt="${image.name}"><span class="reverse-image-index">${index + 1}</span><button class="reverse-image-drag" type="button" data-drag-handle="${image.id}" aria-label="拖拽调整顺序" title="拖拽调整顺序"><svg><use href="assets/icons.svg#move"></use></svg></button><button class="reverse-image-remove" type="button" data-remove="${image.id}" aria-label="删除${image.name}">×</button></div>
      <div class="reverse-image-meta">
        <div class="reverse-image-name" title="${image.name}">${image.name}</div>
        <div class="reverse-image-sub">上传参考图 · ${state.mode === 'detail' && index === 0 ? '系列色彩基准' : '独立处理'}</div>
        ${state.mode === 'detail' ? `<label class="reverse-baseline"><input type="radio" name="reverse-baseline" value="${image.id}" data-baseline ${image.id === state.baselineId ? 'checked' : ''}>系列色彩基准</label>` : ''}
        <div class="reverse-template"><label for="template-${image.id}">反推模板</label><select id="template-${image.id}" data-template="${image.id}">${modeTemplates().map(([key, label]) => `<option value="${key}" ${key === image.template ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="reverse-card-status"><b class="${image.status === '已生成' ? 'done' : ''}">${image.status}</b><button class="reverse-card-open" type="button" data-open="${image.id}">${image.status === '已生成' ? '查看提示词' : '选中编辑'}</button></div>
      </div>
    </article>`).join('');
  renderInspector();
}

function renderInspector() {
  const image = state.images.find((item) => item.id === state.selectedId);
  if (!image) {
    els.inspector.innerHTML = '<div class="reverse-inspector-empty">上传参考图并选择一张图片，<br>这里会显示对应的反推提示词。</div>';
    return;
  }
  const value = image.prompt || promptFor(image);
  els.inspector.innerHTML = `
    <div class="reverse-inspector-info"><div class="reverse-inspector-thumb"><img src="${image.src}" alt="${image.name}"></div><div><strong>参考图 ${state.images.indexOf(image) + 1}</strong><span>${image.name}</span></div></div>
    <label class="reverse-field"><span>当前模板</span><select data-inspector-template>${modeTemplates().map(([key, label]) => `<option value="${key}" ${key === image.template ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="reverse-field"><span>反推出的提示词</span><textarea data-prompt spellcheck="false">${value}</textarea></label>
    <div class="reverse-inspector-actions"><button class="reverse-btn" type="button" data-save-prompt>保存提示词</button><button class="reverse-btn primary" type="button" data-reverse-one>重新反推</button><button class="reverse-btn quiet wide" type="button" data-copy-prompt>复制提示词</button></div>
    <div class="reverse-source-note"><strong>来源</strong>提示词来自当前参考图和“${templateName(image.template)}”模板。后续进入共享画布时，可从图片资源库选择产品白底图。</div>`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function reverseImage(image) {
  image.prompt = promptFor(image);
  image.status = '已生成';
}

els.tabs.forEach((tab) => tab.addEventListener('click', () => {
  state.mode = tab.dataset.mode;
  state.baselineId = state.images[0]?.id || null;
  state.images.forEach((image) => {
    image.template = modeTemplates()[0][0];
    image.status = '待反推';
    image.prompt = '';
  });
  render();
}));

els.grid.addEventListener('click', (event) => {
  const open = event.target.closest('[data-open], [data-card-id]');
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    state.images = state.images.filter((image) => image.id !== remove.dataset.remove);
    if (state.selectedId === remove.dataset.remove) state.selectedId = state.images[0]?.id || null;
    render();
    toast('已移除参考图');
    return;
  }
  if (open) {
    const cardId = open.dataset.open || open.dataset.cardId;
    if (cardId) state.selectedId = cardId;
    render();
  }
});

let draggedId = null;
els.grid.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-card-id]');
  if (!card) return;
  draggedId = card.dataset.cardId;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});
els.grid.addEventListener('dragover', (event) => {
  const card = event.target.closest('[data-card-id]');
  if (!card || card.dataset.cardId === draggedId) return;
  event.preventDefault();
  card.classList.add('dragover');
});
els.grid.addEventListener('dragleave', (event) => event.target.closest('[data-card-id]')?.classList.remove('dragover'));
els.grid.addEventListener('drop', (event) => {
  const target = event.target.closest('[data-card-id]');
  if (!target || !draggedId || target.dataset.cardId === draggedId) return;
  event.preventDefault();
  const from = state.images.findIndex((image) => image.id === draggedId);
  const to = state.images.findIndex((image) => image.id === target.dataset.cardId);
  const [moved] = state.images.splice(from, 1);
  state.images.splice(to, 0, moved);
  draggedId = null;
  render();
  toast('已调整参考图顺序');
});
els.grid.addEventListener('dragend', () => { draggedId = null; render(); });

els.grid.addEventListener('change', (event) => {
  const baseline = event.target.closest('[data-baseline]');
  if (baseline) {
    state.baselineId = baseline.value;
    render();
    toast('已更新系列色彩基准');
    return;
  }
  const select = event.target.closest('[data-template]');
  if (!select) return;
  const image = state.images.find((item) => item.id === select.dataset.template);
  if (!image) return;
  image.template = select.value;
  image.status = '待反推';
  image.prompt = '';
  state.selectedId = image.id;
  render();
});

els.inspector.addEventListener('change', (event) => {
  if (!event.target.matches('[data-inspector-template]')) return;
  const image = state.images.find((item) => item.id === state.selectedId);
  if (!image) return;
  image.template = event.target.value;
  image.prompt = '';
  image.status = '待反推';
  render();
});

els.inspector.addEventListener('click', async (event) => {
  const image = state.images.find((item) => item.id === state.selectedId);
  if (!image) return;
  if (event.target.closest('[data-save-prompt]')) {
    image.prompt = els.inspector.querySelector('[data-prompt]').value;
    image.status = '已生成';
    render();
    toast('提示词已保存');
  }
  if (event.target.closest('[data-reverse-one]')) {
    reverseImage(image);
    render();
    toast('已完成单张反推');
  }
  if (event.target.closest('[data-copy-prompt]')) {
    await navigator.clipboard?.writeText(els.inspector.querySelector('[data-prompt]').value);
    toast('提示词已复制');
  }
});

els.reverseAll.addEventListener('click', () => {
  state.images.forEach(reverseImage);
  render();
  toast(`已完成 ${state.images.length} 张图片的提示词反推`);
});

els.saveAll.addEventListener('click', () => toast('已保存到当前方案快照'));
els.enterCanvas.forEach((button) => button.addEventListener('click', () => {
  const count = state.images.filter((image) => image.status === '已生成').length;
  if (!count) return toast('请先生成至少一条提示词');
  toast(`将 ${count} 条提示词带入共享 XYFlow 画布`);
}));

function addFiles(files) {
  [...files].slice(0, Math.max(0, 16 - state.images.length)).forEach((file, offset) => {
    const url = URL.createObjectURL(file);
    state.images.push({ id: `upload-${Date.now()}-${offset}`, name: file.name, src: url, template: modeTemplates()[0][0], status: '待反推', prompt: '' });
  });
  render();
  toast('参考图已加入列表');
}

els.fileInput.addEventListener('change', (event) => addFiles(event.target.files));
els.dropzone.addEventListener('dragover', (event) => { event.preventDefault(); els.dropzone.classList.add('dragover'); });
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', (event) => { event.preventDefault(); els.dropzone.classList.remove('dragover'); addFiles(event.dataTransfer.files); });

render();
