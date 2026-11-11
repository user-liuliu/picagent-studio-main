CREATE TABLE IF NOT EXISTS suite_workbench.platform_profiles (
  code varchar(80) PRIMARY KEY,
  name varchar(160) NOT NULL UNIQUE,
  market_scope varchar(30) NOT NULL CHECK (market_scope IN ('overseas', 'domestic')),
  main_image_strategy text NOT NULL,
  gallery_strategy text NOT NULL,
  text_strategy text NOT NULL,
  model_strategy text NOT NULL,
  source_note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO suite_workbench.platform_profiles
  (code, name, market_scope, main_image_strategy, gallery_strategy, text_strategy, model_strategy, source_note, sort_order)
VALUES
  ('amazon', 'Amazon', 'overseas', '首图优先纯白背景、商品主体完整清晰，不放文字、促销信息或无关装饰；服饰类按类目规则处理。', '用细节、尺寸、使用关系、包装和场景图补充购买决策，避免重复和无法证明的效果。', '首图不放文字；其他图片仅使用克制、可读且有事实依据的说明。', '非服饰默认不使用模特或仅保留无脸/局部；服饰按类目谨慎使用。', '按 Amazon 当前商品图片规范采用保守首图策略，具体类目政策优先。', 10),
  ('walmart', 'Walmart Marketplace', 'overseas', '商品主体清楚、背景干净、颜色真实；需要时优先白底，不添加误导性促销元素。', '补充多角度、尺寸、功能、包装和使用关系，保持商品信息一致。', '文字少而清晰，不能遮挡主体或制造未经证实的承诺。', '以产品展示为主；服饰和生活方式类可按品类使用模特。', '依据 Walmart Marketplace 当前商品内容与图片要求，类目规则优先。', 20),
  ('tiktok_shop', 'TikTok Shop（跨境）', 'overseas', '首图使用纯白背景、正面实物、主体强识别；所有商品图避免文字、Logo、水印、边框和图形覆盖。', '前后侧、多角度、细节、配件、尺寸和真实使用场景，适配推荐流快速扫读。', '商品图不叠加文字或促销贴片，关键信息放商品标题、属性和详情字段。', '可使用模特展示使用关系，但不得误导、低俗或抢占商品主体。', '依据 TikTok Shop 2026 年商品图片与详情页规则，具体站点规则优先。', 30),
  ('ebay', 'eBay', 'overseas', '展示真实在售商品，背景整洁，状态和数量可信，不使用与实物不符的图库感画面。', '多角度、真实状态、尺寸、包装和使用方式，清楚展示瑕疵或差异。', '图片不添加文字、艺术或营销素材，商品事实放标题、属性和描述。', '生活方式模特可用，但不能让商品状态或真实外观产生误解。', '依据 eBay 当前图片政策，真实商品状态和无叠加素材优先。', 40),
  ('etsy', 'Etsy', 'overseas', '突出真实手作/原创商品和材质细节，画面自然可信，避免模板化图库感。', '展示细节、尺寸、包装、制作痕迹和使用方式，服务于信任建立。', '可按品牌和手作调性使用少量说明，但不得夸大或误导。', '可使用生活方式模特，避免让商品来源、原创性或尺寸产生误解。', '采用 Etsy 当前刊登真实性与商品展示原则，具体类目政策优先。', 50),
  ('shopee', 'Shopee', 'overseas', '方图优先，商品清晰完整，白底或干净背景，首图不被装饰抢主体。', '多角度、卖点、细节、场景和规格，保证信息层级清楚。', '可使用适度卖点图，但文字必须清晰、真实且不遮挡商品。', '可本地化生活方式模特，但商品主体必须持续可识别。', '按 Shopee 站点与类目当前要求复核尺寸和内容限制。', 60),
  ('lazada', 'Lazada', 'overseas', '方图、主体清晰、背景干净，优先使用标准化商品展示。', '多角度、卖点、细节、场景和规格，避免重复信息。', '适度使用卖点文字，保持高可读性和事实准确。', '可按品类使用本地化生活方式模特，不遮挡产品。', '按 Lazada 站点与类目当前要求复核尺寸和内容限制。', 70),
  ('aliexpress', 'AliExpress', 'overseas', '方图、产品清晰、白底或干净背景，首图强调真实商品识别。', '多角度、卖点、细节、场景和规格，突出跨境购买所需信息。', '可适度使用卖点图，但不得夸大效果、认证或参数。', '可使用本地化生活方式模特，不能遮挡或改变商品外观。', '按 AliExpress 站点与类目当前要求复核图片和文案限制。', 80),
  ('temu', 'Temu', 'overseas', '方图、主体清晰、白底或干净背景，避免促销贴片遮挡产品。', '多角度、细节、场景、规格和组合关系，信息直接易扫读。', '可适度使用卖点文字，必须清晰且有事实依据。', '可本地化生活方式模特，但不能遮挡产品或制造误导。', '按 Temu 当前站点与类目要求复核图片和内容限制。', 90),
  ('shopify', 'Shopify / 独立站', 'overseas', '可按品牌调性自由设计，但首屏必须清楚展示真实商品和关键卖点。', '品牌叙事、生活方式、细节、对比和组合可自由组织，保持事实一致。', '可按品牌系统设计文字，但要保证移动端可读和商品识别。', '可按品牌调性使用模特，但产品必须清楚、真实、可核验。', '独立站规则由商家品牌规范和适用法律共同约束。', 100),
  ('taobao', '淘宝 / 天猫', 'domestic', '商品主体清晰，按类目选择 1:1 或 3:4，强调点击与真实感。', '卖点、场景、细节、规格和搭配可组合，但信息必须真实。', '可有卖点文字，但要清晰、不拥挤、不夸大。', '服饰鞋包可用模特，首图按类目谨慎处理。', '保留原有国内平台策略，海外场景优先使用海外平台档案。', 200),
  ('jd', '京东', 'domestic', '标准化、白底、清晰、专业感优先。', '多角度、细节、规格和功能说明。', '首图克制，后续图片模块化表达。', '家电/数码优先产品展示，服饰按类目处理。', '保留原有国内平台策略。', 210),
  ('pinduoduo', '拼多多', 'domestic', '强识别、强卖点、强价格感，但不得虚构。', '卖点、组合、规格、场景和活动权益需有事实依据。', '可更直给，但不得夸大或遮挡主体。', '模特服务商品，不抢主体。', '保留原有国内平台策略。', 220),
  ('1688', '1688', 'domestic', 'B2B 信息效率优先，产品、规格、工厂和供货信息真实。', '多规格、批发场景、材质、工艺、包装和应用。', '信息可密集，但必须真实可核验。', '一般少用模特，工具/工业品不强行加入。', '保留原有国内平台策略。', 230),
  ('douyin', '抖音 / 快手', 'domestic', '适合推荐流，强商品识别与场景感。', '使用场景、卖点、细节和短视频封面感。', '短句化、强扫读，不制造违规承诺。', '可用模特，但避免违规和低俗。', '保留原有国内平台策略。', 240),
  ('xiaohongshu', '小红书店铺', 'domestic', '真实、美观、生活方式优先，避免密集促销贴片。', '场景、搭配、细节和种草氛围。', '首图少文字或无文字，后续克制表达。', '可使用生活方式模特，避免明星图和误导。', '保留原有国内平台策略。', 250)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  market_scope = EXCLUDED.market_scope,
  main_image_strategy = EXCLUDED.main_image_strategy,
  gallery_strategy = EXCLUDED.gallery_strategy,
  text_strategy = EXCLUDED.text_strategy,
  model_strategy = EXCLUDED.model_strategy,
  source_note = EXCLUDED.source_note,
  sort_order = EXCLUDED.sort_order,
  enabled = true,
  updated_at = now();

CREATE INDEX IF NOT EXISTS platform_profiles_enabled_idx
  ON suite_workbench.platform_profiles (enabled, sort_order, name);
