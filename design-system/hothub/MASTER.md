# HotHub 设计系统 — MASTER(全局唯一事实源)

> 风格定位:**Paper Sketch 纸绘手稿**
> 更新于 2026-08-27。对标 `paper-universe` 项目的纸绘视觉语言。
> 核心:纸张纹理底 + 撕纸纸片 + **噪声位移的铅笔线** + 手绘不规则几何 + 马克笔/手写体点睛。
> 布局:文字驱动排名列表,**每条热榜是一张独立小纸片**。
> 双主题:蓝图纸(亮) / 夜间墨稿(暗),墨扩散 View Transition 切换。

## 1. 设计哲学

- **纸绘手稿**:界面是一叠手写笔记。纹理、笔迹、撕边、微角度歪斜共同制造"手做感"。
- **不规则即真实**:没有一条边是数学完美的。圆角走 `8px 12px 7px 11px / ...` 这类八值语法,圆形走 `50% 46% 52% 48% / ...`。
- **旋转是结构,不是装饰**:纸片交错 ±0.5deg,hover 时归零摊平 —— "把纸拿起来看"。
- **手写体只用于装饰位**:品牌名、排名、页码、标签、热度数字。**列表正文必须是可读无衬线** —— 50+ 条 13-16px 密集中文标题不牺牲可读性。
- **描边取代阴影**:层次靠铅笔线 + 单向纸质投影,不用柔光双向阴影。

## 2. 色彩令牌 — 蓝图纸(Light,默认)

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` | `#d9eaf8` | 页面底(蓝图纸) |
| `--paper-card` | `#eaf3fb` | 纸片表面(比底色亮,浮在格线之上) |
| `--paper-deep` | `#c4dbed` | 内嵌底、缩略图框底 |
| `--paper-shadow` | `#b4c8d7` | 折痕、滚动条、shimmer 暗端 |
| `--ink` | `#1a1814` | 主文本 |
| `--ink-soft` | `#2c2823` | 次要文本 |
| `--ink-pale` | `#5a534a` | 辅助信息 |
| `--pencil` | `#6b7f96` | 铅笔描边(全站唯一边框色) |
| `--accent` | `#b8442e` | 锈红:强调、top-3、选中 chip、热度火焰 |
| `--accent-blue` | `#2d4a7a` | 墨蓝:链接、平台标签、分区标签 |
| `--danger` | `#b8442e` | 错误态(复用锈红) |
| `--ring` | `#b8442e` | 焦点环 |
| `--drop` | `rgba(40,30,10,.18)` | 纸质投影 |
| `--drop-lift` | `rgba(40,30,10,.28)` | 抬纸时加深投影 |

## 3. 色彩令牌 — 夜间墨稿(Dark)

| 令牌 | 值 | 用途 |
|---|---|---|
| `--paper` | `#151a20` | 深墨底 |
| `--paper-card` | `#1f262e` | 纸片表面(比 `--paper` 亮 —— 暗色下卡片全靠这点差值+铅笔线立住) |
| `--paper-deep` | `#10141a` | 内嵌底 |
| `--paper-shadow` | `#2a323c` | 折痕 |
| `--ink` | `#e8e2d4` | 白垩字迹(**暖白,非纯白**) |
| `--ink-soft` | `#c3bcae` | 次要文本 |
| `--ink-pale` | `#8e887c` | 辅助信息 |
| `--pencil` | `#6b7f96` | 铅笔描边(与亮色同值 —— 冷调在两边都成立) |
| `--accent` | `#e0705a` | 提亮锈红(`#b8442e` 在深底上对比度不足) |
| `--accent-blue` | `#8fb4e0` | 提亮墨蓝 |
| `--danger` | `#e0705a` | 错误态 |
| `--drop` | `rgba(0,0,0,.45)` | 纸质投影 |
| `--drop-lift` | `rgba(0,0,0,.62)` | 抬纸投影 |

**`@media (prefers-color-scheme: dark)` 防闪块必须与 `[data-theme="dark"]` 逐值同步。** 任何一处改动都要同时改两处,否则首屏会闪。

## 4. 纸张纹理(三层)

