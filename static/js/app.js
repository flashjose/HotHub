/* ==========================================================================
   HotHub — Paper Sketch(纸绘手稿)
   Text-driven ranked list, DOM-persistent filtering, skeleton loading,
   dual theme (蓝图纸 / 夜间墨稿) with system preference detection.
   ========================================================================== */

// ------------------------------- Theme ------------------------------------
const THEME_KEY = "hothub-theme";

function getTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

function resolveTheme(stored) {
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setDOMTheme(resolved) {
  document.documentElement.setAttribute("data-theme", resolved);
}

function applyTheme(resolved) {
  setDOMTheme(resolved);
}

/** Ink-spread reveal: circle expands from the theme button */
function applyThemeInk(resolved, btn) {
  // Fall back to instant switch if View Transitions not supported
  if (!document.startViewTransition) {
    setDOMTheme(resolved);
    return;
  }

  // Capture the button's center as the circle origin
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // Radius = distance to the farthest corner of the viewport
  const r = Math.hypot(
    Math.max(cx, window.innerWidth - cx),
    Math.max(cy, window.innerHeight - cy)
  );

  // Old view snaps the outgoing theme, new view reveals the incoming theme
  const transition = document.startViewTransition(() => setDOMTheme(resolved));

  // Suppress default crossfade; use our clip-circle instead
  transition.ready.then(() => {
    document.documentElement.animate(
      [
        { clipPath: `circle(0 at ${cx}px ${cy}px)` },
        { clipPath: `circle(${r}px at ${cx}px ${cy}px)` }
      ],
      {
        duration: 800,
        easing: 'cubic-bezier(0.5, 0, 0.0, 1)',
        pseudoElement: '::view-transition-new(root)'
      }
    );
  });
}

let _themeBusy = false;

function toggleTheme() {
  if (_themeBusy) return;  // skip if animation still running
  _themeBusy = true;

  const current = getTheme();
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  localStorage.setItem(THEME_KEY, next);

  const btn = document.getElementById("btn-theme");
  applyThemeInk(resolveTheme(next), btn);

  // Unlock after animation completes
  setTimeout(() => { _themeBusy = false; }, 900);
}

function initTheme() {
  // On first load, apply instantly (no animation — page is still painting)
  setDOMTheme(resolveTheme(getTheme()));

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") setDOMTheme(resolveTheme("system"));
  });
}

// ------------------------------- State ------------------------------------
const PAGE_SIZE = 20;

const state = {
  platforms: [],
  allItems: [],            // enriched, interleaved by rank across platforms
  platformStatus: {},      // name -> source_status
  catFilter: "全部",
  platformFilter: "全部",
  page: 1,
};

// ------------------------------- Constants --------------------------------
const PLATFORM_COLORS = {
  zhihu: "#0066FF", weibo: "#E6162D", bilibili: "#FB7299",
  douyin: "#111111", toutiao: "#E13D3D", ithome: "#D9382B", baidu: "#2932E1",
};

const CATEGORIES = [
  { key: "AI", kw: ["ai", "人工智能", "大模型", "gpt", "chatgpt", "机器学习", "算法", "openai", "文心", "通义", "sora", "智能体", "deepseek"] },
  { key: "科技", kw: ["科技", "芯片", "半导体", "手机", "电脑", "华为", "苹果", "小米", "5g", "卫星", "发射", "量子", "机器人", "特斯拉", "显卡", "数码", "航天"] },
  { key: "互联网", kw: ["互联网", "阿里", "腾讯", "字节", "百度", "美团", "京东", "拼多多", "平台", "app", "直播", "电商", "抖音", "微信"] },
  { key: "财经", kw: ["财经", "股", "基金", "经济", "金融", "gdp", "房价", "楼市", "央行", "利率", "黄金", "上市", "融资", "收购", "美元", "汇率"] },
  { key: "娱乐", kw: ["娱乐", "明星", "电影", "电视剧", "综艺", "演唱会", "音乐", "票房", "网红", "偶像", "演员", "导演", "热搜"] },
  { key: "体育", kw: ["体育", "比赛", "足球", "篮球", "nba", "世界杯", "奥运", "冠军", "联赛", "球员", "夺冠", "决赛", "国足"] },
  { key: "社会", kw: [] },
];
const CAT_ORDER = ["全部", "科技", "AI", "互联网", "娱乐", "财经", "体育", "社会"];

const FLAME = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

// ------------------------------- DOM refs ---------------------------------
const $ = (s) => document.querySelector(s);
const dom = {
  catChips: $("#cat-chips"),
  platformChips: $("#platform-chips"),
  gallery: $("#gallery"),
  pager: $("#pager"),
  btnRefresh: $("#btn-refresh"),
  btnRetry: $("#btn-retry"),
  loading: $("#loading-state"),
  error: $("#error-state"),
  errorMsg: $("#error-msg"),
};

// ------------------------------- API layer --------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
  return res.json();
}

