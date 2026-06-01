// utils/poster-draw.js
// Canvas 海报绘制主逻辑。750×1334 px (2x retina)。
//
// 入口：drawPoster(ctx, canvas, data)
//   data: { type, tournament, me, userStats, highlight, style }
//   type: 'report' | 'personal'
//   style: POSTER_STYLES[i]
//
// 设计参考：DESIGN_SPEC §11；不画小程序码（用户决策 C3）。

const W = 750;
const H = 1334;
const HERO_H = 460;

// ====== 工具 ======

function clear(ctx, style) {
  ctx.fillStyle = style.bg;
  ctx.fillRect(0, 0, W, H);
}

function drawHeroBg(ctx, style) {
  const grad = ctx.createLinearGradient(0, 0, 0, HERO_H);
  grad.addColorStop(0, style.heroBg[0]);
  grad.addColorStop(1, style.heroBg[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, HERO_H);
  if (style.showCourtLines) drawCourtLines(ctx, style);
}

function drawCourtLines(ctx, style) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = style.heroFg;
  ctx.lineWidth = 2;
  // 外框（贴在 hero 下半部）
  ctx.strokeRect(84, HERO_H - 380, 582, 520);
  // 中线
  ctx.beginPath();
  ctx.moveTo(375, HERO_H - 380);
  ctx.lineTo(375, HERO_H + 140);
  ctx.stroke();
  // 发球线
  ctx.beginPath();
  ctx.moveTo(84, HERO_H - 100);
  ctx.lineTo(666, HERO_H - 100);
  ctx.stroke();
  // 双打边线
  ctx.beginPath();
  ctx.moveTo(120, HERO_H - 380);
  ctx.lineTo(120, HERO_H + 140);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(630, HERO_H - 380);
  ctx.lineTo(630, HERO_H + 140);
  ctx.stroke();
  ctx.restore();
}

function setFont(ctx, size, weight, family) {
  ctx.font = `${weight || 'normal'} ${size}px ${family}`;
}

function drawText(ctx, text, x, y, opts) {
  const o = opts || {};
  if (o.color) ctx.fillStyle = o.color;
  if (o.align) ctx.textAlign = o.align;
  if (o.baseline) ctx.textBaseline = o.baseline;
  ctx.fillText(text, x, y);
}

// 圆形 avatar（首字母）
function drawAvatar(ctx, cx, cy, r, name, opts) {
  const o = opts || {};
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = o.bg || 'transparent';
  if (o.bg) ctx.fill();
  ctx.lineWidth = o.borderWidth || 2;
  ctx.strokeStyle = o.border || '#fff';
  ctx.stroke();

  ctx.fillStyle = o.fg || '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${o.fontWeight || 'bold'} ${Math.round(r * 1.0)}px ${o.font || 'PingFang SC'}`;
  const ch = (name || '?').charAt(0);
  ctx.fillText(ch, cx, cy + 2);
  ctx.restore();
}

