gpt-image-2
图像生成
01
文生图

仅使用文字提示词生成图片，请求体为 JSON。

POST
https://img.yunfei.best/v1/images/generations
请求参数
参数	必填	说明
model	是	固定为 gpt-image-2
prompt	是	文字提示词，中英文皆可
size	否	1K 分组最高支持 1K；4K 分组支持 1K / 2K / 4K；默认 auto
quality	否	high 分组支持 high；其他分组默认 medium
n	是	请固定传 1
response_format	否	url（默认）或 b64_json
请求
命令行
复制
curl https://img.yunfei.best/v1/images/generations \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "湖蓝色调的山谷,清晨薄雾,极简插画风",
    "size": "1024x1536",
    "n": 1
  }'
响应
网址格式
复制
{ "created": 1781837823, "data": [{ "url": "https://xxx.png" }] }
图片编码格式
复制
{ "created": 1781837823, "data": [{ "b64_json": "<BASE64>" }] }
网址默认保存 15 分钟，建议尽快下载。传 response_format=b64_json 时，图片编码位于 data[0].b64_json。
02
图生图

上传一张或多张参考图进行编辑，请求体为表单。

POST
https://img.yunfei.best/v1/images/edits
请求参数
参数	必填	说明
model	是	固定为 gpt-image-2
image / image[]	是	PNG / JPEG / WebP 文件，可重复传入
prompt	是	编辑要求；多图可用“第一张 / 第二张”指代
size	否	不传则沿用参考图尺寸；1K 分组最高支持 1K；4K 分组支持 1K / 2K / 4K
quality	否	high 分组支持 high；其他分组默认 medium
n	是	请固定传 1
response_format	否	url（默认）或 b64_json
请求
单张参考图
复制
curl https://img.yunfei.best/v1/images/edits \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=gpt-image-2" -F "image=@otter.png" -F "n=1" \
  -F "prompt=给这只海獭戴上一顶贝雷帽"
多张参考图
复制
curl https://img.yunfei.best/v1/images/edits \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=gpt-image-2" -F "image[]=@teapot.png" -F "image[]=@duck.png" -F "n=1" \
  -F "prompt=把第二张图的小鸭子放在第一张图的茶壶旁边"
响应
网址格式
复制
{ "created": 1781837823, "data": [{ "url": "https://xxx.png" }] }
图片编码格式
复制
{ "created": 1781837823, "data": [{ "b64_json": "<BASE64>" }] }
网址默认保存 15 分钟，建议尽快下载。传 response_format=b64_json 时，图片编码位于 data[0].b64_json。
香蕉&香蕉2
香蕉图像生成

使用 Gemini 原生 generateContent 接口，模型名填写在请求网址中，不属于 JSON 请求体。

网址中的模型
外号	模型名	取向
香蕉 Pro	gemini-3-pro-image-preview	画质档，适合成品
香蕉2	gemini-3.1-flash-image-preview	速度档；额外支持 8:1、4:1、1:4、1:8
比例与像素
比例	1K	2K	4K
1:1	1024×1024	2048×2048	4096×4096
16:9	1376×768	2752×1536	5504×3072
9:16	768×1376	1536×2752	3072×5504
4:3	1200×896	2400×1792	4800×3584
3:4	896×1200	1792×2400	3584×4800
3:2	1264×848	2528×1696	5056×3392
2:3	848×1264	1696×2528	3392×5056
5:4	1152×928	2304×1856	4608×3712
4:5	928×1152	1856×2304	3712×4608
21:9	1584×672	3168×1344	6336×2688
仅香蕉2支持超宽长条：1K 下 8:1 = 2928×352、4:1 = 2064×512、1:4 = 512×2064、1:8 = 352×2928；2K / 4K 分别按 ×2 / ×4。
03
文生图

在网址中选择模型，在 contents 的文字 part 中填写提示词。

POST
https://img.yunfei.best/v1beta/models/gemini-3-pro-image-preview:generateContent
请求头
鉴权与格式
复制
x-goog-api-key: <API_KEY>
# 也兼容 Authorization: Bearer <API_KEY>
Content-Type: application/json
请求参数
参数	必填	说明
contents[].role	是	固定填写 user
contents[].parts[].text	是	文字提示词
generationConfig.responseModalities	否	["IMAGE"] 返回图片编码（默认）；["TEXT"] 返回网址；["IMAGE","TEXT"] 两者都返回
generationConfig.imageConfig.aspectRatio	否	输出比例；需要自动比例时省略，不要传 auto
generationConfig.imageConfig.imageSize	否	1K / 2K / 4K，K 必须大写
请求
文生图
复制
curl -X POST "https://img.yunfei.best/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{
    "contents": [ { "role": "user", "parts": [ { "text": "木桌上的红苹果,棚拍光线,极简背景" } ] } ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
    }
  }'