async function fetchPlatforms() {
  state.platforms = await api("/platforms");
}

async function fetchHotspots(refresh = false) {
  const data = await api(`/hotspots?limit=50${refresh ? "&refresh=true" : ""}`);
  const status = {};
  const groups = [];
  for (const plat of data.platforms) {
    status[plat.platform] = plat.source_status;
    groups.push(
      plat.items.map((item) => ({
        ...item,
        _displayName: plat.display_name,
        _color: PLATFORM_COLORS[item.platform] || "#737373",
        _cover: item.cover_url || null,
        _heat: parseHeat(item.score),
        _category: classify(item.title),
      }))
    );
  }
  // Interleave by rank so the unfiltered gallery reads as one aggregated feed
  const maxLen = groups.reduce((m, g) => Math.max(m, g.length), 0);
  const all = [];
  for (let i = 0; i < maxLen; i++) {
    for (const g of groups) if (g[i]) all.push(g[i]);
  }
  state.allItems = all;
  state.platformStatus = status;
}

// ------------------------------- Classify ---------------------------------
function classify(title) {
  const t = (title || "").toLowerCase();
  for (const c of CATEGORIES) {
    if (c.key === "社会") continue;
    if (c.kw.some((k) => t.includes(k))) return c.key;
  }
  return "社会";
}

// ------------------------------- Filters ----------------------------------
function renderCatChips() {
  const counts = {};
  CAT_ORDER.forEach((k) => (counts[k] = 0));
  for (const it of state.allItems) counts[it._category] = (counts[it._category] || 0) + 1;
  counts["全部"] = state.allItems.length;

  dom.catChips.innerHTML = CAT_ORDER.map((k) => {
    const active = state.catFilter === k ? " active" : "";
    return `<button class="chip${active}" data-cat="${esc(k)}">${esc(k)}<span class="chip-n">${counts[k] || 0}</span></button>`;
  }).join("");

  dom.catChips.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      state.catFilter = c.dataset.cat;
      state.page = 1;
      renderCatChips();
      renderGallery(true);
      renderPager();
    })
  );
}

function renderPlatformChips() {
  const total = state.allItems.length;
  let html = `<button class="chip${state.platformFilter === "全部" ? " active" : ""}" data-plat="全部">全部<span class="chip-n">${total}</span></button>`;
  for (const p of state.platforms) {
    const count = state.allItems.filter((it) => it.platform === p.name).length;
    const color = PLATFORM_COLORS[p.name] || "#737373";
    const active = state.platformFilter === p.name ? " active" : "";
    html += `<button class="chip${active}" data-plat="${esc(p.name)}"><i class="pdot" style="background:${color}"></i>${esc(p.display_name)}<span class="chip-n">${count}</span></button>`;
  }
  dom.platformChips.innerHTML = html;

  dom.platformChips.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      state.platformFilter = c.dataset.plat;
      state.page = 1;
      renderPlatformChips();
      renderGallery(true);
      renderPager();
    })
  );
}

// ------------------------------- Gallery ----------------------------------
function filteredItems() {
  let list = state.allItems;
  if (state.catFilter !== "全部") list = list.filter((it) => it._category === state.catFilter);
  if (state.platformFilter !== "全部") list = list.filter((it) => it.platform === state.platformFilter);
  return list;
}

function pageCount() {
  return Math.max(1, Math.ceil(filteredItems().length / PAGE_SIZE));
}

function pageItems() {
  const start = (state.page - 1) * PAGE_SIZE;
  return filteredItems().slice(start, start + PAGE_SIZE);
}

