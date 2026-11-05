/**
 * 情侣网站平台(多租户版)
 * 一个平台,任意多对情侣,每对有自己的小窝 /h/<编号>,各自设暗号,数据互相隔离。
 * 数据存放在 data/homes/ 目录下,每个小窝一个 JSON 文件,零配置。
 * 启动: npm start   (环境变量 PORT 可改端口)
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const HOMES_DIR = path.join(__dirname, "data", "homes");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
fs.mkdirSync(HOMES_DIR, { recursive: true });

/* ---------------- 工具 ---------------- */
const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const slugOf = () => crypto.randomBytes(4).toString("hex"); // 8位编号,如 a1b2c3d4

function homeFile(slug) {
  // 只允许十六进制编号,防止路径穿越
  if (!/^[0-9a-f]{8}$/.test(slug)) return null;
  return path.join(HOMES_DIR, slug + ".json");
}
function loadHome(slug) {
  const f = homeFile(slug);
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; }
}
function saveHome(slug, data) {
  fs.writeFileSync(homeFile(slug), JSON.stringify(data, null, 2));
}
function newHome() {
  const slug = slugOf();
  return {
    slug,
    passcodeHash: "",
    config: defaultConfig(),
    messages: [],
    createdAt: new Date().toISOString(),
  };
}
function defaultConfig() {
  return {
    nameA: "宝贝", nameB: "我", emojiA: "🐶", emojiB: "🐱",
    togetherSince: "2024-05-20T00:00:00",
    photos: [
      { src: "https://picsum.photos/seed/love1/600/400", cap: "第一次约会的地方 📍" },
      { src: "https://picsum.photos/seed/love2/600/400", cap: "一起看的第一场电影 🎬" },
      { src: "https://picsum.photos/seed/love3/600/400", cap: "那次说走就走的旅行 ✈️" },
      { src: "https://picsum.photos/seed/love4/600/400", cap: "一起做的第一顿饭 🍳" },
    ],
    timeline: [
      { date: "2024-03-01", title: "初次相遇", text: "那天阳光很好,你笑起来的样子我到现在都记得。" },
      { date: "2024-05-20", title: "在一起啦!", text: "这一天,我们正式成为彼此的人 💕" },
    ],
    wishes: [
      "一起看一次日出 🌅", "去一次游乐园 🎡", "一起养一只小猫小狗 🐾",
      "拍一套情侣写真 📷", "一起跨年看烟花 🎆", "去看一次大海 🌊",
    ],
    wishDone: [],
  };
}

/* 会话:token -> slug(内存保存,重启需重新解锁) */
const sessions = new Map(); // token -> slug
const newToken = () => crypto.randomBytes(24).toString("hex");

function auth(req, res, next) {
  const token = req.headers["x-love-token"] || "";
  if (sessions.get(token) === req.params.slug) return next();
  res.status(401).json({ error: "unauthorized" });
}

/* ---------------- 平台级 API ---------------- */

// 创建一个小窝(无需注册账号,返回编号)
app.post("/api/create", (req, res) => {
  const pc = String((req.body || {}).passcode || "").trim();
  if (pc.length < 4) return res.status(400).json({ error: "暗号至少 4 位" });
  let home;
  for (let i = 0; i < 5; i++) {           // 确保编号不重复
    home = newHome();
    if (!loadHome(home.slug)) break;
  }
  home.passcodeHash = hash(pc);
  saveHome(home.slug, home);
  const token = newToken();
  sessions.set(token, home.slug);
  res.json({ slug: home.slug, token });
});

/* ---------------- 小窝级 API ---------------- */

app.get("/api/h/:slug/status", (req, res) => {
  const home = loadHome(req.params.slug);
  if (!home) return res.status(404).json({ error: "not-found" });
  res.json({ hasPasscode: !!home.passcodeHash });
});

// 首次设置 / 修改暗号(需先用旧暗号解锁?这里仅支持首次设置)
app.post("/api/h/:slug/setup", (req, res) => {
  const home = loadHome(req.params.slug);
  if (!home) return res.status(404).json({ error: "not-found" });
  if (home.passcodeHash) return res.status(400).json({ error: "already-setup" });
  const pc = String((req.body || {}).passcode || "").trim();
  if (pc.length < 4) return res.status(400).json({ error: "暗号至少 4 位" });
  home.passcodeHash = hash(pc);
  saveHome(req.params.slug, home);
  const token = newToken();
  sessions.set(token, req.params.slug);
  res.json({ token });
});

app.post("/api/h/:slug/login", (req, res) => {
  const home = loadHome(req.params.slug);
  if (!home) return res.status(404).json({ error: "not-found" });
  if (hash(String((req.body || {}).passcode || "")) === home.passcodeHash) {
    const token = newToken();
    sessions.set(token, req.params.slug);
    return res.json({ token });
  }
  res.status(401).json({ error: "暗号不对哦" });
});

app.get("/api/h/:slug/data", auth, (req, res) => {
  const home = loadHome(req.params.slug);
  res.json({ config: home.config, messages: home.messages });
});

app.post("/api/h/:slug/config", auth, (req, res) => {
  const home = loadHome(req.params.slug);
  home.config = { ...home.config, ...req.body };
  saveHome(req.params.slug, home);
  res.json({ ok: true });
});

app.post("/api/h/:slug/messages", auth, (req, res) => {
  const home = loadHome(req.params.slug);
  const body = String((req.body || {}).body || "").slice(0, 200).trim();
  const who = String((req.body || {}).who || "").slice(0, 12).trim() || "我";
  if (!body) return res.status(400).json({ error: "empty" });
  home.messages.unshift({ who, time: new Date().toLocaleString("zh-CN", { hour12: false }), body });
  if (home.messages.length > 200) home.messages.length = 200;
  saveHome(req.params.slug, home);
  res.json({ ok: true, messages: home.messages });
});

app.delete("/api/h/:slug/messages/:index", auth, (req, res) => {
  const home = loadHome(req.params.slug);
  const i = +req.params.index;
  if (i >= 0 && i < home.messages.length) {
    home.messages.splice(i, 1);
    saveHome(req.params.slug, home);
  }
  res.json({ ok: true, messages: home.messages });
});

/* ---------------- 页面 ---------------- */
app.get("/h/:slug", (req, res) => {
  const f = homeFile(req.params.slug);
  if (!f || !fs.existsSync(f)) return res.redirect("/?notfound=1");
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.listen(PORT, () => {
  console.log(`💕 情侣网站平台已启动: http://localhost:${PORT}`);
  console.log(`   情侣小窝地址格式: http://localhost:${PORT}/h/<编号>`);
});