| 层 | 实现 | 说明 |
|---|---|---|
| `body` 背景 | 四角暗角 `radial-gradient` + 双向纤维斜纹 `repeating-linear-gradient(37deg/127deg)` | `background-attachment: fixed` |
| `body::before` | `feTurbulence fractalNoise` data-URI,`position: fixed; z-index: 1` | 亮色 `mix-blend-mode: multiply` / opacity `.55`;**暗色改 `soft-light` / opacity `.35`**(multiply 叠深底不可见) |
| `body::after` | 20px 方格线 + `mask-image: radial-gradient(ellipse, black 30%, transparent 90%)` | 中心清晰、四周淡出 |

- 纹理层是 `z-index: 1` fixed,**`.app` 必须 `position: relative; z-index: 2`**,否则噪点盖在内容上。
- 纸片背景不透明会盖住页面颗粒,所以 `.site-header` / `.site-foot` / `.g-card` 各自带一层更细的 feTurbulence `background-image`(`baseFrequency: .9`,alpha `.055`),叠在 `--paper-card` 之上。

## 5. 手绘线条(roughen 滤镜)

CSS 的 `border` 是数学直线,这是"印刷"而非"手绘"的最大破绽。用 `feTurbulence` + `feDisplacementMap` 把边缘按分形噪声位移,直线就变成有抖动的铅笔线。

`index.html` 里挂一个离屏 `<svg class="sketch-defs">`,内含两个滤镜:

| 滤镜 | `baseFrequency` / `scale` | 用在哪 |
|---|---|---|
| `#rough-lo` | `.021` / `4.5`(波长约 45px,±2.25px 抖动) | 大面积:header/footer 外壳、纸片内规线、空态框 |
| `#rough-hi` | `.055` / `2.6`(±1.3px) | 小部件:排名第二圈、分区标签马克笔 |

**铁律:roughen 滤镜只能加在"纯描边的伪元素"上,绝不能加在含文字的盒子上** —— `feDisplacementMap` 会把 13-16px 的密集中文标题揉烂。所以 header/footer/纸片的 `border` 全部从元素本体移到 `::before`,本体只留 `background` 和 `padding`。

- 共用基底:`.site-header::before, .site-foot::before, .g-card::before, .g-empty::before { position: absolute; inset: 0; border-radius: inherit; filter: url(#rough-lo) }`,各自再补 `border` 值。
- 宿主必须是**绝对定位包含块**。`filter` 会自建包含块,所以带 `drop-shadow` 的纸面天然满足;`.g-empty` / `.filter-label` / `.g-rank` 没有 filter,**必须显式补 `position: relative`**。
- `url(#id)` 这类纯片段引用按规范解析到**文档**而非样式表 —— 因此**不能给页面加 `<base>` 标签**,否则全站手绘线静默失效(降级成直线,不会报错)。
- **滤镜区域要放得下位移量**:区域按边框盒 `y="-14%" height="128%"` 外扩,所以宿主高度必须 ≥ 位移量 ÷ 14%(`#rough-lo` 约 16px、`#rough-hi` 约 10px)。**只有 `border-top` 的零高度盒子会被裁成断线** —— `.filters::after` 那道分隔线因此不上滤镜,靠 `dashed` 自己撑手绘感。
- 不支持的浏览器只是拿不到抖动,布局与描边本身不受影响。

## 6. 字体(混排规则)

| 栈 | 定义 | 用在哪 |
|---|---|---|
| `--font-marker` | `"Permanent Marker","Zhi Mang Xing","Caveat",cursive` | 品牌名、top-3 排名、激活页码 |
| `--font-hand` | `"Caveat","Zhi Mang Xing","Patrick Hand",cursive` | 品牌副标、分区标签、chip、普通排名、平台标签、热度、页码、footer、空态/错误态 |
| `--font-body` | `"Inter","PingFang SC","HarmonyOS Sans SC","MiSans","Microsoft YaHei",system-ui,sans-serif` | **列表标题、摘要、计数徽标** |

