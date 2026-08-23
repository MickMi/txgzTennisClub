// utils/highlight.js
// 计算用户在某场赛事中的"高光时刻"。
// 核心原则：永远正面。无论排名高低，都找到值得分享的角度。
// 详见 DESIGN_SPEC §11.5。

const LEVEL_TEXT = {
  major: '半年赛',
  challenge: '月赛',
  friendly: '周赛'
};

// 把 NTRP rating 字符串转 number，"未评级" 视为 2.5
function parseRating(rating) {
  if (!rating || typeof rating !== 'string') return 2.5;
  const n = parseFloat(rating);
  return isNaN(n) ? 2.5 : n;
}

// 判断 openid 是否参与了某场比赛的某一边
// 单打：直接比较 player.openid
// 双打：player.openid 是合成 team ID，要看 player.members 里有没有 openid
// teams: 可选，tournament.teams 数组，members 缺失时回查
function isPlayerInUnit(unit, openid, teams) {
  if (!unit) return false;
  if (unit.openid === openid) return true; // 单打
  if (Array.isArray(unit.members) && unit.members.length > 0) {
    return unit.members.some(m => m.openid === openid);
  }
  // 双打 fallback：合成 ID 且 members 缺失
  if (unit.openid && unit.openid.startsWith('team_')) {
    if (Array.isArray(teams)) {
      const team = teams.find(t => t.openid === unit.openid);
      if (team && Array.isArray(team.members)) {
        return team.members.some(m => m.openid === openid);
      }
    }
    // 最终 fallback：检查合成 ID 是否包含目标 openid
    return unit.openid.slice(5).includes(openid);
  }
  return false;
}

// 收集用户参与的所有 match（小组+淘汰），附上 round 标签
function collectUserMatches(tournament, openid) {
  const list = [];
  const teams = tournament.teams || [];

  // 小组赛
  (tournament.groups || []).forEach((g, gIdx) => {
    (g.matches || []).forEach(m => {
      if (!m.playerA || !m.playerB) return;
      const inA = isPlayerInUnit(m.playerA, openid, teams);
      const inB = isPlayerInUnit(m.playerB, openid, teams);
      if (!inA && !inB) return;
      list.push({
        round: `小组赛`,
        groupIndex: gIdx,
        match: m,
        meSide: inA ? 'A' : 'B',
        oppSide: inA ? 'B' : 'A',
        opponent: inA ? m.playerB : m.playerA,
        scored: !!m.winner,
        won: m.winner === (inA ? 'A' : 'B'),
        scoreSummary: m.scoreSummary || ''
      });
    });
  });

  // 淘汰赛 — 给每轮起个中文名
  const rounds = tournament.knockout && tournament.knockout.rounds ? tournament.knockout.rounds : [];
  const totalRounds = rounds.length;
  rounds.forEach((rd, rIdx) => {
    const remaining = totalRounds - rIdx;
    const roundName = remaining === 1 ? '决赛'
      : remaining === 2 ? '半决赛'
      : remaining === 3 ? '四分之一决赛'
      : `第 ${rIdx + 1} 轮`;
    (rd.matches || []).forEach(m => {
      if (!m.playerA || !m.playerB) return;
      const inA = isPlayerInUnit(m.playerA, openid, teams);
      const inB = isPlayerInUnit(m.playerB, openid, teams);
      if (!inA && !inB) return;
      list.push({
        round: roundName,
        roundIndex: rIdx,
        match: m,
        meSide: inA ? 'A' : 'B',
        oppSide: inA ? 'B' : 'A',
        opponent: inA ? m.playerB : m.playerA,
        scored: !!m.winner,
        won: m.winner === (inA ? 'A' : 'B'),
        scoreSummary: m.scoreSummary || '',
        isKnockout: true
      });
    });
  });

  // 团队赛：新版遍历 courts[].encounters；旧赛事继续兼容 slots。
  if (tournament.type === 'team') {
    const group = tournament.groups && tournament.groups[0];
    const match = group && group.matches && group.matches[0];
    if (match) {
      const teamMembers = [];
      (tournament.teams || []).forEach(tu => {
        (tu.members || []).forEach(m => { if (m.openid && m.wecomName) teamMembers.push(m); });
      });
      const nameMap = {};
      teamMembers.forEach(m => { nameMap[m.openid] = m.wecomName; });

      const courtEncounters = Array.isArray(match.courts)
        ? match.courts.reduce((all, court, courtIndex) => all.concat((court.encounters || []).map(encounter => ({
            ...encounter,
            courtName: court.name || `${courtIndex + 1}号场`,
            isTiebreak: false
          }))), [])
        : (match.slots || []).map(slot => ({
            ...slot,
            courtName: `Slot ${slot.index}`,
            isTiebreak: !!slot.isTiebreak
          }));
      const allEncounters = match.tiebreak
        ? courtEncounters.concat([{ ...match.tiebreak, courtName: '一球制胜', isTiebreak: true }])
        : courtEncounters;

      allEncounters.forEach(encounter => {
        const lineup = encounter.lineup;
        if (!lineup) return;
        const inA = (lineup.A || []).includes(openid);
        const inB = (lineup.B || []).includes(openid);
        if (!inA && !inB) return;

        const mySide = inA ? 'A' : 'B';
        const oppSide = inA ? 'B' : 'A';
        const oppOids = (lineup[oppSide] || []);
        const oppNames = oppOids.map(oid => nameMap[oid] || '').filter(Boolean).join('/');
        const partnerOids = (lineup[mySide] || []).filter(oid => oid !== openid);
        const partnerNames = partnerOids.map(oid => nameMap[oid] || '').filter(Boolean).join('/');
        const slotIsDoubles = (lineup.A || []).length === 2;

        const scoreSummary = encounter.setsA !== undefined && encounter.setsB !== undefined
          ? `${encounter.setsA}:${encounter.setsB}`
          : String(encounter.score || '').replace(/\s*[-–—]\s*/, ':');
        list.push({
          round: `团队赛 · ${encounter.courtName}`,
          match: { winner: encounter.winner, isTiebreak: !!encounter.isTiebreak, scoreSummary },
          meSide: mySide,
          oppSide: oppSide,
          opponent: { wecomName: oppNames || 'TBD', openid: oppOids[0] || '' },
          partner: { wecomName: partnerNames || '', openid: partnerOids[0] || '' },
          scored: !!encounter.winner,
          won: encounter.winner === mySide,
          scoreSummary,
          isTeamSlot: true,
          slotIsDoubles
        });
      });
    }
  }

  return list;
}

