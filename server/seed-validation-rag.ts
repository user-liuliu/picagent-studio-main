import { createHash } from "node:crypto";
import { Pool } from "pg";
import { loadPostgresConfig } from "./config.js";
import { runMigrations } from "./migrations.js";

const records = [
  { id:"validation.power-bank",title:"充电宝验证资料",summary:"充电宝实拍图验证组，仅记录商品类别与多角度素材。",content:"商品类别：充电宝。现有三张实拍素材。功率、容量、认证、产地、价格及功效均待补充。",fieldValues:{product_name:"充电宝",product_category:"3C 数码配件",product_parameters:"功率、容量、认证等参数待补充"},paths:["素材/实拍图/充电宝.jpg","素材/实拍图/充电宝2.jpg","素材/实拍图/充电宝3.jpg"]},
  { id:"validation.headphones",title:"耳机验证资料",summary:"耳机实拍图验证组，仅记录商品类别与多角度素材。",content:"商品类别：耳机。现有三张实拍素材。连接方式、续航、认证、价格及功效均待补充。",fieldValues:{product_name:"耳机",product_category:"3C 数码配件",product_parameters:"连接方式、续航等参数待补充"},paths:["素材/实拍图/耳机1.jpg","素材/实拍图/耳机2.jpg","素材/实拍图/耳机3.jpg"]},
  { id:"validation.mouse",title:"鼠标验证资料",summary:"鼠标实拍图验证组，仅记录商品类别与多角度素材。",content:"商品类别：鼠标。现有三张实拍素材。连接方式、传感器、认证、产地和价格均待补充。",fieldValues:{product_name:"鼠标",product_category:"3C 数码配件",product_parameters:"连接方式、传感器等参数待补充"},paths:["素材/实拍图/鼠标1.jpg","素材/实拍图/鼠标2.jpg","素材/实拍图/鼠标3.jpg"]},
  { id:"validation.pen",title:"中性笔验证资料",summary:"中性笔实拍图验证组，仅记录商品类别与两张素材。",content:"商品类别：中性笔。现有两张实拍素材。笔尖规格、墨水性质、材质、产地和价格均待补充。",fieldValues:{product_name:"中性笔",product_category:"文具",product_parameters:"笔尖规格、墨水性质等参数待补充"},paths:["素材/实拍图/中性笔1.jpg","素材/实拍图/中性笔2.jpg"]},
  { id:"validation.cart",title:"购物车白底验证资料",summary:"购物车白底图验证组，仅记录商品类别和白底素材。",content:"商品类别：购物车。现有一张白底素材。容量、承重、材质、尺寸、认证、产地与价格均待补充。",fieldValues:{product_name:"购物车",product_category:"百货",product_parameters:"容量、承重、材质与尺寸待补充"},paths:["素材/白底图/购物车.jpg"]},
];
const pool=new Pool({...loadPostgresConfig(),max:2});
try{await runMigrations(pool);for(const r of records){const sha=createHash("sha256").update(JSON.stringify({content:r.content,fieldValues:r.fieldValues,paths:r.paths})).digest("hex");await pool.query(`INSERT INTO suite_workbench.validation_rag_chunks (id,source_version,title,summary,content,field_values_json,source_asset_paths_json,content_sha256,source_kind,status) VALUES ($1,'1',$2,$3,$4,$5,$6,$7,'validation_seed','published') ON CONFLICT (id,source_version) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,content=EXCLUDED.content,field_values_json=EXCLUDED.field_values_json,source_asset_paths_json=EXCLUDED.source_asset_paths_json,content_sha256=EXCLUDED.content_sha256,source_kind='validation_seed',status='published'`,[r.id,r.title,r.summary,r.content,JSON.stringify(r.fieldValues),JSON.stringify(r.paths),sha]);}console.log(JSON.stringify({seeded:records.length,sourceKind:"validation_seed"}));}finally{await pool.end();}
