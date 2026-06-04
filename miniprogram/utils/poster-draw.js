// utils/poster-draw.js
// Canvas 海报绘制主逻辑。宽固定 750 px (2x retina)，高度根据内容动态计算。
//
// 设计原则：所有间距走统一网格系统，参照 docs/references/share-posters-emerald.html
// 参考稿是 375×667 (1x)，本文件 2x。
// canvas 高度 = Hero(540) + 各 section 实际高度（依据数据）+ Footer(100)
// → 短内容海报短，长内容海报长，永远不空也永远不撞
//
// 入口：drawPoster(ctx, canvas, data)
//   data: { type, tournament, me, userStats, highlight, style }
//   type: 'report' | 'personal'

const W = 750;
// 默认高度（导出时实际 canvas.height 由 computeCanvasH 算出，可能更大或更小）
const H_DEFAULT = 1600;

// === 网格系统（canvas px，全部 2x 于参考稿）===
const SIDE = 56;            // 28 × 2 — section 左右内边距
const HAIRLINE = 2;         // 1 × 2 — 分隔线
const HERO_H = 540;         // ~270 × 2 — hero 高度
const HERO_PAD_TOP = 72;    // 36 × 2
const HERO_PAD_BOT = 56;    // 28 × 2
const SECTION_PAD_Y = 40;   // section 上下内边距
const FOOT_H = 140;         // footer 高度（含二维码）
const FOOT_GAP = 32;        // roster/history 末端到 footer 的间距

// === Typography（canvas px）===
const T = {
  wordmark: 26,    // 13 × 2 — 顶部品牌名
  kicker: 20,      // 10 × 2 — section eyebrow / 强调小字
  title: 60,       // 30 × 2 — hero 大标题（参考 32px 但稍小防换行）
  metaRow: 20,     // 10 × 2 — hero 下面的 meta 行
  eyebrow: 19,     // 9.5 × 2 — section 小标
  bigVal: 56,      // 28 × 2 — Big-Four 主数字
  bigLbl: 18,      // 9 × 2 — Big-Four 标签
  bigSub: 20,      // 10 × 2 — Big-Four 副文案
  podiumName: 28,  // 14 × 2 — podium 名字
  podiumPts: 20,   // 10 × 2 — podium 积分
  rank: 18,        // 9 × 2 — podium 排名
  statN: 44,       // 22 × 2 — stats 大数
  statL: 18,       // 9 × 2 — stats 标签
  hlContent: 34,   // 17 × 2 — highlight 主文案
  hlDetail: 20,    // 10 × 2 — highlight 副文案
  histRound: 18,   // 9 × 2 — match round
  histOpp: 26,     // 13 × 2 — opponent name
  histScore: 28,   // 14 × 2 — score
  rosterName: 22,  // 11 × 2 — roster name
  footEy: 18,      // 9 × 2 — footer eyebrow
  footHd: 28       // 14 × 2 — footer head
};

// ====== 基础工具 ======

function clear(ctx, style, h) {
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, W, h);
}

function drawHeroBg(ctx, style) {
  const g = ctx.createLinearGradient(0, 0, 0, HERO_H);
  g.addColorStop(0, style.heroBg[0]);
  g.addColorStop(1, style.heroBg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HERO_H);
  if (style.showCourtLines) drawCourtLines(ctx, style);
}

function drawCourtLines(ctx, style) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = style.heroFg;
  ctx.lineWidth = 2;
  // 外框（双打边线 + 底线）
  ctx.strokeRect(84, -80, 582, 520);
  // 中线（贯穿整个球场）
  ctx.beginPath(); ctx.moveTo(376, -80); ctx.lineTo(376, 440); ctx.stroke();
  // 发球线 — 只在两条单打边线之间，不延伸到双打边线
  ctx.beginPath(); ctx.moveTo(120, 280); ctx.lineTo(632, 280); ctx.stroke();
  // 单打边线（左右各一）
  ctx.beginPath(); ctx.moveTo(120, -80); ctx.lineTo(120, 440); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(632, -80); ctx.lineTo(632, 440); ctx.stroke();
  ctx.restore();
}

function setFont(ctx, size, weight, family) {
  ctx.font = `${weight || 'normal'} ${size}px ${family}`;
}

function fillText(ctx, text, x, y, opts) {
  const o = opts || {};
  if (o.color) ctx.fillStyle = o.color;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.fillText(text, x, y);
}

function drawHairline(ctx, y, style) {
  ctx.save();
  ctx.fillStyle = style.border;
  ctx.fillRect(SIDE, y, W - SIDE * 2, HAIRLINE);
  ctx.restore();
}

