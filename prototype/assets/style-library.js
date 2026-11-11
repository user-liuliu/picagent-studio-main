(() => {
  const imageResources = [
    { id:'asset-original-001', type:'original', label:'商品实拍原图', title:'充电宝商品实拍原图', summary:'商品主体、铭牌信息和真实外观的原始依据。', image:'../素材/实拍图/充电宝.jpg', file:'充电宝.jpg', tags:['商品实拍原图','3C 数码','通用'], version:'V1 · 2026-08-23', refs:'12 次', usage:'可作为白底精修、计划生成和单卡生图的输入依据。', badge:'SOURCE', prompt:null, promptTemplate:null },
    { id:'asset-original-002', type:'original', label:'商品实拍原图', title:'耳机商品正面实拍', summary:'耳机外观、仓体比例和接口细节的实拍记录。', image:'../素材/实拍图/耳机1.jpg', file:'耳机1.jpg', tags:['商品实拍原图','耳机','细节核对'], version:'V1 · 2026-08-22', refs:'7 次', usage:'用于计划生成前的结构核验。', badge:'SOURCE', prompt:null, promptTemplate:null },
    { id:'asset-original-003', type:'original', label:'商品实拍原图', title:'橙色鼠标商品实拍', summary:'鼠标轮廓、颜色和按键关系的原始参考。', image:'../素材/实拍图/鼠标1.jpg', file:'鼠标1.jpg', tags:['商品实拍原图','鼠标','场景参考'], version:'V1 · 2026-08-20', refs:'3 次', usage:'用于详情页组合关系和使用场景规划。', badge:'SOURCE', prompt:null, promptTemplate:null },
    { id:'asset-base-001', type:'base', label:'白底底图', title:'购物车精修白底底图', summary:'来自素材库的白底商品图，适合作为干净商品基线。', image:'../素材/白底图/购物车.jpg', file:'购物车.jpg', tags:['白底底图','素材库','已选当前'], version:'V1 · 2026-08-23', refs:'18 次', usage:'作为套图任务的默认商品输入。', badge:'BASE V1', prompt:'基于商品实拍原图生成干净白底商品图：保持商品外观、结构、材质、颜色和可见文字真实一致；清理环境干扰，保留自然边缘和适度真实阴影；不得添加或修改商品信息。', promptTemplate:'通用白底精修 · v2' },
    { id:'asset-base-002', type:'base', label:'白底底图', title:'GAN65-BK 精修白底底图', summary:'工作台已有白底图版本，用于结果对比和回溯。', image:'assets/gan65-product.jpg', file:'gan65-base-v2.png', tags:['白底底图','V2','历史'], version:'V2 · 2026-08-21', refs:'9 次', usage:'只读历史版本，不覆盖当前底图。', badge:'BASE V2', prompt:'保持 GAN65-BK 产品真实外观、颜色、接口和比例，清除背景干扰，输出干净白底商品图。不得虚构参数、品牌或结构。', promptTemplate:'通用白底精修 · v2' },
    { id:'asset-generated-001', type:'generated', label:'AI 生成结果', title:'日本站办公桌使用场景', summary:'展示笔记本、平板与手机同时补能的使用场景。', image:'assets/tokyo-desk-v3.jpg', file:'task-02-version-03.png', tags:['AI 生成结果','主图 02','Amazon'], version:'V3 · 2026-08-23', refs:'5 次', usage:'可作为场景参考，不替代当前任务的终版选择。', badge:'AI V3', prompt:'以真实商品为主体放置在整洁的办公桌面，笔记本电脑、平板和手机形成自然同时补能关系；保留商品真实比例、接口和颜色，光线明亮克制，画面不添加未经证实的文字或品牌。', promptTemplate:'3C 数码类主图与详情页 · v2' },
    { id:'asset-generated-002', type:'generated', label:'AI 生成结果', title:'三口快充卖点构图', summary:'以商品主体为中心组织卖点关系，保留产品接口。', image:'assets/gan65-product.jpg', file:'task-03-version-02.png', tags:['AI 生成结果','主图 03','卖点'], version:'V2 · 2026-08-22', refs:'4 次', usage:'可加入新的计划请求作为构图参考。', badge:'AI V2', prompt:'以商品主体为中心的商业产品摄影构图，清楚展示三口接口和多设备快充关系；主体完整、比例准确、留白充足，禁止改变接口结构或编造功率参数。', promptTemplate:'全平台主图详情页通用 · v3' },
    { id:'asset-generated-003', type:'generated', label:'AI 生成结果', title:'旅行收纳场景候选', summary:'差旅环境中的轻量化使用关系候选图。', image:'assets/tokyo-desk-v3.jpg', file:'task-05-version-01.png', tags:['AI 生成结果','详情页','场景'], version:'V1 · 2026-08-21', refs:'2 次', usage:'适合详情页场景方向参考。', badge:'AI V1', prompt:'将真实商品置于简洁的差旅收纳场景中，加入行李、桌面和移动办公关系，但不要遮挡商品；保持真实材质、比例和颜色，使用自然光，不加入虚构功能。', promptTemplate:'全平台主图详情页通用 · v3' },
    { id:'asset-process-001', type:'process', label:'过程图', title:'白底精修过程预览', summary:'展示精修阶段的边缘处理和背景清理结果。', image:'../素材/白底图/购物车.jpg', file:'base-process-step-02.png', tags:['过程图','白底精修','只读'], version:'V2 · 2026-08-23', refs:'1 次', usage:'只用于审查过程，不作为最终生图输入。', badge:'PROCESS', prompt:'检查白底精修过程：商品边缘自然，主体无缺失，背景无杂物，材质和颜色与实拍图一致。', promptTemplate:'通用白底精修 · v2' },
    { id:'asset-process-002', type:'process', label:'过程图', title:'套图生成过程预览', summary:'记录单卡生成中的中间结果和调整方向。', image:'../素材/实拍图/充电宝2.jpg', file:'task-process-step-03.png', tags:['过程图','单卡任务','只读'], version:'V1 · 2026-08-22', refs:'1 次', usage:'用于版本对比和问题定位。', badge:'PROCESS', prompt:'保留商品真实外观，修正场景中的主体比例和遮挡关系，减少无关装饰，确保画面职责清晰。', promptTemplate:'单卡生图与修订 · v1' },
    { id:'asset-final-001', type:'final', label:'终版图', title:'Amazon 日本站主图终版', summary:'已选为当前方案终版的商品场景图。', image:'assets/tokyo-desk-v3.jpg', file:'final-amazon-jp-main-02.png', tags:['终版图','Amazon 日本','已确认'], version:'V3 · 2026-08-23', refs:'6 次', usage:'可作为历史项目的可追溯终版资产。', badge:'FINAL', prompt:'商品主体清晰、真实、完整，按 Amazon 日本站首图与主图组策略组织画面；保持真实比例和颜色，场景服务于购买理解，不添加虚构参数、促销贴片或无依据文字。', promptTemplate:'3C 数码类主图与详情页 · v2' },
    { id:'asset-final-002', type:'final', label:'终版图', title:'购物车平台首图终版', summary:'平台首图使用的白底商品图，当前版本已确认。', image:'../素材/白底图/购物车.jpg', file:'final-platform-main-01.jpg', tags:['终版图','平台首图','已确认'], version:'V1 · 2026-08-23', refs:'8 次', usage:'作为已完成项目的终版归档。', badge:'FINAL', prompt:'以购物车商品为唯一主体，使用干净白底和自然阴影，商品轮廓完整清晰，适合作为平台首图；禁止添加促销文字、虚构品牌或额外商品。', promptTemplate:'通用白底精修 · v2' },
    { id:'asset-reverse-001', type:'reverse', label:'爆品图反推', title:'爆品主图反推 · 结构参考', summary:'保存竞品/爆品图反推结果及其可复用提示词。', image:'../素材/白底图/购物车.jpg', file:'reverse-best-seller-001.jpg', tags:['爆品图反推','结构参考','待复核'], version:'V1 · 2026-08-24', refs:'0 次', usage:'用于拆解爆品构图、光影和信息层级，不直接覆盖商品事实。', badge:'REVERSE', prompt:'分析参考爆品图的视觉结构，输出不包含具体品牌和商品事实的可复用提示词：描述主体相对位置、背景层次、光影方向、构图比例、留白和信息层级；不得复制原图品牌、参数或未经核验的卖点。', promptTemplate:'爆品图反推 · v1' },
  ];
  const templates = [
    { id:'template-plan-001', type:'template', label:'plan', title:'全平台主图详情页通用 · v3', summary:'LLM 套图规划模板，输出 suite-plan-v1 结构化计划。', tags:['plan','LLM','已发布'], version:'v3 · 2026-08-22', refs:'34 次', usage:'用于主图/详情页计划生成，动态字段随模板渲染。', badge:'PLAN', prompt:'System Prompt：保持商品真实，不编造参数、认证、功效、价格和品牌信息。按平台规则规划主图与详情页，每张图片承担独立职责。\n\nOutput Schema：suite-plan-v1 / items[] / title / purpose / prompt。', promptTemplate:'计划模板版本正文' },
    { id:'template-plan-002', type:'template', label:'plan', title:'3C 数码类主图与详情页 · v2', summary:'针对 3C 产品的主图和详情页规划模板。', tags:['plan','3C 数码','已发布'], version:'v2 · 2026-08-21', refs:'21 次', usage:'适用于数码配件的计划生成。', badge:'PLAN', prompt:'System Prompt：围绕真实产品结构、接口、材质和使用关系组织 3C 主图与详情页计划；先保证识别度，再表达卖点；禁止虚构技术参数。', promptTemplate:'3C 数码类主图与详情页 · v2' },
    { id:'template-base-001', type:'template', label:'base_refine', title:'通用白底精修 · v2', summary:'图像模型底图精修模板，保持商品主体真实。', tags:['base_refine','图像模型','已发布'], version:'v2 · 2026-08-20', refs:'42 次', usage:'用于原图到白底底图的精修。', badge:'BASE', prompt:'基于输入实拍图进行白底精修：保持商品外观、颜色、材质、品牌标识和关键结构一致；清理背景，边缘自然，不添加虚构内容。', promptTemplate:'通用白底精修 · v2' },
    { id:'template-task-001', type:'template', label:'task_image', title:'单卡生图与修订 · v1', summary:'单张图片任务的生成和后续提示词修订模板。', tags:['task_image','图像模型','草稿'], version:'v1 · 2026-08-19', refs:'0 次', usage:'仅草稿预览，发布后才允许工作台选择。', badge:'TASK', prompt:'以当前卡片提示词为唯一编辑对象，每次只生成一张新图；保留历史版本、提示词快照和生成参数，不覆盖已选终版。', promptTemplate:'单卡生图与修订 · v1' },
    { id:'template-reverse-001', type:'template', label:'reverse_reference', title:'爆品图反推提示词 · v1', summary:'从参考爆品图提炼构图和视觉结构，不复制商品事实。', tags:['reverse_reference','分析','草稿'], version:'v1 · 2026-08-24', refs:'0 次', usage:'用于保存爆品图反推结果和对应提示词。', badge:'REVERSE', prompt:'分析参考爆品图的构图、光影、背景层次、主体比例、留白和信息层级，输出可复用视觉提示词；不复制原图品牌、参数、功效或商品事实。', promptTemplate:'爆品图反推提示词 · v1' },
  ];
  let activeTab = 'images';
  let activeId = imageResources[0].id;
  const grid = document.querySelector('[data-resource-grid]');
  const empty = document.querySelector('[data-empty]');
  const search = document.createElement('input');
  search.className = 'input'; search.type = 'search'; search.placeholder = '搜索名称、标签或资源 ID';
  const toolbar = document.querySelector('.style-catalog-toolbar'); toolbar.append(search);
  const all = () => activeTab === 'images' ? imageResources : templates;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function render() {
    const query = search.value.trim().toLowerCase();
    const selectedType = [...document.querySelectorAll('[data-type-filter]:checked')].map((input) => input.dataset.typeFilter);
    const showAll = selectedType.includes('all') || !selectedType.length;
    const items = all().filter((item) => (!query || `${item.title}${item.summary}${item.tags.join(' ')}${item.id}`.toLowerCase().includes(query)) && (activeTab === 'templates' || showAll || selectedType.includes(item.type)));
    grid.innerHTML = items.map((item) => item.type === 'template' ? `<button class="style-card resource-card-template ${item.id === activeId ? 'active' : ''}" data-resource-id="${item.id}" type="button"><div class="style-image"><strong>${esc(item.title)}</strong><span>${esc(item.label)}</span><span class="badge">${esc(item.badge)}</span></div><div class="style-card-body"><div class="style-card-title">${esc(item.title)}</div><div class="style-card-summary">${esc(item.summary)}</div><div class="resource-card-meta">${item.tags.map((tag) => `<span class="badge">${esc(tag)}</span>`).join('')}</div><div class="style-card-meta"><span>${esc(item.version)}</span><span>${esc(item.refs)}</span></div></div></button>` : `<button class="style-card resource-card-${item.type} ${item.id === activeId ? 'active' : ''}" data-resource-id="${item.id}" type="button"><div class="style-image"><img loading="lazy" src="${item.image}" alt="${esc(item.title)}"><span class="badge">${esc(item.badge)}</span></div><div class="style-card-body"><div class="style-card-title">${esc(item.title)}</div><div class="style-card-summary">${esc(item.summary)}</div><div class="resource-card-meta">${item.tags.map((tag) => `<span class="badge">${esc(tag)}</span>`).join('')}</div><div class="style-card-meta"><span>${esc(item.version)}</span><span>${item.prompt ? '<span class="prompt-linked">提示词已关联</span>' : '<span class="prompt-unlinked">无提示词</span>'}</span></div></div></button>`).join('');
    empty.hidden = items.length > 0;
    grid.querySelectorAll('[data-resource-id]').forEach((button) => button.addEventListener('click', () => { activeId = button.dataset.resourceId; render(); updateInspector(); }));
  }
  function updateInspector() {
    const item = all().find((entry) => entry.id === activeId) || all()[0];
    if (!item) return;
    const image = document.querySelector('[data-detail-image]');
    image.src = item.image || 'assets/gan65-product.jpg'; image.alt = item.title;
    document.querySelector('[data-detail-title]').textContent = item.title;
    document.querySelector('[data-detail-summary]').textContent = item.summary;
    document.querySelector('[data-detail-id]').textContent = item.id;
    document.querySelector('[data-detail-version]').textContent = item.version;
    document.querySelector('[data-detail-file]').textContent = item.file || `${item.label}.md`;
    document.querySelector('[data-detail-refs]').textContent = item.refs;
    document.querySelector('[data-detail-usage]').textContent = item.usage;
    document.querySelector('[data-detail-status]').textContent = item.tags.includes('草稿') ? '草稿' : '已发布';
    document.querySelector('[data-detail-tags]').innerHTML = item.tags.map((tag) => `<span class="badge">${esc(tag)}</span>`).join('');
    const promptEmpty = document.querySelector('[data-prompt-empty]');
    const promptPanel = document.querySelector('[data-prompt-panel]');
    promptEmpty.hidden = Boolean(item.prompt) || item.type !== 'original';
    promptPanel.hidden = !item.prompt;
    document.querySelector('[data-prompt-template]').textContent = item.promptTemplate ?? '无模板';
    document.querySelector('[data-prompt-text]').textContent = item.prompt ?? '';
    document.querySelector('[data-upload-label]').textContent = activeTab === 'templates' ? '新建模板' : '上传图片资产';
    document.querySelector('[data-select-resource]').textContent = activeTab === 'templates' ? '选择模板' : '选择资源';
    document.querySelector('[data-preview-resource]').textContent = activeTab === 'templates' ? '查看版本' : '打开预览';
    document.querySelector('[data-manage-resource]').textContent = activeTab === 'templates' ? '管理模板' : '管理图片资产';
  }
  function showToast(title, message) { document.querySelector('[data-toast-title]').textContent = title; document.querySelector('[data-toast-message]').textContent = message; document.querySelector('[data-toast-backdrop]').classList.add('open'); }
  document.querySelectorAll('[data-close-toast]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-toast-backdrop]').classList.remove('open')));
  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { activeTab = button.dataset.tab; activeId = all()[0].id; document.querySelectorAll('[data-tab]').forEach((tab) => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); document.querySelector('[data-boundary]').textContent = activeTab === 'images' ? '维护生成图片资产和爆品图反推结果；除实拍原图外，每张图片必须有对应提示词。' : '维护按执行阶段管理的提示词模板；模板版本决定可用的输入字段和生成规则。'; render(); updateInspector(); }));
  document.querySelectorAll('[data-type-filter]').forEach((input) => input.addEventListener('change', () => { if (input.dataset.typeFilter === 'all' && input.checked) document.querySelectorAll('[data-type-filter]:not([data-type-filter="all"])').forEach((other) => { other.checked = false; }); if (input.dataset.typeFilter !== 'all' && input.checked) document.querySelector('[data-type-filter="all"]').checked = false; render(); }));
  search.addEventListener('input', render);
  document.querySelector('[data-select-resource]').addEventListener('click', () => showToast(activeTab === 'templates' ? '已选择模板' : '已加入当前请求', activeTab === 'templates' ? '当前模板版本将随计划或单卡请求冻结，不会覆盖已有提示词。' : '图片资源将在提交生成时以版本和提示词快照冻结。'));
  document.querySelector('[data-preview-resource]').addEventListener('click', () => showToast(activeTab === 'templates' ? '模板版本' : '预览入口', activeTab === 'templates' ? '这里将展示 System Prompt、User Prompt Template、inputSchema 和版本差异。' : '原型阶段仅展示资源详情；全屏预览和版本对比将在 PRD 确认后定义。'));
  document.querySelector('[data-manage-resource]').addEventListener('click', () => showToast(activeTab === 'templates' ? '模板管理' : '图片资产管理', activeTab === 'templates' ? '后续支持编辑草稿、复制版本、发布、下线和查看历史引用。' : '后续支持上传、补充提示词、绑定来源、发布和下线图片资产。'));
  document.querySelector('[data-upload]').addEventListener('click', () => showToast('上传资源', '原型阶段不写入文件；正式流程将上传到对象存储并保存资源元数据。'));
  render(); updateInspector();
})();