function goPage(p) {
  const total = pageCount();
  state.page = Math.max(1, Math.min(p, total));
  renderGallery(true);
  renderPager();
  // Scroll to top of gallery
  dom.gallery.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderGallery(forceRebuild) {
  const list = pageItems();
  const emptyEl = dom.gallery.querySelector(".g-empty");
  if (emptyEl) emptyEl.remove();

  if (!list.length) {
    dom.gallery.innerHTML = '<div class="g-empty">这一页还没有内容</div>';
    dom.pager.innerHTML = "";
    return;
  }

  // Always full rebuild for paginated views (clean state)
  dom.gallery.innerHTML = list.map((it, i) => cardHTML(it, i)).join("");
}

/** Pagination controls — hand-drawn: prev · N/M · next */
function renderPager() {
  const total = pageCount();
  if (total <= 1) { dom.pager.innerHTML = ""; return; }

  const p = state.page;
  let html = '<div class="pager-inner">';

  // Prev
  html += `<button class="pg-btn" ${p <= 1 ? "disabled" : ""} data-pg="${p - 1}" aria-label="上一页">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
  </button>`;

  // Page numbers
  html += '<span class="pg-nums">';
  const pages = buildPageRange(p, total);
  for (const x of pages) {
    if (x === "…") { html += '<span class="pg-dots">…</span>'; continue; }
    html += `<button class="pg-num${x === p ? " active" : ""}" data-pg="${x}">${x}</button>`;
  }
  html += '</span>';

  // Total indicator
  html += `<span class="pg-total">/ ${total}</span>`;

  // Next
  html += `<button class="pg-btn" ${p >= total ? "disabled" : ""} data-pg="${p + 1}" aria-label="下一页">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;

  html += '</div>';
  dom.pager.innerHTML = html;

  // Bind clicks
  dom.pager.querySelectorAll("[data-pg]").forEach((b) =>
    b.addEventListener("click", () => goPage(parseInt(b.dataset.pg, 10)))
  );
}

/** Build page range like: 1 … 4 5 6 … 12 */
function buildPageRange(p, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range = [];
  range.push(1);
  if (p > 3) range.push("…");
  for (let i = Math.max(2, p - 1); i <= Math.min(total - 1, p + 1); i++) range.push(i);
  if (p < total - 2) range.push("…");
  range.push(total);
  return range;
}

// ------------------------------- Card HTML --------------------------------
function cardHTML(it, i) {
  const rank = it.rank || i + 1;
  const topCls = rank <= 3 ? " top" : "";
  const heat = fmtScore(it.score);
  const cold = it._heat > 0 ? "" : " cold";
  const url = it.url || "#";
  const summary = it.summary && it.summary.trim();
  const showSum = summary && summary.length > 4 && !/^\d+$/.test(summary);

  // Route covers through backend proxy
  const cover = it._cover ? `/img?url=${encodeURIComponent(it._cover)}` : null;
  const thumbHTML = cover
    ? `<a class="g-thumb" href="${esc(url)}" target="_blank" rel="noopener" aria-hidden="true">
         <img src="${esc(cover)}" alt="" loading="lazy" decoding="async"
              onload="this.closest('.g-thumb').classList.add('loaded')"
              onerror="this.closest('.g-thumb').remove()">
       </a>`
    : "";

  return `
    <article class="g-card" style="--i:${i}" data-id="${esc(it.platform)}-${rank}">
      <span class="g-rank${topCls}">${rank}</span>
      <div class="g-body">
        <div class="g-head">
          <a class="g-title" href="${esc(url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          <span class="g-plat"><i class="pdot" style="background:${it._color}"></i>${esc(it._displayName || it.platform)}</span>
        </div>
        <div class="g-sub">
          ${showSum ? `<span class="g-sum">${esc(summary)}</span>` : '<span class="g-sum"></span>'}
          <span class="g-heat${cold}">${FLAME}${heat || "—"}</span>
        </div>
      </div>
      ${thumbHTML}
    </article>`;
}

// ------------------------------- Helpers ----------------------------------
function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtScore(score) {
  if (score == null || String(score).trim() === "") return "";
  const s = String(score).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n >= 1e8) return (n / 1e8).toFixed(1) + "亿";
    if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return s;
  }
  return s;
}
function parseHeat(score) {
  if (score == null) return 0;
  if (typeof score === "number") return score;
  const m = String(score).match(/([\d.,]+)\s*(亿|万|w|W)?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return 0;
  if (m[2] === "亿") n *= 1e8;
  else if (m[2] === "万" || m[2] === "w" || m[2] === "W") n *= 1e4;
  return n;
}

// ------------------------------- Skeleton --------------------------------
function renderSkeletons(count) {
  count = count || 8;
  dom.gallery.innerHTML = Array.from({ length: count }, () => `
    <article class="g-card skeleton" aria-hidden="true">
      <span class="g-rank"></span>
      <div class="g-body">
        <div class="sk-line sk-title"></div>
        <div class="sk-line sk-sum"></div>
      </div>
    </article>
  `).join("");
}

// ------------------------------- Render / Init ---------------------------
function renderAll() {
  state.page = 1;
  renderCatChips();
  renderPlatformChips();
  renderGallery(true);
  renderPager();
}

function showError(err) {
  dom.loading.hidden = true;
  dom.error.hidden = false;
  dom.errorMsg.textContent = (err && err.message) || "数据加载失败";
}

async function refreshAll() {
  dom.btnRefresh.disabled = true;
  dom.btnRefresh.classList.add("spinning");
  try {
    await fetchHotspots(true);
    renderAll();
  } catch (err) {
    showError(err);
  } finally {
    dom.btnRefresh.disabled = false;
    dom.btnRefresh.classList.remove("spinning");
  }
}

async function init() {
  dom.loading.hidden = true;  // never show spinner — skeletons instead
  renderSkeletons(8);
  try {
    await Promise.all([fetchPlatforms(), fetchHotspots(false)]);
    renderAll();
  } catch (err) {
    showError(err);
  }
}

// ------------------------------- Init -----------------------------------
initTheme();
document.getElementById("btn-theme").addEventListener("click", toggleTheme);

dom.btnRefresh.addEventListener("click", refreshAll);
dom.btnRetry.addEventListener("click", init);

init();