- `Caveat` / `Permanent Marker` **无中文字形**,所以 `Zhi Mang Xing` 必须在同一 stack 内兜底。
- 手写体的视觉字号偏小,同等观感需比无衬线**大 3-4px**:正文 14px ↔ 手写 17-18px。
- 字号层级:列表标题 16px/600/lh1.6、摘要 12px、热度 18px 手写 tabular、品牌名 27px 马克笔、分区标签 19px 手写。

## 7. 间距与手绘几何

- 间距梯度:`8 / 12 / 14 / 18 / 26 / 34`
- 纸片内边距:`15px 18px`;纸片间距 `gap: 12px`
- **手绘圆角**:`--radius-hand: 8px 12px 7px 11px / 11px 7px 12px 8px`
- **窄屏圆角**:`--radius-hand-sm: 5px 8px 4px 7px / 7px 4px 8px 5px`
- **手绘圆形**:`--radius-blob: 50% 46% 52% 48% / 48% 52% 46% 52%`(徽标、主题按钮、排名圈、页码、spinner)
- **撕纸边**:`--torn: polygon(1% .5%, 99% 1.2%, 99.6% 50%, 98.8% 99.4%, .8% 98.8%, .4% 49%)`
- 容器 `max-width: 1200px`;`.gallery` 左右留 `padding: 0 4px` 吸收旋转外扩
- 骨架屏 `.sk-line` 也走八值圆角(`6px 9px 5px 8px / …`),不留一处印刷圆角

## 8. 表面与效果

- **描边**:`1.2px` (平台标签) / `1.4px` (纸片内规线、排名、缩略图、页码) / `1.6px` (header/footer 外壳、按钮、chip) `solid var(--pencil)`;chip 与空态框用 `dashed`
  > header/footer/纸片的描边**画在 `::before` 上**并过 roughen 滤镜(见 §5);其余小部件保留本体 `border`(尺寸太小,抖动看不出来,不值那份滤镜开销)。
- **投影**:统一 `filter: drop-shadow(-3px 5px 10px var(--drop))` —— 左上打光的单向纸质投影
  > **`clip-path` 会一并裁掉 `box-shadow`**。撕纸纸片必须用 `filter: drop-shadow()`,它在裁剪之后应用,投影贴合撕纸轮廓。这是 `paper-universe` 自己踩过的坑。
- **旋转**:纸片 `:nth-child(3n+1/3n+2/3n)` → `.35deg / -.45deg / .25deg`;chip、页码同法交错;header `-0.4deg`、footer `0.35deg`
- **三属性分层(纸片专用)**:倾斜走独立 `rotate`、入场位移走独立 `translate`、hover 抬起走 `transform`。
  > 三者是**互不覆盖的独立属性**。入场动画带 `both` 填充,若它和 hover 抢同一个 `transform`,填充值会永久压死 hover —— 分层是这里唯一能同时保住"发牌入场"和"拿起纸片"的写法。
- **hover**:归零旋转 + `translateY(-2px)` + 加深投影("把纸拿起来");内规线提亮到 `.8`;排名第二圈反向甩到 `8deg`;缩略图反向倾斜 + 边框转 `--accent`
- **`filter` 自建层叠上下文与绝对定位包含块**,带 `drop-shadow` 的纸面不需要额外 `position: relative`
- **波浪下划线**:`text-decoration: underline wavy var(--accent) 1.2px` 用于标题 hover
- **马克笔涂抹**:`.filter-label::before` 一道 `--accent-blue` 22% 的歪斜色块,`z-index: -1` 垫在分区标签字下,`bottom` 锚定(字号跨断点变化时不脱位)
- **胶带**:`.g-thumb::after` 一条 `--ink` 9% 的半透明纸带斜贴在缩略图上沿,被 `overflow: hidden` 裁成半条 —— 暗色下自动翻成白垩色
- **SVG 墨迹**:`.ink-stroke` / `.ink-stroke--soft` + `.draw-on`(`stroke-dashoffset` 绘制动画),用于品牌名下的手绘下划线
- **过渡**:`--ease: cubic-bezier(.22,1,.36,1)`,时长 `.18s`-`.25s`

## 9. 布局:每行一张纸片