// 圆形 avatar
// opts.image: 已加载完成的 canvas Image 对象（来自 preloadAvatars）
//   - 有：clip 圆 + drawImage（cover），外加描边
//   - 无：回退到首字母 + 背景填充（与原版一致）
function drawAvatar(ctx, cx, cy, r, name, opts) {
  const o = opts || {};
  if (o.image) {
    // 1) clip 圆形区域 → drawImage cover 充满
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(o.image, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    // 2) 描边（在 clip 之外画，否则会被裁掉一半）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = o.borderWidth || 2;
    ctx.strokeStyle = o.border || '#fff';
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 回退：首字母版本（原版）
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fill();
  }
  ctx.lineWidth = o.borderWidth || 2;
  ctx.strokeStyle = o.border || '#fff';
  ctx.stroke();

  ctx.fillStyle = o.fg || '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, Math.round(r * 0.95), o.fontWeight || '500', o.font || 'PingFang SC');
  ctx.fillText((name || '?').charAt(0), cx, cy + 2);
  ctx.restore();
}

// 批量预加载头像 → openid 索引的 canvas Image map
//   canvas: type=2d 的 canvas 节点（用 canvas.createImage()）
//   openidToUrl: { [openid]: 'cloud://...' | 'https://...' | '' }
//   返回 Promise<{ [openid]: Image }>，失败的项不会出现在结果里（渲染时回退首字母）
//
// 健壮性：
//   - 每张图最多 6 秒超时（避免单张挂死整个流程）
//   - 单张失败不影响其它（个别人的头像挂掉不影响整张海报）
//   - 详细日志，便于定位
function preloadAvatars(canvas, openidToUrl) {
  const result = {};
  if (!canvas || !openidToUrl) return Promise.resolve(result);

  const entries = Object.entries(openidToUrl).filter(([, url]) => !!url);
  if (entries.length === 0) {
    return Promise.resolve(result);
  }

  const PER_IMAGE_TIMEOUT = 6000;

  return Promise.all(entries.map(([openid, url]) => {
    return withTimeout(
      resolveLocalPath(url).then(localPath => loadCanvasImage(canvas, localPath)),
      PER_IMAGE_TIMEOUT,
      `avatar ${openid}`
    )
      .then(img => {
        result[openid] = img;
      })
      .catch(err => {
        console.warn('[poster] avatar load failed', openid, url, err && (err.errMsg || err.message));
      });
  })).then(() => {
    return result;
  });
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`timeout ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      val => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// cloud:// → 本地 wxfile://（以便给 canvas createImage().src）
// https / wxfile / 本地路径 → 直接返回
function resolveLocalPath(url) {
  if (typeof url !== 'string') return Promise.reject(new Error('bad url'));
  if (url.startsWith('cloud://')) {
    return new Promise((resolve, reject) => {
      wx.cloud.downloadFile({
        fileID: url,
        success: res => resolve(res.tempFilePath),
        fail: reject
      });
    });
  }
  return Promise.resolve(url);
}

function loadCanvasImage(canvas, localPath) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = e => reject(e || new Error('image load error'));
    img.src = localPath;
  });
}

// 文本省略
function ellipsize(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 0 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

// 按字符切分换行（中英文混合）
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const out = [];
  let cur = '';
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      out.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// 多行 wrap + 最后一行省略（用于 hero 标题等强样式文本）
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines, opts) {
  const o = opts || {};
  if (o.color) ctx.fillStyle = o.color;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'top';
  if (!text) return y;
  const lines = wrapText(ctx, text, maxWidth);
  const limit = Math.max(1, maxLines || 1);
  const renderLines = lines.slice(0, limit);
  if (lines.length > limit) {
    let last = renderLines[limit - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1);
    }
    renderLines[limit - 1] = last + '…';
  }
  renderLines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  return y + renderLines.length * lineHeight;
}

// ====== Hero（共享）======

function drawBrandLine(ctx, y, style) {
  setFont(ctx, T.wordmark, '500', style.fontDisplay);
  fillText(ctx, '腾讯广州网球社', SIDE, y, {
    color: style.heroFg, baseline: 'top'
  });
  // 右侧 crest 圆形 T·GZ
  const crestR = 28;
  const crestCx = W - SIDE - crestR;
  const crestCy = y + crestR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(crestCx, crestCy, crestR, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.accent;
  ctx.stroke();
  setFont(ctx, 24, '500', style.fontDisplay);
  fillText(ctx, 'T', crestCx, crestCy + 4, {
    color: style.accent, align: 'center', baseline: 'middle'
  });
  ctx.restore();
}

// 短横 + accent 文字 eyebrow（hero 内用）
function drawHeroKicker(ctx, y, style, text) {
  // 左侧短横
  ctx.save();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SIDE, y);
  ctx.lineTo(SIDE + 32, y);
  ctx.stroke();
  ctx.restore();
  setFont(ctx, T.kicker, 'normal', style.fontMono);
  fillText(ctx, text, SIDE + 50, y, {
    color: style.accent, baseline: 'middle'
  });
}

// ====== Personal Poster ======

function drawPersonalPoster(ctx, data, canvasH) {
  const t = data.tournament || {};
  const me = data.me || {};
  const stats = data.userStats || {};
  const hl = data.highlight;
  const s = data.style;
  const avatarMap = data.avatarMap || {};

  clear(ctx, s, canvasH);
  drawHeroBg(ctx, s);

  // === Hero ===
  // 1) 品牌行
  drawBrandLine(ctx, HERO_PAD_TOP, s);

  // 2) 身份行（avatar + name + role）放在 hero 中段
  const idY = HERO_PAD_TOP + 70;
  const avR = 50;
  drawAvatar(ctx, SIDE + avR, idY + avR, avR, me.wecomName, {
    image: avatarMap[me.openid],
    bg: 'rgba(255, 255, 255, 0.06)',
    border: style0(s).accent,
    borderWidth: 3,
    fg: s.heroFg,
    font: s.fontDisplay
  });
  // name
  setFont(ctx, 50, '500', s.fontDisplay);
  fillText(ctx, ellipsize(ctx, me.wecomName || '球员', W - SIDE * 2 - avR * 2 - 36),
    SIDE + avR * 2 + 24, idY + avR - 8,
    { color: s.heroFg, baseline: 'middle' });
  // role 行（mono accent + ntrp）
  setFont(ctx, T.kicker, 'normal', s.fontMono);
  const ratingTxt = me.rating ? `NTRP ${me.rating}` : '未评级';
  const eloTxt = `ELO ${me.eloRating || 1500}`;
  fillText(ctx, `${ratingTxt}  ·  ${eloTxt}`,
    SIDE + avR * 2 + 24, idY + avR + 32,
    { color: s.heroMuted, baseline: 'middle' });

  // 3) 赛事引用行（hero 底部）
  const refY = HERO_H - HERO_PAD_BOT;
  drawHeroKicker(ctx, refY - 28, s, 'TOURNAMENT · 本次赛事');
  setFont(ctx, T.metaRow, 'normal', s.fontMono);
  const dateTxt = t._dateStr || '';
  const placementTxt = stats.placementText && stats.placementText !== '—'
    ? ` · ${stats.placementText}` : '';
  fillText(ctx, ellipsize(ctx, `${t.title || ''}${placementTxt}  ·  ${dateTxt}`, W - SIDE * 2),
    SIDE, refY + 6, { color: s.heroMuted, baseline: 'top' });

  // === Section: Big Four (2×2) ===
  let y = HERO_H;
  y = drawSectionEyebrow(ctx, y, s, 'STATS · 本次成绩');
  y = drawBigFour(ctx, y, s, stats);
  y += SECTION_PAD_Y;
  drawHairline(ctx, y, s);
  y += HAIRLINE;

  // === Section: Highlight ===
  y = drawSectionEyebrow(ctx, y, s, 'HIGHLIGHT · 高光时刻', s.accent);
  y = drawHighlight(ctx, y, s, hl);
  y += SECTION_PAD_Y;
  drawHairline(ctx, y, s);
  y += HAIRLINE;

  // === Section: Match History ===
  y = drawSectionEyebrow(ctx, y, s, `MATCHES · ${(stats.matches || []).length} 场记录`);
  y = drawHistory(ctx, y, s, stats.matches || []);

  // === Footer === （位置由 canvasH 决定，紧贴底部）
  drawFooter(ctx, s, canvasH - FOOT_H, data.qrImage);
}

// 安全访问 style.accent 等（兜底）
function style0(s) {
  return s || { accent: '#b8964a' };
}

// 通用 section eyebrow（mono 小标）
function drawSectionEyebrow(ctx, y, style, text, color) {
  const top = y + SECTION_PAD_Y;
  setFont(ctx, T.eyebrow, 'normal', style.fontMono);
  fillText(ctx, text, SIDE, top, {
    color: color || style.muted, baseline: 'top'
  });
  return top + T.eyebrow + 28; // 让出 eyebrow 自身高度 + 28 px gap
}

// Big Four (2×2 cell grid)
function drawBigFour(ctx, y, style, stats) {
  const colW = (W - SIDE * 2) / 2;
  const cellH = 130;
  const items = [
    { lbl: '名次', val: stats.placementText || '—' },
    { lbl: '获得积分', val: (stats.pointsEarned >= 0 ? '+' : '') + (stats.pointsEarned || 0) },
    { lbl: 'ELO 变化', val: (stats.eloChange >= 0 ? '+' : '') + (stats.eloChange || 0) },
    { lbl: '战绩 W-L', val: `${stats.wins || 0}-${stats.losses || 0}` }
  ];
  items.forEach((it, i) => {
    const cx = SIDE + (i % 2) * colW;
    const cy = y + Math.floor(i / 2) * cellH;
    setFont(ctx, T.bigLbl, 'normal', style.fontMono);
    fillText(ctx, it.lbl.toUpperCase(), cx, cy, {
      color: style.muted, baseline: 'top'
    });
    // 主数字 — 正/负值用语义色
    const valStr = String(it.val);
    let valColor = style.fg;
    if ((it.lbl === '获得积分' || it.lbl === 'ELO 变化') && /^\+/.test(valStr) && parseInt(valStr.replace(/[^\d-]/g, ''), 10) > 0) {
      valColor = style.positive;
    }
    setFont(ctx, T.bigVal, '500', style.fontDisplay);
    fillText(ctx, valStr, cx, cy + 38, {
      color: valColor, baseline: 'top'
    });
  });
  return y + cellH * 2 - 30; // 略缩末行 padding
}

// Highlight 区
function drawHighlight(ctx, y, style, hl) {
  if (!hl) return y;
  // 主文案（display 字体，多行）
  setFont(ctx, T.hlContent, '500', style.fontDisplay);
  ctx.fillStyle = style.fg;
  const lines = wrapText(ctx, hl.detail || hl.title || '', W - SIDE * 2);
  let ly = y;
  lines.slice(0, 3).forEach(line => {
    fillText(ctx, line, SIDE, ly, { color: style.fg, baseline: 'top' });
    ly += T.hlContent + 8;
  });
  // 副文案（score / 标签）
  if (hl.score) {
    setFont(ctx, T.hlDetail, 'normal', style.fontMono);
    fillText(ctx, `SCORE  ${hl.score}`, SIDE, ly + 8, {
      color: style.muted, baseline: 'top'
    });
    ly += T.hlDetail + 16;
  }
  return ly;
}

// 比赛记录（每行 dot + round + opponent + score）
function drawHistory(ctx, y, style, matches) {
  const rowH = 60;
  const maxRows = 6;
  const list = matches.slice(0, maxRows);
  let ry = y;
  list.forEach((m, i) => {
    // 圆点 — 视觉中心 = row 中心 (ry + rowH/2 = ry + 30)
    ctx.beginPath();
    ctx.arc(SIDE + 6, ry + 30, 6, 0, Math.PI * 2);
    ctx.fillStyle = m.win ? style.positive : style.muted;
    ctx.fill();
    // round (mono) — middle baseline，y 对齐到 row 中心
    setFont(ctx, T.histRound, 'normal', style.fontMono);
    fillText(ctx, (m.round || '').toUpperCase().slice(0, 5), SIDE + 92, ry + 30, {
      color: style.muted, baseline: 'middle', align: 'right'
    });
    // opponent — middle baseline，y 对齐到 row 中心
    setFont(ctx, T.histOpp, 'normal', style.fontDisplay);
    fillText(ctx, ellipsize(ctx, m.opponentName || '—', W - SIDE * 2 - 220),
      SIDE + 108, ry + 30, { color: style.fg, baseline: 'middle' });
    // score — middle baseline，y 对齐到 row 中心
    setFont(ctx, T.histScore, '500', style.fontMono);
    fillText(ctx, m.scoreText || '—', W - SIDE, ry + 30, {
      color: m.win ? style.fg : style.muted, align: 'right', baseline: 'middle'
    });
    // 分隔线
    if (i < list.length - 1) {
      ctx.fillStyle = style.border;
      ctx.fillRect(SIDE, ry + rowH - 1, W - SIDE * 2, 1);
    }
    ry += rowH;
  });
  if (matches.length > maxRows) {
    setFont(ctx, T.bigLbl, 'normal', style.fontMono);
    fillText(ctx, `+${matches.length - maxRows} MORE`, W - SIDE, ry + 8, {
      color: style.muted, align: 'right', baseline: 'top'
    });
    ry += 40;
  }
  return ry;
}

// ====== Report Poster ======

function drawReportPoster(ctx, data, canvasH) {
  const t = data.tournament || {};
  const s = data.style;
  const rs = t._reportStats || {};
  const avatarMap = data.avatarMap || {};

  clear(ctx, s, canvasH);
  drawHeroBg(ctx, s);

  // === Hero ===
  drawBrandLine(ctx, HERO_PAD_TOP, s);

  drawHeroKicker(ctx, HERO_PAD_TOP + 90, s, 'TOURNAMENT REPORT · 赛事战报');

  // 标题：允许 wrap 至 2 行（用户可能输入较长标题）
  setFont(ctx, T.title, '500', s.fontDisplay);
  drawWrappedText(ctx, t.title || '', SIDE, HERO_PAD_TOP + 130,
    W - SIDE * 2, T.title * 1.06, 2,
    { color: s.heroFg, baseline: 'top' });

  // meta 行
  const peopleCount = (t.players || []).length;
  const levelText = { major: '半年赛', challenge: '月赛', friendly: '周赛' }[t.level] || '周赛';
  const typeText = t.type === 'doubles' ? 'DOUBLES' : 'SINGLES';
  setFont(ctx, T.metaRow, 'normal', s.fontMono);
  fillText(ctx, `${(t._dateStr || '').toUpperCase()}  ·  ${peopleCount} 选手  ·  ${typeText}`,
    SIDE, HERO_H - HERO_PAD_BOT + 10, { color: s.heroMuted, baseline: 'top' });

  // === Section: Podium ===
  let y = HERO_H;
  y = drawSectionEyebrow(ctx, y, s, '名次 · PLACEMENT', s.accent);
  y = drawPodium(ctx, y, s, t, avatarMap);
  y += SECTION_PAD_Y;
  drawHairline(ctx, y, s);
  y += HAIRLINE;

  // === Section: Stats Strip ===
  y += SECTION_PAD_Y;
  y = drawStatsStrip(ctx, y, s, rs);
  y += SECTION_PAD_Y;
  drawHairline(ctx, y, s);
  y += HAIRLINE;

  // === Section: Roster ===
  const rosterLabel = t.type === 'doubles' && Array.isArray(t.teams) && t.teams.length > 0
    ? `ROSTER · 全部 ${t.teams.length} 队`
    : `ROSTER · 全部 ${(t.players || []).length} 人`;
  y = drawSectionEyebrow(ctx, y, s, rosterLabel);
  y = drawRoster(ctx, y, s, t.players || [], avatarMap, t);

  // === Footer === （位置由 canvasH 决定，紧贴底部）
  drawFooter(ctx, s, canvasH - FOOT_H, data.qrImage);
}

// 把 placementAwards（每条对应一个真实成员）聚合成"领奖单位"列表
// 单打：每条 award 一个 unit，members.length === 1
// 双打：同 teamId 的多条 award 合并为一个 unit，members.length === 2
function aggregatePodiumAwards(awards) {
  const filtered = (awards || []).filter(a => a.placement && a.placement <= 3);
  // 按 placement 升序，保持先冠后亚
  filtered.sort((a, b) => a.placement - b.placement);
  const groups = new Map();
  for (const a of filtered) {
    // teamId 存在 → 双打按队聚合；不存在 → 按 openid 单独成 unit
    const key = a.teamId || `solo_${a.openid}`;
    if (!groups.has(key)) {
      groups.set(key, {
        placement: a.placement,
        teamId: a.teamId || null,
        members: [],
        points: a.points || a.pts || 0,
        _fallback: a._fallback
      });
    }
    groups.get(key).members.push({
      openid: a.openid,
      wecomName: a.wecomName
    });
  }
  return Array.from(groups.values());
}

// 算 podium 区域高度（drawPodium 和 computeCanvasH 都用这个保持一致）
// N=2 决赛计分牌：高度 266rpx；其它（1/3 格）：220rpx
function computePodiumH(awards, fallbackPlayers) {
  const top3 = aggregatePodiumAwards(awards || []);
  const u1 = top3.find(u => u.placement === 1);
  const u2 = top3.find(u => u.placement === 2);
  const u3 = top3.find(u => u.placement === 3);
  const isFinalDuel = !!u1 && !!u2 && !u3;
  if (isFinalDuel) return 266;
  // fallback 状态总用三格风格（N≤3）
  return 220;
}

// 决赛计分牌（仅冠+亚两人/队场景）：上下两行 + 横线分隔
// 取决赛比分需要 tournament.knockout.rounds 末轮的 matches[0]
function drawFinalScoreboard(ctx, yStart, style, tournament, units, avatarMap) {
  const aMap = avatarMap || {};
  const ROW_H = 130;
  const HL = 2;

  // 取决赛比分（winner side = 冠军、loser side = 亚军）
  let goldScore = '—', silverScore = '—';
  const ko = tournament && tournament.knockout;
  const rounds = (ko && ko.rounds) || [];
  if (rounds.length > 0) {
    const finalMatch = (rounds[rounds.length - 1].matches || [])[0];
    if (finalMatch && finalMatch.winner && finalMatch.scoreA != null && finalMatch.scoreB != null) {
      const sA = finalMatch.scoreA;
      const sB = finalMatch.scoreB;
      goldScore = String(finalMatch.winner === 'A' ? sA : sB);
      silverScore = String(finalMatch.winner === 'A' ? sB : sA);
    }
  }

  // 顶部 hairline
  ctx.fillStyle = style.border;
  ctx.fillRect(SIDE, yStart, W - SIDE * 2, HL);
  // 冠军行
  drawScoreboardRow(ctx, yStart + HL, ROW_H, style, {
    isGold: true, label: '冠', unit: units[0],
    points: units[0].points, score: goldScore, avatarMap: aMap
  });
  // 中间 hairline
  ctx.fillStyle = style.border;
  ctx.fillRect(SIDE, yStart + HL + ROW_H, W - SIDE * 2, HL);
  // 亚军行
  drawScoreboardRow(ctx, yStart + HL + ROW_H + HL, ROW_H, style, {
    isGold: false, label: '亚', unit: units[1],
    points: units[1].points, score: silverScore, avatarMap: aMap
  });
  // 底部 hairline
  ctx.fillStyle = style.border;
  ctx.fillRect(SIDE, yStart + HL + ROW_H + HL + ROW_H, W - SIDE * 2, HL);

  return yStart + HL * 3 + ROW_H * 2; // = yStart + 266
}

// 计分牌单行（冠军 / 亚军共用）
function drawScoreboardRow(ctx, y, rowH, style, opts) {
  const { isGold, label, unit, points, score, avatarMap } = opts;
  const cy = y + rowH / 2;
  const goldCol = style.accent;
  const mutedCol = style.muted;
  const fgCol = style.fg;

  // 1. 左侧 tag（冠/亚）大字
  setFont(ctx, 32, '500', style.fontDisplay);
  fillText(ctx, label, SIDE + 8, cy, {
    color: isGold ? goldCol : mutedCol,
    align: 'left', baseline: 'middle'
  });

  // 2. 头像区（双打两个并排，单打一个）
  const avStartX = SIDE + 80;
  const isTeam = unit.members.length > 1;
  let nameX;
  if (isTeam) {
    const avR = 30;
    drawAvatar(ctx, avStartX + avR, cy, avR, unit.members[0].wecomName, {
      image: avatarMap[unit.members[0].openid],
      border: isGold ? goldCol : style.border,
      borderWidth: isGold ? 2.5 : 2,
      bg: style.surface, fg: fgCol, font: style.fontDisplay
    });
    drawAvatar(ctx, avStartX + avR * 3 + 6, cy, avR, unit.members[1].wecomName, {
      image: avatarMap[unit.members[1].openid],
      border: isGold ? goldCol : style.border,
      borderWidth: isGold ? 2.5 : 2,
      bg: style.surface, fg: fgCol, font: style.fontDisplay
    });
    nameX = avStartX + avR * 4 + 6 + 16;
  } else {
    const avR = 38;
    drawAvatar(ctx, avStartX + avR, cy, avR, unit.members[0].wecomName, {
      image: avatarMap[unit.members[0].openid],
      border: isGold ? goldCol : style.border,
      borderWidth: isGold ? 2.5 : 2,
      bg: style.surface, fg: fgCol, font: style.fontDisplay
    });
    nameX = avStartX + avR * 2 + 20;
  }

  // 3. 名字 + 4. 积分（积分在右侧但不靠最右，给比分留位置）
  // 5. 大比分（最右）：先把比分宽度算出来，给名字 max width
  const scoreFontPx = 72;
  setFont(ctx, scoreFontPx, '500', style.fontDisplay);
  const scoreW = ctx.measureText(score).width;
  const scoreX = W - SIDE - 12;
  fillText(ctx, score, scoreX, cy, {
    color: isGold ? goldCol : fgCol,
    align: 'right', baseline: 'middle'
  });

  // 4. 积分（紧贴比分左侧）
  setFont(ctx, 22, 'normal', style.fontMono);
  const ptsTxt = isTeam ? `+${points} 分·双` : `+${points} 分`;
  const ptsW = ctx.measureText(ptsTxt).width;
  const ptsX = scoreX - scoreW - 28;
  fillText(ctx, ptsTxt, ptsX, cy, {
    color: isGold ? goldCol : mutedCol,
    align: 'right', baseline: 'middle'
  });

  // 3. 名字（剩下中间空间）
  setFont(ctx, 30, '500', style.fontDisplay);
  const nameMaxW = ptsX - ptsW - nameX - 16;
  const nameText = unit.members.map(m => m.wecomName).join(' / ');
  fillText(ctx, ellipsize(ctx, nameText, Math.max(80, nameMaxW)), nameX, cy, {
    color: fgCol, align: 'left', baseline: 'middle'
  });
}

function drawPodium(ctx, y, style, tournament, avatarMap) {
  const aMap = avatarMap || {};
  const awards = (tournament && tournament.placementAwards) || [];
  const fallbackPlayers = (tournament && tournament.players) || [];

  // 1) 聚合：单打→每条一个 unit；双打→同 teamId 合并
  let top3 = aggregatePodiumAwards(awards);

  // 2) 兜底：placementAwards 缺失（如赛事仍在进行）时，
  // 用 fallbackPlayers 的前 3（按报名/积分顺序），避免画一排空头像
  if (top3.length === 0 && Array.isArray(fallbackPlayers) && fallbackPlayers.length > 0) {
    top3 = fallbackPlayers.slice(0, 3).map((p, i) => ({
      placement: i + 1,
      teamId: null,
      members: [{ openid: p.openid, wecomName: p.wecomName }],
      points: 0,
      _fallback: true
    }));
  }

  // 3) 取出冠/亚/季 unit；严格前缀
  const u1 = top3.find(u => u.placement === 1) || null;
  const u2 = top3.find(u => u.placement === 2) || null;
  const u3 = top3.find(u => u.placement === 3) || null;

  // ➤ N=2 且非 fallback：走计分牌路径
  const isFinalDuel = !!u1 && !!u2 && !u3 && !u1._fallback && !u2._fallback;
  if (isFinalDuel) {
    return drawFinalScoreboard(ctx, y, style, tournament, [u1, u2], aMap);
  }

  let arr;
  if (u1 && u2 && u3) arr = [u2, u1, u3];
  else if (u1 && u2) arr = [u2, u1];     // fallback 时仍走传统两格
  else if (u1) arr = [u1];
  else arr = [];

  if (arr.length === 0) return y; // 完全无数据：不画

  const labelOf = (u) => u && u.placement === 1 ? '冠军'
    : u && u.placement === 2 ? '亚军'
    : u && u.placement === 3 ? '季军'
    : '';

  // 4) 居中布局：每格宽度 W/3，N 个格子整体居中
  const cellW = (W - SIDE * 2) / 3;
  const offset = ((3 - arr.length) * cellW) / 2;

  for (let i = 0; i < arr.length; i++) {
    const cx = SIDE + offset + i * cellW + cellW / 2;
    const u = arr[i];
    const isGold = u && u.placement === 1;

    setFont(ctx, T.rank, 'normal', style.fontMono);
    fillText(ctx, labelOf(u).toUpperCase(), cx, y, {
      color: isGold ? style.accent : style.muted,
      align: 'center', baseline: 'top'
    });

    const avRSingle = isGold ? 56 : 44;
    const avYTop = y + 60 + (isGold ? 0 : 12);
    const isTeam = u && u.members && u.members.length > 1;

    if (isTeam) {
      const avR = Math.round(avRSingle * 0.78);
      const off = Math.round(avR * 0.95);
      drawAvatar(ctx, cx - off, avYTop + avRSingle, avR, u.members[0].wecomName, {
        image: aMap[u.members[0].openid],
        border: isGold ? style.accent : style.border,
        borderWidth: isGold ? 3 : 2,
        bg: style.surface, fg: style.fg, font: style.fontDisplay
      });
      drawAvatar(ctx, cx + off, avYTop + avRSingle, avR, u.members[1].wecomName, {
        image: aMap[u.members[1].openid],
        border: isGold ? style.accent : style.border,
        borderWidth: isGold ? 3 : 2,
        bg: style.surface, fg: style.fg, font: style.fontDisplay
      });
    } else {
      drawAvatar(ctx, cx, avYTop + avRSingle, avRSingle, u.members[0].wecomName, {
        image: aMap[u.members[0].openid],
        border: isGold ? style.accent : style.border,
        borderWidth: isGold ? 3 : 2,
        bg: style.surface, fg: style.fg, font: style.fontDisplay
      });
    }

    const nameY = avYTop + avRSingle * 2 + 14;
    setFont(ctx, T.podiumName, '500', style.fontDisplay);
    const nameText = u.members.map(m => m.wecomName).join(' / ');
    fillText(ctx, ellipsize(ctx, nameText, cellW - 16), cx, nameY, {
      color: style.fg, align: 'center', baseline: 'top'
    });
    if (!u._fallback) {
      setFont(ctx, T.podiumPts, 'normal', style.fontMono);
      const ptsText = isTeam ? `+${u.points || 0} 分 · 双打` : `+${u.points || 0} 分`;
      fillText(ctx, ptsText, cx, nameY + 36, {
        color: style.accent, align: 'center', baseline: 'top'
      });
    } else {
      setFont(ctx, T.podiumPts, 'normal', style.fontMono);
      fillText(ctx, '赛中', cx, nameY + 36, {
        color: style.muted, align: 'center', baseline: 'top'
      });
    }
  }
  return y + 220;
}

function drawStatsStrip(ctx, y, style, rs) {
  const cellW = (W - SIDE * 2) / 3;
  const items = [
    { n: rs.totalMatches || 0, l: '总场次' },
    { n: rs.finalScore || '—', l: '决赛比分' },
    { n: rs.fullDistanceCount || 0, l: '满盘场次' }
  ];
  items.forEach((it, i) => {
    const cx = SIDE + i * cellW + cellW / 2;
    setFont(ctx, T.statN, '500', style.fontDisplay);
    fillText(ctx, String(it.n), cx, y, {
      color: style.fg, align: 'center', baseline: 'top'
    });
    setFont(ctx, T.statL, 'normal', style.fontMono);
    fillText(ctx, it.l.toUpperCase(), cx, y + T.statN + 14, {
      color: style.muted, align: 'center', baseline: 'top'
    });
    // 列分隔线（除第一列）
    if (i > 0) {
      ctx.fillStyle = style.border;
      ctx.fillRect(SIDE + i * cellW, y - 8, 1, T.statN + T.statL + 22);
    }
  });
  return y + T.statN + T.statL + 22;
}

function drawRoster(ctx, y, style, players, avatarMap, tournament) {
  const aMap = avatarMap || {};
  const t = tournament || {};
  const isDoubles = t.type === 'doubles' && Array.isArray(t.teams) && t.teams.length > 0;

  if (isDoubles) {
    // 双打：按小队展示（每格两个头像 + 队名）
    const teams = t.teams;
    const cols = 3;
    const cellW = (W - SIDE * 2) / cols;
    const rowH = 140;
    teams.forEach((team, i) => {
      const cx = SIDE + (i % cols) * cellW + cellW / 2;
      const cy = y + Math.floor(i / cols) * rowH + 44;
      const members = team.members || [];
      const avatarR = 28;
      const gap = 8;
      // 两个头像并排居中
      if (members.length >= 2) {
        const leftCx = cx - avatarR - gap / 2;
        const rightCx = cx + avatarR + gap / 2;
        drawAvatar(ctx, leftCx, cy, avatarR, members[0].wecomName, {
          image: aMap[members[0].openid],
          border: style.border, borderWidth: 1.5,
          bg: style.surface, fg: style.fg, font: style.fontDisplay
        });
        drawAvatar(ctx, rightCx, cy, avatarR, members[1].wecomName, {
          image: aMap[members[1].openid],
          border: style.border, borderWidth: 1.5,
          bg: style.surface, fg: style.fg, font: style.fontDisplay
        });
      } else if (members.length === 1) {
        drawAvatar(ctx, cx, cy, avatarR, members[0].wecomName, {
          image: aMap[members[0].openid],
          border: style.border, borderWidth: 1.5,
          bg: style.surface, fg: style.fg, font: style.fontDisplay
        });
      }
      // 队名
      setFont(ctx, T.rosterName, 'normal', style.fontDisplay);
      const teamName = team.wecomName || members.map(m => m.wecomName).join(' / ');
      fillText(ctx, ellipsize(ctx, teamName, cellW - 12), cx, cy + avatarR + 20, {
        color: style.fg, align: 'center', baseline: 'top'
      });
    });
    const rosterRows = Math.ceil(teams.length / cols);
    return y + rosterRows * rowH;
  }

  // 单打：原逻辑
  const cols = 4;
  const cellW = (W - SIDE * 2) / cols;
  const rowH = 130;
  const max = 8;
  const list = players.slice(0, max);
  list.forEach((p, i) => {
    const cx = SIDE + (i % cols) * cellW + cellW / 2;
    const cy = y + Math.floor(i / cols) * rowH + 40;
    drawAvatar(ctx, cx, cy, 36, p.wecomName, {
      image: aMap[p.openid],
      border: style.border, borderWidth: 1.5,
      bg: style.surface, fg: style.fg, font: style.fontDisplay
    });
    setFont(ctx, T.rosterName, 'normal', style.fontDisplay);
    fillText(ctx, ellipsize(ctx, p.wecomName || '?', cellW - 16), cx, cy + 56, {
      color: style.fg, align: 'center', baseline: 'top'
    });
  });
  let endY = y + Math.ceil(list.length / cols) * rowH;
  if (players.length > max) {
    setFont(ctx, T.bigLbl, 'normal', style.fontMono);
    fillText(ctx, `+${players.length - max} MORE`, W - SIDE, endY + 8, {
      color: style.muted, align: 'right', baseline: 'top'
    });
    endY += 40;
  }
  return endY;
}

// ====== Footer（共享）======

function drawFooter(ctx, style, footY, qrImage) {
  drawHairline(ctx, footY, style);
  // 左侧文字
  setFont(ctx, T.footEy, 'normal', style.fontMono);
  fillText(ctx, 'TENCENT GUANGZHOU TENNIS CLUB', SIDE, footY + 36, {
    color: style.muted, baseline: 'top'
  });
  setFont(ctx, T.footEy, 'normal', style.fontMono);
  fillText(ctx, 'EST. 2025', SIDE, footY + 64, {
    color: style.muted, baseline: 'top'
  });
  // 右侧二维码
  if (qrImage) {
    const qrSize = 96;
    const qrX = W - SIDE - qrSize;
    const qrY = footY + 20;
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
  }
}

// ====== 主入口 ======

// 根据 data 内容预计算 canvas 实际高度。
// 与下面 drawReportPoster / drawPersonalPoster 的 Y 累加逻辑严格对应。
// 改其中一处，另一处也要同步。
function computeCanvasH(ctx, data) {
  const s = data.style;
  if (data.type === 'report') {
    const t = data.tournament || {};
    const players = t.players || [];
    let y = HERO_H;
    // Podium section
    y += T.eyebrow + 28 + SECTION_PAD_Y; // eyebrow + gap (drawSectionEyebrow)
    y += computePodiumH(t.placementAwards, t.players); // 220（1/3 格）/ 266（计分牌 N=2）
    y += SECTION_PAD_Y + HAIRLINE;       // 下 padding + hairline
    // Stats section（无 eyebrow，靠两 hairline 夹）
    y += SECTION_PAD_Y;                  // 上 padding
    y += T.statN + T.statL + 22;         // stats 数字 + 标签 + 内边距
    y += SECTION_PAD_Y + HAIRLINE;       // 下 padding + hairline
    // Roster section
    y += T.eyebrow + 28 + SECTION_PAD_Y; // eyebrow
    const isDoubles = t.type === 'doubles' && Array.isArray(t.teams) && t.teams.length > 0;
    if (isDoubles) {
      const rosterRows = Math.max(1, Math.ceil(t.teams.length / 3));
      y += rosterRows * 140;
    } else {
      const rosterRows = Math.max(1, Math.ceil(Math.min(8, players.length) / 4));
      y += rosterRows * 130;
      if (players.length > 8) y += 40;
    }
    // Footer
    y += FOOT_GAP + FOOT_H;
    return y;
  }

  // personal
  const stats = data.userStats || {};
  const hl = data.highlight;
  const matches = stats.matches || [];
  let y = HERO_H;
  // Big Four section
  y += T.eyebrow + 28 + SECTION_PAD_Y;
  y += 130 * 2 - 30;                     // drawBigFour 返回 y + cellH*2 - 30
  y += SECTION_PAD_Y + HAIRLINE;
  // Highlight section
  y += T.eyebrow + 28 + SECTION_PAD_Y;
  if (hl) {
    setFont(ctx, T.hlContent, '500', s.fontDisplay);
    const lines = Math.min(3, wrapText(ctx, hl.detail || hl.title || '', W - SIDE * 2).length);
    y += lines * (T.hlContent + 8);
    if (hl.score) y += T.hlDetail + 16;
  }
  y += SECTION_PAD_Y + HAIRLINE;
  // Match History section
  y += T.eyebrow + 28 + SECTION_PAD_Y;
  const rowCount = Math.min(6, matches.length);
  if (rowCount === 0) {
    y += 40;                             // 占位行（保证不撞 footer）
  } else {
    y += rowCount * 60;
    if (matches.length > rowCount) y += 40;
  }
  // Footer
  y += FOOT_GAP + FOOT_H;
  return y;
}

function drawPoster(ctx, canvas, data) {
  const canvasH = computeCanvasH(ctx, data);
  if (canvas) {
    canvas.width = W;
    canvas.height = canvasH;
  }
  if (data.type === 'report') {
    drawReportPoster(ctx, data, canvasH);
  } else {
    drawPersonalPoster(ctx, data, canvasH);
  }
}

module.exports = { drawPoster, computeCanvasH, preloadAvatars, W, H_DEFAULT };