// 算用户连胜（赛事内连续胜场）
function maxStreak(userMatches) {
  let best = 0, cur = 0;
  // 按数组顺序（小组赛先于淘汰赛）扫描
  userMatches.filter(m => m.scored).forEach(m => {
    if (m.won) { cur++; best = Math.max(best, cur); }
    else cur = 0;
  });
  return best;
}

// 检测用户在小组赛阶段是否全胜（E2 宽松：只看赢，不要求出线）
function groupSweep(userMatches) {
  const groupGames = userMatches.filter(m => !m.isKnockout && m.scored);
  if (groupGames.length === 0) return null;
  const allWon = groupGames.every(m => m.won);
  return allWon ? groupGames.length : null;
}

// 主入口：返回 { type, title, detail } 或一个兜底 highlight。绝不返回 null。
function computeHighlight(tournament, openid) {
  const userMatches = collectUserMatches(tournament, openid);

  // 找用户在 tournament.players 里的 rating
  const meInfo = (tournament.players || []).find(p => p.openid === openid) || {};
  const myRating = parseRating(meInfo.rating);

  // ⓪ golden_point — 一球制胜（最高优先级，最刺激）
  for (const m of userMatches) {
    if (m.isTeamSlot && m.match && m.match.isTiebreak && m.scored && m.won) {
      return {
        type: 'golden_point',
        title: '一球制胜',
        detail: `团队赛平分后，一球决胜击败${m.opponent.wecomName || '对手'}！`,
        score: m.scoreSummary
      };
    }
  }

  // ① upset_win — 击败 NTRP 高 ≥ 1.0 的对手
  for (const m of userMatches) {
    if (!m.won) continue;
    const oppRating = parseRating(m.opponent && m.opponent.rating);
    if (oppRating - myRating >= 1.0) {
      return {
        type: 'upset_win',
        title: '以弱胜强',
        detail: `${m.round}中击败 NTRP ${oppRating.toFixed(1)} 的${m.opponent.wecomName}`,
        score: m.scoreSummary
      };
    }
  }

  // ② clutch_tiebreak — 决胜险胜
  // 多盘制（bestOf=4/6）：打满盘数 + 1 局之差，如 6-5
  // 单盘抢分制（bestOf=7/11）：延长胜（净胜恰好 2、且超过 target），如 8-6、9-7
  const bestOf = tournament.bestOf || 0;
  const isShort = bestOf === 7 || bestOf === 11;
  for (const m of userMatches) {
    if (!m.won || !m.scoreSummary) continue;
    const [sa, sb] = m.scoreSummary.split(':').map(s => parseInt(s, 10));
    if (isNaN(sa) || isNaN(sb)) continue;
    const high = Math.max(sa, sb);
    const low = Math.min(sa, sb);
    const isClutch = isShort
      ? (high > bestOf && high - low === 2)
      : (bestOf > 0 && sa + sb === bestOf * 2 - 1 && high - low === 1);
    if (isClutch) {
      return {
        type: 'clutch_tiebreak',
        title: '决胜险胜',
        detail: `${m.round}决胜局 ${m.scoreSummary} 力克${m.opponent.wecomName}`,
        score: m.scoreSummary
      };
    }
  }

  // ③ group_sweep — 小组赛全胜（E2 宽松判定）
  const sweepWins = groupSweep(userMatches);
  if (sweepWins && sweepWins >= 2) {
    return {
      type: 'group_sweep',
      title: '小组全胜',
      detail: `小组赛 ${sweepWins} 战全胜`,
      score: ''
    };
  }

  // ④ streak — 本赛事连胜 ≥ 3
  const streak = maxStreak(userMatches);
  if (streak >= 3) {
    return {
      type: 'streak',
      title: '连胜势头',
      detail: `赛事中取得 ${streak} 连胜`,
      score: ''
    };
  }

  // ⑤ full_distance — 输了但激战到最后（虽败犹荣）
  // 多盘制：打满盘数；单盘抢分制：被延长（净胜 2、且超过 target）
  for (const m of userMatches) {
    if (m.won || !m.scoreSummary) continue;
    const [sa, sb] = m.scoreSummary.split(':').map(s => parseInt(s, 10));
    if (isNaN(sa) || isNaN(sb)) continue;
    const high = Math.max(sa, sb);
    const isFull = isShort
      ? (high > bestOf)
      : (bestOf > 0 && sa + sb >= bestOf * 2 - 1);
    if (isFull) {
      return {
        type: 'full_distance',
        title: '激战满盘',
        detail: `与${m.opponent.wecomName}激战至最后一盘，虽败犹荣`,
        score: m.scoreSummary
      };
    }
  }

  // ⑥ elo_positive — 本次赛事 ELO 净增长（来自 placementAwards 的 eloDelta，或参赛者积分获得）
  // 简化：如果用户参赛 + placementAwards 里有奖励 → 视为 ELO 正向
  const award = (tournament.placementAwards || []).find(a => a.openid === openid);
  if (award && award.points > 0) {
    return {
      type: 'elo_positive',
      title: '积分进账',
      detail: `本次赛事获得 ${award.points} 积分，实力稳步提升`,
      score: ''
    };
  }

  // ⑦ first_tournament — 首次参赛（外部判定，这里返回潜在标志，poster.js 决定是否启用）
  // 由于无法在前端可靠判定历史，先归入兜底。

  // ⑧ rank_maintained — 兜底
  // 之前用 findIndex+1 当排名是错的（双打数组里同一队两人都 placement=1，
  // 第二个被找到的人 idx=1 会被当成"亚军"）。直接读 award.placement。
  const myAward = (tournament.placementAwards || []).find(a => a.openid === openid);
  const placement = myAward && myAward.placement;
  // 淘汰赛名次（1-8）展示数字；小组赛名次（≥100）展示 place 中文；否则兜底
  const hasKnockoutPlacement = placement && placement > 0 && placement <= 8;
  const hasGroupPlacement = placement && placement >= 100;
  const detailText = hasKnockoutPlacement
    ? `本次赛事第 ${placement} 名，持续在场`
    : (hasGroupPlacement && myAward.place)
      ? `${myAward.place}，持续在场`
      : `参与本次${LEVEL_TEXT[tournament.level] || '赛事'}，持续在场`;
  return {
    type: 'rank_maintained',
    title: '稳健发挥',
    detail: detailText,
    score: ''
  };
}

module.exports = { computeHighlight, collectUserMatches, parseRating };
