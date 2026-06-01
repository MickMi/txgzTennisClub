// utils/poster-draw.js
// Canvas 海报绘制主逻辑。750×1334 px (2x retina)。
//
// 设计原则：所有间距走统一网格系统，参照 docs/references/share-posters-emerald.html
// 参考稿是 375×667 (1x)，本文件是 2x，所有像素值 ×2。
//
// 入口：drawPoster(ctx, canvas, data)
//   data: { type, tournament, me, userStats, highlight, style }
//   type: 'report' | 'personal'

const W = 750;
const H = 1334;

// === 网格系统（canvas px，全部 2x 于参考稿）===
const SIDE = 56;            // 28 × 2 — section 左右内边距
const HAIRLINE = 2;         // 1 × 2 — 分隔线
const HERO_H = 540;         // ~270 × 2 — hero 高度
const HERO_PAD_TOP = 72;    // 36 × 2
const HERO_PAD_BOT = 56;    // 28 × 2
const SECTION_PAD_Y = 40;   // section 上下内边距
const FOOT_H = 100;         // footer 高度

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

function clear(ctx, style) {
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, W, H);
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
  // 仿参考稿（375 系坐标 ×2）
  ctx.strokeRect(84, -80, 582, 520);
  ctx.beginPath(); ctx.moveTo(376, -80); ctx.lineTo(376, 440); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(84, 280); ctx.lineTo(666, 280); ctx.stroke();
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

// 圆形 avatar（首字母）
function drawAvatar(ctx, cx, cy, r, name, opts) {
  const o = opts || {};
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

function drawPersonalPoster(ctx, data) {
  const t = data.tournament || {};
  const me = data.me || {};
  const stats = data.userStats || {};
  const hl = data.highlight;
  const s = data.style;

  clear(ctx, s);
  drawHeroBg(ctx, s);

  // === Hero ===
  // 1) 品牌行
  drawBrandLine(ctx, HERO_PAD_TOP, s);

  // 2) 身份行（avatar + name + role）放在 hero 中段
  const idY = HERO_PAD_TOP + 70;
  const avR = 50;
  drawAvatar(ctx, SIDE + avR, idY + avR, avR, me.wecomName, {
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

  // === Footer ===
  drawFooter(ctx, s);
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
    // 圆点
    ctx.beginPath();
    ctx.arc(SIDE + 6, ry + 22, 6, 0, Math.PI * 2);
    ctx.fillStyle = m.win ? style.positive : style.muted;
    ctx.fill();
    // round (mono)
    setFont(ctx, T.histRound, 'normal', style.fontMono);
    fillText(ctx, (m.round || '').toUpperCase().slice(0, 5), SIDE + 28, ry + 12, {
      color: style.muted, baseline: 'top'
    });
    // opponent
    setFont(ctx, T.histOpp, 'normal', style.fontDisplay);
    fillText(ctx, ellipsize(ctx, m.opponentName || '—', W - SIDE * 2 - 240),
      SIDE + 96, ry + 18, { color: style.fg, baseline: 'top' });
    // score
    setFont(ctx, T.histScore, '500', style.fontMono);
    fillText(ctx, m.scoreText || '—', W - SIDE, ry + 18, {
      color: m.win ? style.fg : style.muted, align: 'right', baseline: 'top'
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

function drawReportPoster(ctx, data) {
  const t = data.tournament || {};
  const s = data.style;
  const rs = t._reportStats || {};

  clear(ctx, s);
  drawHeroBg(ctx, s);

  // === Hero ===
  drawBrandLine(ctx, HERO_PAD_TOP, s);

  drawHeroKicker(ctx, HERO_PAD_TOP + 90, s, 'TOURNAMENT REPORT · 赛事战报');

  setFont(ctx, T.title, '500', s.fontDisplay);
  fillText(ctx, ellipsize(ctx, t.title || '', W - SIDE * 2),
    SIDE, HERO_PAD_TOP + 130, { color: s.heroFg, baseline: 'top' });

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
  y = drawPodium(ctx, y, s, t.placementAwards || []);
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
  y = drawSectionEyebrow(ctx, y, s, `ROSTER · 全部 ${(t.players || []).length} 人`);
  y = drawRoster(ctx, y, s, t.players || []);

  // === Footer ===
  drawFooter(ctx, s);
}

function drawPodium(ctx, y, style, awards) {
  const top3 = (awards || [])
    .filter(a => a.placement && a.placement <= 3)
    .sort((a, b) => a.placement - b.placement);
  const arr = [top3.find(a => a.placement === 2), top3.find(a => a.placement === 1), top3.find(a => a.placement === 3)];
  const labels = ['亚军', '冠军', '季军'];

  const cellW = (W - SIDE * 2) / 3;
  for (let i = 0; i < 3; i++) {
    const cx = SIDE + i * cellW + cellW / 2;
    const a = arr[i];
    const isGold = i === 1;
    // rank 标签
    setFont(ctx, T.rank, 'normal', style.fontMono);
    fillText(ctx, labels[i].toUpperCase(), cx, y, {
      color: isGold ? style.accent : style.muted,
      align: 'center', baseline: 'top'
    });
    // avatar
    const avR = isGold ? 56 : 44;
    drawAvatar(ctx, cx, y + 60 + (isGold ? 0 : 12), avR, a ? a.wecomName : '·', {
      border: isGold ? style.accent : style.border,
      borderWidth: isGold ? 3 : 2,
      bg: style.surface,
      fg: style.fg,
      font: style.fontDisplay
    });
    // name
    const nameY = y + 60 + (isGold ? 0 : 12) + avR + 14;
    setFont(ctx, T.podiumName, '500', style.fontDisplay);
    fillText(ctx, a ? ellipsize(ctx, a.wecomName || '—', cellW - 24) : '—', cx, nameY, {
      color: style.fg, align: 'center', baseline: 'top'
    });
    // pts
    if (a) {
      setFont(ctx, T.podiumPts, 'normal', style.fontMono);
      fillText(ctx, `+${a.points || 0} 分`, cx, nameY + 36, {
        color: style.accent, align: 'center', baseline: 'top'
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

function drawRoster(ctx, y, style, players) {
  const cols = 4;
  const cellW = (W - SIDE * 2) / cols;
  const rowH = 130;
  const max = 8;
  const list = players.slice(0, max);
  list.forEach((p, i) => {
    const cx = SIDE + (i % cols) * cellW + cellW / 2;
    const cy = y + Math.floor(i / cols) * rowH + 40;
    drawAvatar(ctx, cx, cy, 36, p.wecomName, {
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

function drawFooter(ctx, style) {
  const y = H - FOOT_H;
  drawHairline(ctx, y, style);
  setFont(ctx, T.footEy, 'normal', style.fontMono);
  fillText(ctx, 'TENCENT GUANGZHOU TENNIS CLUB', SIDE, y + 32, {
    color: style.muted, baseline: 'top'
  });
  setFont(ctx, T.footEy, 'normal', style.fontMono);
  fillText(ctx, 'EST. 2024', W - SIDE, y + 32, {
    color: style.muted, align: 'right', baseline: 'top'
  });
}

// ====== 主入口 ======

function drawPoster(ctx, canvas, data) {
  if (canvas) {
    canvas.width = W;
    canvas.height = H;
  }
  if (data.type === 'report') {
    drawReportPoster(ctx, data);
  } else {
    drawPersonalPoster(ctx, data);
  }
}

module.exports = { drawPoster, W, H };