响应
responseModalities	响应字段
["IMAGE"]	candidates[0].content.parts[0].inline_data.data
["TEXT"]	candidates[0].content.parts[1].file_data.file_uri
["IMAGE","TEXT"]	以上两个字段都返回
同时返回图片编码和网址
复制
{
  "candidates": [{
    "content": {"parts": [
      {"inline_data": {"mime_type": "image/png", "data": "<BASE64>"}},
      {"file_data": {"file_uri": "https://xxx.png"}}
    ]}
  }]
}
04
图生图

在文字部件外加入图片部件，支持图片编码、网址或混合输入。

POST
https://img.yunfei.best/v1beta/models/gemini-3-pro-image-preview:generateContent
请求头
鉴权与格式
复制
x-goog-api-key: <API_KEY>
# 也兼容 Authorization: Bearer <API_KEY>
Content-Type: application/json
请求参数
参数	必填	说明
contents[].role	是	固定填写 user
contents[].parts[].text	是	编辑要求
contents[].parts[].inline_data	二选一	包含 mime_type 和 data，输入图片编码
contents[].parts[].file_data	二选一	包含 mime_type 和 file_uri，输入公网图片网址
generationConfig.responseModalities	否	["IMAGE"]、["TEXT"] 或 ["IMAGE","TEXT"]
generationConfig.imageConfig.aspectRatio	否	省略时根据参考图自动决定，不要传 auto
generationConfig.imageConfig.imageSize	否	1K / 2K / 4K
多个 inline_data / file_data 可以混用，并按它们在 contents[].parts 中的顺序处理。
请求
输入图片编码
复制
curl -X POST "https://img.yunfei.best/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{
    "contents": [ { "role": "user", "parts": [
      { "text": "改成日系水彩风,保留主体和构图" },
      { "inline_data": { "mime_type": "image/png", "data": "<BASE64>" } }
    ] } ],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": { "imageSize": "2K" }
    }
  }'
输入图片网址时替换为
复制
"file_data": {"mime_type":"image/png","file_uri":"https://example.com/input.png"}
响应
responseModalities	响应字段
["IMAGE"]	candidates[0].content.parts[0].inline_data.data
["TEXT"]	candidates[0].content.parts[1].file_data.file_uri
["IMAGE","TEXT"]	以上两个字段都返回
同时返回图片编码和网址
复制
{
  "candidates": [{
    "content": {"parts": [
      {"inline_data": {"mime_type": "image/png", "data": "<BASE64>"}},
      {"file_data": {"file_uri": "https://xxx.png"}}
    ]}
  }]
}
只传 imageSize 并省略 aspectRatio 时，输出自动跟随参考图比例；两者都省略时，比例和输出档位都交给上游决定。
veo视频
异步视频生成

每次提交先返回任务 id，再轮询到 completed 后取片。比例默认 16:9，duration 必填。

05
文生视频

不传参考图，仅根据提示词生成视频。

POST
https://img.yunfei.best/v1/videos
请求参数
参数	必填	说明
model	是	veo-3.1-fast-generate-preview、veo-3.1-generate-preview 或 veo-3.1-generate-preview-ref
prompt	是	提示词，不要写比例和时长
duration	是	4 / 6 / 8 秒，兼容 seconds
aspect_ratio	否	16:9 或 9:16，默认 16:9
generate_audio	否	是否生成音频，默认 true；兼容 generateAudio
negative_prompt	否	负向提示词；兼容 negativePrompt
输出分辨率	—	720p
veo-3.1-generate-preview-ref 不传图片时等同普通文生视频。
请求
文生视频
复制
curl -X POST "https://img.yunfei.best/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"veo-3.1-fast-generate-preview","prompt":"a paper boat sailing down a rain puddle, cinematic","duration":4,"aspect_ratio":"16:9"}'
响应与轮询
提交响应
复制
{ "id": "xxxx", "status": "queued" }
轮询请求
复制
curl "https://img.yunfei.best/v1/videos/{id}" -H "Authorization: Bearer <API_KEY>"
生成完成响应
复制
{ "id": "xxxx", "status": "completed", "url": "https://xxx.mp4" }
建议每 5～10 秒轮询一次。当 status 为 completed 时，从 url 获取视频地址；failed 表示失败，失败不扣费。
queued 已排队
in_progress 生成中
completed 可取片
failed 失败
06
单图生视频

上传一张首帧图片驱动视频，适用于快速和标准模型。