- `.gallery` 是**透明的 flex 纵向堆叠**(`gap: 12px`),不是容器 —— 无边框、无投影、**无 `overflow: hidden`**(会裁掉旋转和投影)
- 每行:`[排名圈 38×38] — [文字 flex:1] — [可选缩略图 92×70]`
- **纸片内规线**:`.g-card::before` 一圈 `1.4px` 铅笔线,`opacity: .5`,`inset: 5px 11px`
  > 撕纸多边形左右最深咬进 1%(桌面宽度约 11px),内规线**必须内缩到咬痕之外**,否则会被 `clip-path` 削掉。上下只咬约 1px,所以 `5px` 足够。视觉上是"在纸片里框了一个方框",正是手账的画法。
- **排名圈画两圈**:本体一圈 blob 铅笔线,`::after` 再套一圈**不同 blob 值 + `-14deg`** 的偏移环 —— 手工圈数字时的重描过冲。top-3 的第二圈转 `--accent`
- 入场:纸片按 `--i`(JS 逐条写入)错开 `20ms` 发牌落桌,`translate: 0 -7px → 0`
- 标题:2 行截断,16px/600,`--font-body`,hover 转锈红 + 波浪下划线
- 缩略图:右对齐,`rotate(-1.2deg)`,hover 反转到 `1deg`
- 无图条目:文字占满宽度,无空白占位
- 筛选区收尾一道 `.filters::after` 虚线铅笔分隔线(零高度盒子,不上滤镜 —— 见 §5)
- 空态是一个虚线手绘方框,不是裸文字

## 10. 双主题与切换

- 默认跟随 `prefers-color-scheme`;三态循环 `system → light → dark → system`
- 写入 `localStorage("hothub-theme")`,`<html data-theme="dark">` 触发覆盖
- **墨扩散切换**:`document.startViewTransition()` + `clipPath: circle(0 → R)` 从主题按钮中心洇开,800ms `cubic-bezier(.5,0,0,1)` —— 墨滴在纸上扩散
- 首屏 `setDOMTheme()` 直接应用不走动画;切换期间 `_themeBusy` 锁 900ms
- 图标:Sun/Moon 描边 SVG,按主题互斥显示

## 11. 响应式降级

| 断点 | 降级 |
|---|---|
| `1024px` | 仅收紧 `.app` padding |
| `768px` | 筛选行改纵向;纸片、缩略图、排名圈全面缩小 |
| `480px` | **关闭全部旋转与撕纸 `clip-path`**(窄屏下撕边吃掉过多可用宽度),改用 `--radius-hand-sm` + 描边 + 投影;内规线跟着收到 `inset: 4px 5px`(没有咬痕要躲了);胶带缩到 24×12;按钮转纯图标;摘要隐藏 |
| `360px` | 极限压缩尺寸,保持 44px 触摸目标的例外仅在此断点放宽 |

`prefers-reduced-motion` 下**旋转也要归零**(含 `rotate` 独立属性和排名第二圈)—— 静态歪斜对眩晕敏感用户同样不适。
**同时必须 `animation-delay: 0ms !important`** —— 只压 `animation-duration` 的话,发牌错峰仍在,末条纸片会白白隐身 400ms。

## 12. 反模式

- 柔光双向阴影(新拟态 `--neu-out` / `--neu-in` 一类)
- **中文正文用手写体**(志莽行在 13-16px 密集列表下辨识度崩坏)
- **roughen 滤镜加在含文字的盒子上**(位移会揉烂密集中文标题;只许加在纯描边伪元素上)
- 给页面加 `<base>` 标签(会打断 `filter: url(#…)` 的片段引用)
- 入场动画和 hover 抢同一个 `transform`(`both` 填充会压死 hover)
- 规整的单值 `border-radius`(`16px` / `50%` 一类)—— 必须用八值手绘语法
- `box-shadow` 与 `clip-path` 同时用(投影会被裁掉)
- `.gallery` 上加 `overflow: hidden`
- 纯白 `#fff` 作为暗色主题文本(要用暖白垩 `#e8e2d4`)
- 彩色渐变、玻璃拟态、霓虹发光
- 无图条目留空占位