// 顶线分隔（eyebrow）
function drawEyebrow(ctx, x, y, w, label, style) {
  ctx.save();
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  setFont(ctx, 22, 'normal', style.fontMono);
  drawText(ctx, label, x, y + 32, { color: style.muted, align: 'left', baseline: 'alphabetic' });
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

// ====== Hero（共享） ======

function drawHeroBrand(ctx, style) {
  setFont(ctx, 22, 'normal', style.fontMono);
  drawText(ctx, 'TENCENT GUANGZHOU', 48, 90, { color: style.heroMuted, align: 'left', baseline: 'alphabetic' });
  setFont(ctx, 26, 'bold', style.fontDisplay);
  drawText(ctx, '腾讯广州网球社', 48, 124, { color: style.heroFg, align: 'left' });
}

function drawHeroDateBadge(ctx, dateStr, style) {
  // 右上角：mono 日期
  setFont(ctx, 20, 'normal', style.fontMono);
  drawText(ctx, dateStr || '', W - 48, 100, { color: style.heroMuted, align: 'right', baseline: 'alphabetic' });
}

// ====== Personal Poster ======

function drawPersonalPoster(ctx, data) {
  const { tournament, me, userStats, highlight, style } = data;
  clear(ctx, style);
  drawHeroBg(ctx, style);

  // Hero brand + 日期
  drawHeroBrand(ctx, style);
  drawHeroDateBadge(ctx, tournament._dateStr || '', style);

  // 大头像 + 姓名
  const avatarCY = 230;
  drawAvatar(ctx, 130, avatarCY, 60, me.wecomName, {
    bg: 'transparent',
    border: style.heroFg,
    borderWidth: 2,
    fg: style.heroFg,
    font: style.fontDisplay,
    fontWeight: '600'
  });

  setFont(ctx, 50, 'bold', style.fontDisplay);
  drawText(ctx, me.wecomName || '球员', 220, avatarCY - 8, {
    color: style.heroFg, align: 'left', baseline: 'middle'
  });

  setFont(ctx, 22, 'normal', style.fontMono);
  const ratingTxt = me.rating ? `NTRP ${me.rating}` : '未评级';
  const eloTxt = `ELO ${me.eloRating || 1500}`;
  drawText(ctx, `${ratingTxt}  ·  ${eloTxt}`, 220, avatarCY + 38, {
    color: style.heroMuted, align: 'left', baseline: 'middle'
  });

  // 赛事引用
  setFont(ctx, 20, 'normal', style.fontMono);
  drawText(ctx, 'TOURNAMENT · 本次赛事', 48, 360, { color: style.heroMuted, align: 'left' });
  setFont(ctx, 38, 'bold', style.fontDisplay);
  drawText(ctx, ellipsize(ctx, tournament.title || '', W - 96), 48, 412, {
    color: style.heroFg, align: 'left'
  });

  // ====== 主体 ======

  // Big Four (2x2)
  const bfTop = HERO_H + 60;
  drawEyebrow(ctx, 48, bfTop, W - 96, 'STATS · 本次成绩', style);
  drawBigFour(ctx, 48, bfTop + 80, W - 96, userStats, style);

  // Highlight
  const hlTop = bfTop + 380;
  drawEyebrow(ctx, 48, hlTop, W - 96, 'HIGHLIGHT · 高光时刻', style);
  drawHighlight(ctx, 48, hlTop + 60, W - 96, highlight, style);

  // Match History
  const mhTop = hlTop + 230;
  drawEyebrow(ctx, 48, mhTop, W - 96, 'MATCHES · 本次记录', style);
  drawMatchHistory(ctx, 48, mhTop + 60, W - 96, userStats.matches || [], style);

  // Footer brand
  drawFooter(ctx, style);
}

function drawBigFour(ctx, x, y, w, stats, style) {
  const cellW = w / 2;
  const cellH = 130;
  const items = [
    { label: '名次', value: stats.placementText || '—' },
    { label: '积分', value: (stats.pointsEarned >= 0 ? '+' : '') + (stats.pointsEarned || 0) },
    { label: 'ELO 变化', value: (stats.eloChange >= 0 ? '+' : '') + (stats.eloChange || 0) },
    { label: '战绩', value: `${stats.wins || 0}-${stats.losses || 0}` }
  ];
  items.forEach((it, i) => {
    const cx = x + (i % 2) * cellW;
    const cy = y + Math.floor(i / 2) * cellH;
    setFont(ctx, 20, 'normal', style.fontMono);
    drawText(ctx, it.label, cx, cy, { color: style.muted, align: 'left', baseline: 'alphabetic' });
    setFont(ctx, 64, 'bold', style.fontDisplay);
    drawText(ctx, String(it.value), cx, cy + 80, { color: style.fg, align: 'left', baseline: 'alphabetic' });
  });
}

function drawHighlight(ctx, x, y, w, highlight, style) {
  if (!highlight) return;
  // 类型标签（accent 色）
  setFont(ctx, 24, 'bold', style.fontDisplay);
  drawText(ctx, '✦ ' + (highlight.title || '高光'), x, y, {
    color: style.accent, align: 'left', baseline: 'alphabetic'
  });
  // 详情文案（多行支持）
  setFont(ctx, 28, 'normal', style.fontDisplay);
  ctx.fillStyle = style.fg;
  const lines = wrapText(ctx, highlight.detail || '', w);
  let ly = y + 56;
  lines.slice(0, 3).forEach(line => {
    drawText(ctx, line, x, ly, { color: style.fg, align: 'left' });
    ly += 40;
  });
  if (highlight.score) {
    setFont(ctx, 22, 'normal', style.fontMono);
    drawText(ctx, `SCORE  ${highlight.score}`, x, ly + 8, {
      color: style.muted, align: 'left'
    });
  }
}

function drawMatchHistory(ctx, x, y, w, matches, style) {
  const rowH = 56;
  const maxRows = 6;
  const list = matches.slice(0, maxRows);
  list.forEach((m, i) => {
    const ry = y + i * rowH;
    // 圆点（胜=accent，负=muted）
    ctx.beginPath();
    ctx.arc(x + 8, ry + 12, 6, 0, Math.PI * 2);
    ctx.fillStyle = m.win ? style.accent : style.muted;
    ctx.fill();
    // round + opponent
    setFont(ctx, 24, 'normal', style.fontDisplay);
    drawText(ctx, `${m.round}  ·  ${m.opponentName || '—'}`, x + 30, ry + 18, {
      color: style.fg, align: 'left', baseline: 'alphabetic'
    });
    // score
    setFont(ctx, 24, 'normal', style.fontMono);
    drawText(ctx, m.scoreText || '', x + w, ry + 18, {
      color: m.win ? style.fg : style.muted, align: 'right', baseline: 'alphabetic'
    });
  });
  if (matches.length > maxRows) {
    setFont(ctx, 20, 'normal', style.fontMono);
    drawText(ctx, `+${matches.length - maxRows} more`, x + w, y + maxRows * rowH + 10, {
      color: style.muted, align: 'right'
    });
  }
}

// ====== Report Poster ======

function drawReportPoster(ctx, data) {
  const { tournament, style } = data;
  clear(ctx, style);
  drawHeroBg(ctx, style);

  drawHeroBrand(ctx, style);
  drawHeroDateBadge(ctx, tournament._dateStr || '', style);

  // 赛事 kicker + title
  setFont(ctx, 22, 'normal', style.fontMono);
  drawText(ctx, 'TOURNAMENT REPORT · 赛事战报', 48, 250, { color: style.heroMuted, align: 'left' });
  setFont(ctx, 52, 'bold', style.fontDisplay);
  drawText(ctx, ellipsize(ctx, tournament.title || '', W - 96), 48, 320, {
    color: style.heroFg, align: 'left'
  });
  // meta（人数 / 等级）
  setFont(ctx, 22, 'normal', style.fontMono);
  const peopleCount = (tournament.players || []).length;
  const levelText = { major: '半年赛', challenge: '月赛', friendly: '周赛' }[tournament.level] || '周赛';
  drawText(ctx, `${levelText}  ·  ${peopleCount} 人参赛`, 48, 380, {
    color: style.heroMuted, align: 'left'
  });

  // ====== 主体 ======

  // Podium（前 3 名）
  const podiumTop = HERO_H + 60;
  drawEyebrow(ctx, 48, podiumTop, W - 96, 'PODIUM · 前三名', style);
  drawPodium(ctx, 48, podiumTop + 60, W - 96, tournament.placementAwards || [], style);

  // Stats strip
  const statsTop = podiumTop + 360;
  drawEyebrow(ctx, 48, statsTop, W - 96, 'STATS · 全场数据', style);
  drawReportStats(ctx, 48, statsTop + 60, W - 96, tournament._reportStats || {}, style);

  // Roster
  const rosTop = statsTop + 240;
  drawEyebrow(ctx, 48, rosTop, W - 96, 'ROSTER · 参赛阵容', style);
  drawRoster(ctx, 48, rosTop + 60, W - 96, tournament.players || [], style);

  drawFooter(ctx, style);
}

function drawPodium(ctx, x, y, w, awards, style) {
  // 取 placement <= 3 的，按 placement 升序排
  const top3 = (awards || [])
    .filter(a => a.placement && a.placement <= 3)
    .sort((a, b) => a.placement - b.placement)
    .slice(0, 3);

  const cellW = w / 3;
  const labels = ['CHAMPION', 'RUNNER-UP', 'THIRD'];
  for (let i = 0; i < 3; i++) {
    const cx = x + i * cellW + cellW / 2;
    const cy = y + 80;
    const a = top3[i];
    drawAvatar(ctx, cx, cy, 64, a ? a.wecomName : '?', {
      border: style.accent, borderWidth: i === 0 ? 4 : 2,
      fg: style.fg, bg: style.surface,
      font: style.fontDisplay, fontWeight: '600'
    });
    setFont(ctx, 18, 'normal', style.fontMono);
    drawText(ctx, labels[i], cx, cy + 90, { color: style.muted, align: 'center' });
    setFont(ctx, 26, 'bold', style.fontDisplay);
    drawText(ctx, a ? ellipsize(ctx, a.wecomName || '—', cellW - 20) : '—', cx, cy + 124, {
      color: style.fg, align: 'center'
    });
    if (a) {
      setFont(ctx, 20, 'normal', style.fontMono);
      drawText(ctx, `+${a.points || 0} PTS`, cx, cy + 154, {
        color: style.accent, align: 'center'
      });
    }
  }
}

function drawReportStats(ctx, x, y, w, stats, style) {
  const cellW = w / 3;
  const items = [
    { label: '总场次', value: stats.totalMatches || 0 },
    { label: '决赛比分', value: stats.finalScore || '—' },
    { label: '满盘场次', value: stats.fullDistanceCount || 0 }
  ];
  items.forEach((it, i) => {
    const cx = x + i * cellW;
    setFont(ctx, 20, 'normal', style.fontMono);
    drawText(ctx, it.label, cx, y, { color: style.muted, align: 'left' });
    setFont(ctx, 52, 'bold', style.fontDisplay);
    drawText(ctx, String(it.value), cx, y + 70, { color: style.fg, align: 'left' });
  });
}

function drawRoster(ctx, x, y, w, players, style) {
  const cols = 4;
  const cellW = w / cols;
  const cellH = 120;
  const max = 8;
  const list = players.slice(0, max);
  list.forEach((p, i) => {
    const cx = x + (i % cols) * cellW + cellW / 2;
    const cy = y + Math.floor(i / cols) * cellH + 40;
    drawAvatar(ctx, cx, cy, 36, p.wecomName, {
      border: style.border, borderWidth: 1.5,
      fg: style.fg, bg: style.surface,
      font: style.fontDisplay, fontWeight: '500'
    });
    setFont(ctx, 20, 'normal', style.fontDisplay);
    drawText(ctx, ellipsize(ctx, p.wecomName || '?', cellW - 12), cx, cy + 52, {
      color: style.fg, align: 'center'
    });
  });
  if (players.length > max) {
    setFont(ctx, 20, 'normal', style.fontMono);
    drawText(ctx, `+${players.length - max} more`, x + w, y + 2 * cellH + 10, {
      color: style.muted, align: 'right'
    });
  }
}

function drawFooter(ctx, style) {
  const y = H - 80;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(48, y);
  ctx.lineTo(W - 48, y);
  ctx.stroke();
  setFont(ctx, 18, 'normal', style.fontMono);
  drawText(ctx, 'TENCENT GUANGZHOU TENNIS CLUB', 48, y + 36, {
    color: style.muted, align: 'left'
  });
  drawText(ctx, 'EST. 2024', W - 48, y + 36, { color: style.muted, align: 'right' });
}

// 简易换行（按字符切分，中英文混合）
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

// ====== 主入口 ======

function drawPoster(ctx, canvas, data) {
  // canvas 像素尺寸 = 750×1334（不做 dpr scale，已经是 retina）
  if (canvas) {
    canvas.width = W;
    canvas.height = H;
  }
  const style = data.style;
  if (data.type === 'report') {
    drawReportPoster(ctx, data);
  } else {
    drawPersonalPoster(ctx, data);
  }
}

module.exports = { drawPoster, W, H };
