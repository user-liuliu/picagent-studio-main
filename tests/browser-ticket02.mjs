import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto("http://127.0.0.1:5174/suites/new");
await page.getByPlaceholder("例如：耳机日本站套图").fill("浏览器恢复测试");
await page.getByRole("button", { name: "创建方案" }).click();
await page.waitForURL(/\/suites\//);
const suiteUrl = page.url();
const imagePath = "D:/develop/pic_agent_suite_workbench/素材/实拍图/耳机1.jpg";
await page.locator('input[type="file"]').setInputFiles(imagePath);
await page.getByText("1/6 张").waitFor({ state: "visible" });
await page.reload();
await page.getByText("1/6 张").waitFor({ state: "visible" });
const imageCount = await page.locator(".start-thumbnail-strip button").count();
const sourceName = await page.locator(".start-image-card.source footer strong").textContent();
const overflow = await page.evaluate(() => ({ok: document.documentElement.scrollWidth <= window.innerWidth, sw: document.documentElement.scrollWidth, iw: window.innerWidth, bad: [...document.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))}));
await page.screenshot({ path: "output/ticket02-browser-recovery.png", fullPage: true });
console.log(JSON.stringify({ suiteUrl, imageCount, sourceName, overflow, errors }));
await browser.close();

