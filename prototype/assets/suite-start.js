(function () {
  const templates = {
    "digital-set": [
      { key: "market", label: "目标站点", value: "Amazon 日本站" },
      { key: "audience", label: "目标人群", value: "需要多设备充电的商务与差旅用户" },
      { key: "sellingPoint", label: "核心卖点", value: "65W 三口快充，小体积便携" },
      { key: "direction", label: "视觉方向", value: "科技感、可信、克制的商业摄影", full: true },
    ],
    "general-set": [
      { key: "product", label: "商品名称", value: "GAN65-BK 三口氮化镓充电器" },
      { key: "market", label: "目标平台与地区", value: "Amazon 日本站" },
      { key: "sellingPoint", label: "主要购买理由", value: "一颗满足笔记本、平板与手机补能" },
      { key: "tone", label: "品牌调性", value: "专业、精密、简洁", full: true },
    ],
    "digital-main": [
      { key: "market", label: "目标站点", value: "Amazon 日本站" },
      { key: "imageCount", label: "主图数量", value: "4 张" },
      { key: "sellingPoint", label: "首要卖点", value: "65W 三口快充" },
      { key: "restriction", label: "必须保留", value: "产品接口、Logo、颜色和真实比例", full: true },
    ],
  };

  const fields = document.querySelector("[data-dynamic-fields]");
  const templateSelect = document.querySelector("[data-template-select]");
  const chunks = Array.from(document.querySelectorAll("[data-chunk]"));
  const selectionCount = document.querySelector("[data-selection-count]");
  const search = document.querySelector("[data-chunk-search]");
  const toast = document.querySelector("[data-toast]");
  const fileInput = document.querySelector("[data-file-input]");
  let toastTimer = null;

  function escapeHtml(value) {
    return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function renderFields() {
    fields.innerHTML = templates[templateSelect.value].map((field) => `<label class="start-field ${field.full ? "full" : ""}"><span>${field.label}</span><input data-field-key="${field.key}" value="${escapeHtml(field.value)}"></label>`).join("");
  }

  function updateSelection() {
    const selected = chunks.filter((chunk) => chunk.querySelector("input").checked);
    chunks.forEach((chunk) => chunk.classList.toggle("selected", chunk.querySelector("input").checked));
    selectionCount.textContent = `已选 ${selected.length} 条`;
  }

  templateSelect.addEventListener("change", () => {
    renderFields();
    notify("已切换模板，输入字段已更新");
  });

  chunks.forEach((chunk) => chunk.querySelector("input").addEventListener("change", updateSelection));
  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    chunks.forEach((chunk) => { chunk.hidden = Boolean(query && !chunk.dataset.searchText.toLowerCase().includes(query)); });
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-reserved-mode], [data-autofill], [data-replace-image], [data-refine-image], [data-resume-reserved], [data-new-project]");
    if (!target) return;
    if (target.matches("[data-reserved-mode]")) notify(`${target.dataset.reservedMode}接口已预留`);
    if (target.matches("[data-autofill]")) {
      const sellingPoint = fields.querySelector('[data-field-key="sellingPoint"]');
      if (sellingPoint) sellingPoint.value = "65W 三口快充，支持笔记本、平板与手机多设备补能";
      const selectedCount = chunks.filter((chunk) => chunk.querySelector("input").checked).length;
      notify(`已从 ${selectedCount} 条已选资料填写可用字段`);
    }
    if (target.matches("[data-replace-image]")) fileInput.click();
    if (target.matches("[data-refine-image]")) {
      target.disabled = true;
      target.textContent = "精修中…";
      window.setTimeout(() => { target.disabled = false; target.textContent = "重新精修"; notify("精修白底图已生成新版本"); }, 1200);
    }
    if (target.matches("[data-resume-reserved]")) notify("草稿打开接口已预留");
    if (target.matches("[data-new-project]")) window.scrollTo({ top: 0, behavior: "smooth" });
  });

  fileInput.addEventListener("change", () => { if (fileInput.files.length) notify(`已选择 ${fileInput.files[0].name}，等待生成精修白底图`); });
  renderFields();
  updateSelection();
})();