POST
https://img.yunfei.best/v1/videos
请求参数
参数	必填	说明
model	是	veo-3.1-fast-generate-preview 或 veo-3.1-generate-preview
prompt	是	运动和镜头要求，不要写比例与时长
image_url	是	公网直链、dataURL 或裸 base64
duration	是	4 / 6 / 8 秒，兼容 seconds
aspect_ratio	否	16:9 或 9:16，默认 16:9
generate_audio	否	音频开关，默认 true；兼容 generateAudio
negative_prompt	否	负向提示词；兼容 negativePrompt
输出分辨率	—	720p
图片不支持 {"data":"...","mime_type":"..."} 对象格式。
请求
单图生视频
复制
curl -X POST "https://img.yunfei.best/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"model":"veo-3.1-fast-generate-preview","prompt":"镜头缓缓推进,人物转头微笑","duration":4,"aspect_ratio":"16:9","image_url":"https://example.com/first-frame.jpg"}'
响应与轮询
提交响应
复制
{ "id": "xxxx", "status": "queued" }
轮询请求
复制
curl "https://img.yunfei.best/v1/videos/{id}" -H "Authorization: Bearer <API_KEY>"
生成完成响应
复制
{ "id": "xxxx", "status": "completed", "url": "https://xxx.mp4" }
建议每 5～10 秒轮询一次。completed 后从 url 获取视频地址；failed 表示失败，失败不扣费。
07
首尾帧视频

传两张图片生成中间过渡，第 1 张为首帧，第 2 张为尾帧。

POST
https://img.yunfei.best/v1/videos
请求参数
参数	必填	说明
model	是	veo-3.1-fast-generate-preview 或 veo-3.1-generate-preview
prompt	是	过渡和镜头要求，不要写比例与时长
image_urls	是	第 1 张为首帧，第 2 张为尾帧；支持公网直链、dataURL 或裸 base64
duration	是	4 / 6 / 8 秒，兼容 seconds
aspect_ratio	否	16:9 或 9:16，默认 16:9
generate_audio	否	音频开关，默认 true；兼容 generateAudio
negative_prompt	否	负向提示词；兼容 negativePrompt
输出分辨率	—	720p
图片不支持 {"data":"...","mime_type":"..."} 对象格式。
请求
首尾帧视频
复制
curl -X POST "https://img.yunfei.best/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{
    "model":"veo-3.1-generate-preview","prompt":"生成自然连续的电影感过渡","duration":8,"aspect_ratio":"16:9",
    "image_urls":["https://example.com/first.jpg","https://example.com/last.jpg"]
  }'
响应与轮询
提交响应
复制
{ "id": "xxxx", "status": "queued" }
轮询请求
复制
curl "https://img.yunfei.best/v1/videos/{id}" -H "Authorization: Bearer <API_KEY>"
生成完成响应
复制
{ "id": "xxxx", "status": "completed", "url": "https://xxx.mp4" }
建议每 5～10 秒轮询一次。completed 后从 url 获取视频地址；failed 表示失败，失败不扣费。
08
多参考图视频

使用多张参考图保持主体与场景一致，仅适用于参考模型。

POST
https://img.yunfei.best/v1/videos
请求参数
参数	必填	说明
model	是	固定为 veo-3.1-generate-preview-ref
prompt	是	视频内容和运动要求，不要写比例与时长
image_urls	是	参考图数组；支持公网直链、dataURL 或裸 base64
duration	是	带图时固定为 8 秒，兼容 seconds
aspect_ratio	是	带图时固定为 16:9
generate_audio	否	音频开关，默认 true；兼容 generateAudio
negative_prompt	否	负向提示词；兼容 negativePrompt
输出分辨率	—	720p
图片不支持 {"data":"...","mime_type":"..."} 对象格式。传 4 / 6 秒或 9:16 会生成失败，失败不扣费。
请求
三图多参考
复制
curl -X POST "https://img.yunfei.best/v1/videos" \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{
    "model":"veo-3.1-generate-preview-ref","prompt":"保持主体和场景一致,生成电影感动态镜头","duration":8,"aspect_ratio":"16:9",
    "image_urls":["https://example.com/1.jpg","https://example.com/2.jpg","https://example.com/3.jpg"]
  }'
响应与轮询
提交响应
复制
{ "id": "xxxx", "status": "queued" }
轮询请求
复制
curl "https://img.yunfei.best/v1/videos/{id}" -H "Authorization: Bearer <API_KEY>"
生成完成响应
复制
{ "id": "xxxx", "status": "completed", "url": "https://xxx.mp4" }
建议每 5～10 秒轮询一次。completed 后从 url 获取视频地址；failed 表示失败，失败不扣费。