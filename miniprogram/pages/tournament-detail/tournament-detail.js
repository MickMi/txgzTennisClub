const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');
const { formatDate } = require('../../utils/format.js');

const LEVEL_MAP = { major: '半年赛', challenge: '月赛', friendly: '周赛' };
const STATUS_MAP = { signup: '报名中', group: '小组赛', knockout: '淘汰赛', finished: '已结束' };

// 抽签时根据报名人数推荐"组数 / 晋级人数"
//   ≤6 人：1 组循环 + 取前 4（不足 4 时按实际人数）→ 全员或大半进 KO
//   7-8 人：2 组 / 每组前 2
//   9-12 人：3 组 / 每组前 2
//   13-16 人：4 组 / 每组前 2
//   17-24 人：6 组 / 每组前 2
//   25+：8 组 / 每组前 2
function suggestDrawConfig(playerCount) {
  if (playerCount <= 6) return { groupCount: 1, advanceCount: Math.min(4, playerCount) };
  if (playerCount <= 8) return { groupCount: 2, advanceCount: 2 };
  if (playerCount <= 12) return { groupCount: 3, advanceCount: 2 };
  if (playerCount <= 16) return { groupCount: 4, advanceCount: 2 };
  if (playerCount <= 24) return { groupCount: 6, advanceCount: 2 };
  return { groupCount: 8, advanceCount: 2 };
}

function combinations(players, size) {
  if (size === 1) return players.map(player => [player]);
  const result = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) result.push([players[i], players[j]]);
  }
  return result;
}

// 推荐只做轮换提示：优先低出场，降低连续上场、重复搭档和完全重复对阵的优先级。
function buildCourtRecommendations(teamAPlayers, teamBPlayers, encounters) {
  if (!teamAPlayers.length || !teamBPlayers.length) return [];
  const lineupSize = teamAPlayers.length >= 2 && teamBPlayers.length >= 2 ? 2 : 1;
  const aCombos = combinations(teamAPlayers, lineupSize);
  const bCombos = combinations(teamBPlayers, lineupSize);
  const played = encounters || [];
  const appearances = {};
  const pairCounts = {};
  const matchupCounts = {};
  const keyOf = lineup => lineup.map(player => player.openid).slice().sort().join('|');
  played.forEach(encounter => {
    const a = (encounter.lineup && encounter.lineup.A) || [];
    const b = (encounter.lineup && encounter.lineup.B) || [];
    [...a, ...b].forEach(openid => { appearances[openid] = (appearances[openid] || 0) + 1; });
    pairCounts[`A:${a.slice().sort().join('|')}`] = (pairCounts[`A:${a.slice().sort().join('|')}`] || 0) + 1;
    pairCounts[`B:${b.slice().sort().join('|')}`] = (pairCounts[`B:${b.slice().sort().join('|')}`] || 0) + 1;
    const matchupKey = `${a.slice().sort().join('|')}::${b.slice().sort().join('|')}`;
    matchupCounts[matchupKey] = (matchupCounts[matchupKey] || 0) + 1;
  });
  const last = played[played.length - 1];
  const lastPlayers = new Set(last ? [
    ...((last.lineup && last.lineup.A) || []),
    ...((last.lineup && last.lineup.B) || [])
  ] : []);

  const candidates = [];
  aCombos.forEach(aPlayers => bCombos.forEach(bPlayers => {
    const aKey = keyOf(aPlayers);
    const bKey = keyOf(bPlayers);
    const lineup = [...aPlayers, ...bPlayers];
    const appearanceScore = lineup.reduce((sum, player) => sum + (appearances[player.openid] || 0), 0) * 100;
    const recentScore = lineup.reduce((sum, player) => sum + (lastPlayers.has(player.openid) ? 18 : 0), 0);
    const repeatScore = ((pairCounts[`A:${aKey}`] || 0) + (pairCounts[`B:${bKey}`] || 0)) * 24;
    const matchupScore = (matchupCounts[`${aKey}::${bKey}`] || 0) * 60;
    candidates.push({
      lineup: { A: aPlayers.map(player => player.openid), B: bPlayers.map(player => player.openid) },
      aText: aPlayers.map(player => player.wecomName).join(' / '),
      bText: bPlayers.map(player => player.wecomName).join(' / '),
      score: appearanceScore + recentScore + repeatScore + matchupScore,
      stableKey: `${aKey}::${bKey}`
    });
  }));
  return candidates.sort((left, right) => left.score - right.score || left.stableKey.localeCompare(right.stableKey));
}

Page({
  data: {
    id: '',
    t: null,
    user: null,
    isOwner: false,
    signed: false,
    activeTab: 0, // 0: 赛况, 1: 签表
    // 抽签设置
    drawGroupCount: 2,
    drawAdvanceCount: 2,
    drawSeedCount: 0,
    // 团队赛抽签弹层（modal-overlay 模式，参考 profile.wxml 的 .edit-overlay）
    showTeamDrawModal: false,
    teamDrawHalfCount: 0,
    teamDrawMaxCourts: 1,
    teamDrawCourtWarning: '',
    teamDraw: { captainA: '', captainB: '', bestOf: 6, courts: 1 },
    groupCountOptions: [1, 2, 3, 4, 6, 8],
    advanceOptions: [1, 2, 3, 4],
    // 小组赛录分
    editingGroup: null,
    groupScoreA: '',
    groupScoreB: '',
    // 淘汰赛录分
    editingKO: null,
    koScoreA: '',
    koScoreB: '',
    // 团队赛场地内「记一场」
    showEncounterModal: false,
    editingTeamEncounter: null, // { matchId, courtId, encounterId, isTiebreak }
    encounterTeamAMembers: [],
    encounterTeamBMembers: [],
    showCourtMoveModal: false,
    courtMoveMatchId: '',
    courtMoveCourts: [],
    teamSlotScoreA: '',
    teamSlotScoreB: '',
    teamSlotLineupA: [],      // 选中的 A 队上场队员 openid 数组（最多 2 人）
    teamSlotLineupB: [],
    teamSlotLineupASet: {},   // openid → true（WXML 属性查找，替代 indexOf）
    teamSlotLineupBSet: {},
    courtRecommendationOffsets: {},
    // 双打配对（仅 type=doubles + signup 状态下使用）
    // pairs 形如 [[openid1, openid2], ...]
    // 已选待配对的 openid（点第二人时自动成 pair）
    pairs: [],
    pairSelectedOpenid: '',
    pairsComplete: false,  // 派生：报名玩家是否全部已配对
    // 赛事报名码弹窗
    showQRModal: false,
    // 中途加人弹窗
    showAddPlayerModal: false,
    addPlayerSearch: '',
    addPlayerMembers: [],
    addPlayerFiltered: [],
    addPlayerSelected: [],
    addPlayerSelectedSet: {},
    addPlayerTargetGroup: 0,
    addPlayerTargetTeam: 'A',
    addPlayerGroupLabels: [],
    addPlayerNameMap: {},
    // 调整赛制弹窗
    showConfigModal: false,
    configSetsOnly: false,
    configForm: { advanceCount: 2, bestOf: 6 },
    configBestOfOptions: ['四局制', '六局制', '单盘抢 7', '单盘抢 11'],
    configBestOfValues: [4, 6, 7, 11],
    configBestOfIndex: 1
  },

  onLoad(opts) {
    const app = getApp();
    const nav = app.globalData.nav;
    this.setData({
      id: opts.id,
      user: getCachedUser(),
      navTop: nav ? nav.navTopRpx : 0,
      capsuleGap: nav ? nav.capsuleGapRpx : 190
    });
  },

  onShow() {
    if (this.data.id) this.load();
  },

  goBack() {
    wx.navigateBack();
  },

  // 跳转海报页：A2 决策 — 用 ActionSheet 让用户先选两种海报，再跳
  // 未参赛用户只能看「赛事战报」（个人战绩卡需要参赛数据）
  goPoster() {
    const id = this.data.id;
    if (!id) return;
    const signed = this.data.signed;
    const itemList = signed ? ['我的战绩卡', '赛事战报'] : ['赛事战报'];
    wx.showActionSheet({
      itemList,
      success: res => {
        let type;
        if (signed) {
          type = res.tapIndex === 0 ? 'personal' : 'report';
        } else {
          type = 'report';
        }
        wx.navigateTo({
          url: `/pages/poster/poster?tournamentId=${id}&type=${type}`
        });
      }
    });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    return api.getTournament(this.data.id).then(t => {
      const me = this.data.user;
      const myOpenid = me && me.openid;
      const isOwner = !!(me && (t.creator === me.openid || me.role === 'admin'));
      const signed = !!(me && (t.players || []).some(p => p.openid === me.openid));

      const teamAMembers = (t.type === 'team' && t.teams && t.teams[0]) ? (t.teams[0].members || []) : [];
      const teamBMembers = (t.type === 'team' && t.teams && t.teams[1]) ? (t.teams[1].members || []) : [];
      const memberMap = {};
      [...teamAMembers, ...teamBMembers].forEach(member => {
        if (member && member.openid) memberMap[member.openid] = member;
      });
      const decorateLineup = lineup => (lineup || []).map(openid => memberMap[openid] || { openid, wecomName: '未知队员' });
      const decorateEncounter = encounter => ({
        ...encounter,
        lineupAPlayers: decorateLineup(encounter.lineup && encounter.lineup.A),
        lineupBPlayers: decorateLineup(encounter.lineup && encounter.lineup.B)
      });
      const decorateTeamMatch = match => {
        const legacySlots = !Array.isArray(match.courts) ? (match.slots || []) : [];
        const rawCourts = Array.isArray(match.courts)
          ? match.courts
          : [{
              id: 'legacy_court',
              name: '历史对局',
              players: [...teamAMembers, ...teamBMembers].map(member => member.openid),
              encounters: legacySlots.filter(slot => !slot.isTiebreak && slot.winner)
            }];
        const courts = rawCourts.map((court, courtIndex) => {
          const players = (court.players || []).map(openid => memberMap[openid]).filter(Boolean);
          const teamAPlayers = players.filter(player => teamAMembers.some(member => member.openid === player.openid));
          const teamBPlayers = players.filter(player => teamBMembers.some(member => member.openid === player.openid));
          const decoratedEncounters = (court.encounters || []).map(decorateEncounter);
          const scoredEncounters = decoratedEncounters.filter(encounter => encounter.winner);
          const pendingEncounter = decoratedEncounters.find(encounter => !encounter.winner) || null;
          const recommendationCandidates = buildCourtRecommendations(teamAPlayers, teamBPlayers, scoredEncounters);
          const offset = this.data.courtRecommendationOffsets[court.id] || 0;
          return {
            ...court,
            displayIndex: courtIndex + 1,
            playerCount: players.length,
            teamAPlayers,
            teamBPlayers,
            encounters: decoratedEncounters,
            pendingEncounter,
            recommendationCandidates,
            recommendation: recommendationCandidates.length > 0
              ? recommendationCandidates[offset % recommendationCandidates.length]
              : null,
            canRemove: Array.isArray(match.courts) && !(court.encounters || []).some(encounter => encounter.winner),
            canScore: isOwner || !!(myOpenid && (court.players || []).includes(myOpenid)),
            densityWarning: players.length < 4
              ? '场内人数较少，轮换密度可能不足'
              : players.length > 8 ? '场内人数较多，等待时间可能较长' : ''
          };
        });
        const legacyTiebreak = legacySlots.find(slot => slot.isTiebreak);
        const tiebreak = match.tiebreak || legacyTiebreak;
        const encounterCount = courts.reduce(
          (sum, court) => sum + court.encounters.filter(encounter => encounter.winner).length,
          0
        );
        return {
          ...match,
          courts,
          tiebreak: tiebreak ? decorateEncounter(tiebreak) : null,
          encounterCount,
          canScoreTiebreak: isOwner || !!(myOpenid && t.captains && (
            myOpenid === t.captains.A || myOpenid === t.captains.B
          )),
          isLegacyTeamMatch: !Array.isArray(match.courts)
        };
      };

      // 给每场 match 加 canRevert 标记（前端展示控制；后端仍会再校验）
      // 规则：match.winner 存在 + (我是参赛方 || 我是 creator || 我是 admin)
      const tagMatch = (m) => {
        if (!m || !m.winner) return m;
        const inMatch = !!(myOpenid && m.playerA && m.playerB && (
          m.playerA.openid === myOpenid || m.playerB.openid === myOpenid
        ));
        return { ...m, canRevert: inMatch || isOwner };
      };
      const groups = (t.groups || []).map(g => ({
        ...g,
        matches: (g.matches || []).map(match => t.type === 'team' ? decorateTeamMatch(match) : tagMatch(match))
      }));
      const knockout = t.knockout
        ? {
            ...t.knockout,
            rounds: (t.knockout.rounds || []).map((r, ri) => ({
              ...r,
              matches: (r.matches || []).map((m, mi) => {
                const tagged = tagMatch(m);
                if (!tagged.canRevert) return tagged;
                // 末梢限制：如果下一轮的对应位置已录分，前端隐藏撤回（提示后端会拦）
                const nextRound = t.knockout.rounds[ri + 1];
                if (nextRound) {
                  const nextMatch = nextRound.matches[Math.floor(mi / 2)];
                  if (nextMatch && nextMatch.winner) {
                    return { ...tagged, canRevert: false, revertBlockedByNext: true };
                  }
                }
                return tagged;
              })
            }))
          }
        : null;
      const hasRecordedScores = t.type === 'team'
        ? groups.some(group => (group.matches || []).some(match =>
            match.encounterCount > 0 || !!(match.tiebreak && match.tiebreak.winner)
          ))
        : groups.some(group => (group.matches || []).some(match => !!match.winner));

      // 抽签默认值：signup 状态下用智能推荐覆盖 create 时设的值（按当前报名人数推荐）；
      // 已 draw 后的状态保留实际配置
      const playerCount = (t.players || []).length;
      const suggested = suggestDrawConfig(playerCount);
      const useDrawSuggest = t.status === 'signup';
      const drawGroupCount = useDrawSuggest ? suggested.groupCount : (t.config.groupCount || 2);
      const drawAdvanceCount = useDrawSuggest ? suggested.advanceCount : (t.config.advanceCount || 2);

      // 双打配对状态推导（保持当前已配对，过滤掉已退出/不存在的玩家）
      const isDoubles = t.type === 'doubles';
      const validOids = new Set((t.players || []).map(p => p.openid));
      const cleanedPairs = (this.data.pairs || []).filter(([a, b]) =>
        validOids.has(a) && validOids.has(b)
      );
      const pairedOids = new Set();
      cleanedPairs.forEach(([a, b]) => { pairedOids.add(a); pairedOids.add(b); });
      const pairsComplete = isDoubles
        ? (playerCount > 0 && playerCount % 2 === 0 && pairedOids.size === playerCount)
        : true;
      // 派生：未配对玩家列表（wxml 直接 wx:for，避免 wxml 内做集合判断）
      const unpairedPlayers = isDoubles
        ? (t.players || []).filter(p => !pairedOids.has(p.openid))
        : [];
      // 派生：已配对详情（含 wecomName 显示，wxml 直接渲染）
      const oidToName = {};
      (t.players || []).forEach(p => { oidToName[p.openid] = p.wecomName; });
      const pairsDetail = cleanedPairs.map(([a, b], idx) => ({
        idx,
        a: { openid: a, wecomName: oidToName[a] || '?' },
        b: { openid: b, wecomName: oidToName[b] || '?' }
      }));

      this.setData({
        t: {
          ...t,
          groups,
          knockout,
          dateText: formatDate(t.matchDate),
          levelText: LEVEL_MAP[t.level] || '周赛',
          statusText: (t.type === 'team' && t.status === 'group') ? '团队赛' : (STATUS_MAP[t.status] || t.status)
        },
        isOwner,
        signed,
        drawGroupCount,
        drawAdvanceCount,
        drawSeedCount: t.config.seedCount || 0,
        pairs: cleanedPairs,
        pairsComplete,
        unpairedPlayers,
        pairsDetail,
        // 团队赛：抽出 A/B 队成员供 wxml 渲染队员名单
        teamAMembers,
        teamBMembers,
        // 队长名字用于队名显示
        teamAName: (() => {
          if (t.type !== 'team' || !t.captains || !t.captains.A) return 'A 队';
          const mems = (t.teams && t.teams[0] && t.teams[0].members) || [];
          const cap = mems.find(m => m.openid === t.captains.A);
          return cap ? cap.wecomName + '队' : 'A 队';
        })(),
        teamBName: (() => {
          if (t.type !== 'team' || !t.captains || !t.captains.B) return 'B 队';
          const mems = (t.teams && t.teams[1] && t.teams[1].members) || [];
          const cap = mems.find(m => m.openid === t.captains.B);
          return cap ? cap.wecomName + '队' : 'B 队';
        })(),
        // openid → wecomName 映射（历史数据展示兼容）
        lineupNameMap: (t.type === 'team' && t.teams) ? t.teams.reduce((m, tu) => {
          (tu.members || []).forEach(mem => { if (mem.openid) m[mem.openid] = mem.wecomName; });
          return m;
        }, {}) : {},
        // 团队赛调队：仅当 team + status=group + 所有场地都没录比分时可用
        canSwapMembers: (() => {
          if (t.type !== 'team' || t.status !== 'group') return false;
          const g0 = groups[0];
          const m0 = g0 && g0.matches && g0.matches[0];
          if (!m0) return false;
          return m0.encounterCount === 0 && !(m0.tiebreak && m0.tiebreak.winner);
        })(),
        // 团队赛增删场地会重排全部人员，只允许完全未录分时操作。
        canAdjustCourts: (() => {
          if (t.type !== 'team' || t.status !== 'group') return false;
          const g0 = groups[0];
          const m0 = g0 && g0.matches && g0.matches[0];
          if (!m0 || m0.status === 'finished') return false;
          return !m0.isLegacyTeamMatch && !m0.tiebreak && m0.encounterCount === 0;
        })(),
        // SETS 仅管理员可在小组赛且完全未录分时修改；后端会再次校验。
        canEditSets: isOwner && t.status === 'group' && !hasRecordedScores,
        // 自由轮换无预设场次：至少已记一场，管理员即可发起结束。
        canFinishMatch: (() => {
          if (!isOwner || t.type !== 'team' || t.status !== 'group') return false;
          const g0 = groups[0];
          const m0 = g0 && g0.matches && g0.matches[0];
          if (!m0 || m0.status === 'finished') return false;
          return m0.encounterCount > 0 && !m0.tiebreak;
        })(),
        finishMatchLabel: '结束比赛',
        // 重建淘汰赛对阵：仅 knockout 状态 + 所有淘汰赛 match 已撤回 + 非团队赛
        canRegenKnockout: (() => {
          if (t.type === 'team' || t.status !== 'knockout') return false;
          const rounds = t.knockout && t.knockout.rounds;
          if (!Array.isArray(rounds) || rounds.length === 0) return false;
          return rounds.every(rd => (rd.matches || []).every(m => !m.winner));
        })(),
        // 三四名决赛相关状态
        hasThirdPlaceMatch: (() => {
          const rounds = t.knockout && t.knockout.rounds;
          if (!Array.isArray(rounds) || rounds.length < 2) return false;
          return (rounds[rounds.length - 1].matches || []).some(m => m.isThirdPlace);
        })(),
        canAddThirdPlace: (() => {
          if (t.type === 'team' || t.status !== 'knockout') return false;
          const rounds = t.knockout && t.knockout.rounds;
          if (!Array.isArray(rounds) || rounds.length < 2) return false;
          if (t.noThirdPlace) return false;
          const lastRound = rounds[rounds.length - 1];
          if ((lastRound.matches || []).some(m => m.isThirdPlace)) return false;
          if (lastRound.matches[0] && lastRound.matches[0].winner) return false;
          const sfRound = rounds[rounds.length - 2];
          return (sfRound.matches || []).every(m => m.winner);
        })(),
        thirdPlaceMatch: (() => {
          const rounds = t.knockout && t.knockout.rounds;
          if (!Array.isArray(rounds) || rounds.length < 2) return null;
          return (rounds[rounds.length - 1].matches || []).find(m => m.isThirdPlace) || null;
        })()
      });
    });
  },

  onTabChange(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab) });
  },

  // 报名
  onSignup() {
    const user = getCachedUser();
    if (!user || !user.wecomName) {
      wx.showModal({
        title: '尚未完成登记',
        content: '参加比赛前需要先登记身份信息，是否现在去登记？',
        confirmText: '去登记',
        success: res => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/onboarding/onboarding' });
          }
        }
      });
      return;
    }
    api.signupTournament(this.data.id).then(() => {
      wx.showToast({ title: '已报名', icon: 'success' });
      this.load();
    }).catch(err => {
      // api.call 已弹 toast；仅对"未登记"额外提供跳转引导
      const msg = (err && err.msg) || '';
      if (msg.includes('登记')) {
        wx.showModal({
          title: '尚未完成登记',
          content: msg + '，是否现在去登记？',
          confirmText: '去登记',
          success: res => {
            if (res.confirm) wx.navigateTo({ url: '/pages/onboarding/onboarding' });
          }
        });
      }
    });
  },

  // 取消报名
  onCancelSignup() {
    wx.showModal({
      title: '取消报名',
      content: '确认取消？',
      success: res => {
        if (res.confirm) {
          api.cancelSignupTournament(this.data.id).then(() => {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 抽签参数调整
  onDrawGroupCountChange(e) {
    this.setData({ drawGroupCount: this.data.groupCountOptions[+e.detail.value] });
  },

  onDrawAdvanceChange(e) {
    this.setData({ drawAdvanceCount: this.data.advanceOptions[+e.detail.value] });
  },

  onDrawSeedInput(e) {
    this.setData({ drawSeedCount: e.detail.value });
  },

  onDrawSeedBlur() {
    const seedCount = Math.max(0, parseInt(this.data.drawSeedCount) || 0);
    this.setData({ drawSeedCount: seedCount });
  },

  // 抽签
  onDraw() {
    const { drawGroupCount, drawAdvanceCount, drawSeedCount, pairs, t } = this.data;
    const normalizedSeedCount = Math.max(0, parseInt(drawSeedCount) || 0);
    const playerCount = t.players.length;
    const isDoubles = t.type === 'doubles';

    // 双打必须先完成配对
    if (isDoubles) {
      if (playerCount % 2 !== 0) {
        return wx.showToast({ title: '双打需要偶数报名（请先关闭报名补人/退人）', icon: 'none', duration: 2500 });
      }
      const paired = new Set();
      pairs.forEach(([a, b]) => { paired.add(a); paired.add(b); });
      if (paired.size !== playerCount) {
        return wx.showToast({ title: `还有 ${playerCount - paired.size} 人未配对`, icon: 'none' });
      }
    }

    const unitName = isDoubles ? '对' : '人';
    const unitCount = isDoubles ? pairs.length : playerCount;
    const seedTxt = normalizedSeedCount > 0 ? ' · ' + normalizedSeedCount + '种子' : ' · 随机';
    wx.showModal({
      title: '确认抽签分组',
      content: `${unitCount}${unitName} → 分${drawGroupCount}组 → 每组前${drawAdvanceCount}名晋级${seedTxt}`,
      success: res => {
        if (res.confirm) {
          const opts = {
            groupCount: drawGroupCount,
            advanceCount: drawAdvanceCount,
            seedCount: normalizedSeedCount
          };
          if (isDoubles) opts.pairs = pairs;
          api.drawTournament(this.data.id, opts).then(() => {
            wx.showToast({ title: '抽签完成', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 团队赛抽签弹层：开 / 关
  onShowTeamDrawModal() {
    // 用 tournament.captains 预填（如果已存在）
    const t = this.data.t;
    const existing = (t && t.captains) || {};
    const playerCount = (t && t.players) ? t.players.length : 0;
    this.setData({
      showTeamDrawModal: true,
      teamDrawHalfCount: playerCount > 0 ? Math.ceil(playerCount / 2) : '?',
      teamDrawMaxCourts: Math.max(1, Math.floor(playerCount / 2)),
      teamDrawCourtWarning: '',
      teamDraw: {
        captainA: existing.A || '',
        captainB: existing.B || '',
        bestOf: t && t.bestOf ? t.bestOf : 6,
        courts: (t && t.teamMatchCourts) ? t.teamMatchCourts : Math.max(1, Math.ceil(playerCount / 6))
      }
    });
  },
  onCloseTeamDrawModal() {
    this.setData({ showTeamDrawModal: false });
  },

  // 团队赛：加一片场地
  onAddCourt(e) {
    const mid = e.currentTarget.dataset.mid;
    wx.showLoading({ title: '添加中' });
    api.addCourt(this.data.id, mid).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已加场地', icon: 'success' });
      this.load();
    }).catch(err => {
      wx.hideLoading();
      if (err && err.msg) wx.showToast({ title: err.msg, icon: 'none' });
    });
  },

  onRemoveCourt(e) {
    const { mid, cid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: `移除${name || '场地'}`,
      content: '场内队员会自动补到其他人数较少的场地。',
      confirmText: '移除',
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.showLoading({ title: '移除中' });
        api.removeCourt(this.data.id, mid, cid).then(() => {
          wx.showToast({ title: '已移除', icon: 'success' });
          this.load();
        }).catch(err => {
          wx.showToast({ title: (err && err.msg) || '移除失败', icon: 'none' });
        }).then(() => wx.hideLoading());
      }
    });
  },

  // 团队赛：手动结束比赛
  onFinishTeamMatch() {
    const t = this.data.t || {};
    const group = t.groups && t.groups[0];
    const match = group && group.matches && group.matches[0];
    if (!match) { wx.showToast({ title: '未找到比赛数据，请刷新重试', icon: 'none' }); return; }
    const mid = match.id;
    const teamScoreA = (match.teamScore && match.teamScore.A) || 0;
    const teamScoreB = (match.teamScore && match.teamScore.B) || 0;

    let content;
    if (teamScoreA !== teamScoreB) {
      content = `A 队 ${teamScoreA} : B 队 ${teamScoreB}\n${teamScoreA > teamScoreB ? 'A 队' : 'B 队'} 获胜，确定结束比赛？`;
    } else {
      content = `两队 ${teamScoreA} : ${teamScoreB} 平分\n将进入一球制胜（队长对决）`;
    }
    wx.showModal({
      title: '结束比赛',
      content,
      // 微信原生弹窗的 confirmText 最多 4 个字符，超长会导致弹窗创建失败。
      confirmText: teamScoreA !== teamScoreB ? '确定结束' : '开始加赛',
      confirmColor: '#c4452f',
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.showLoading({ title: '处理中' });
        api.finishTeamMatch(this.data.id, mid).then(() => {
          wx.hideLoading();
          wx.showToast({ title: teamScoreA !== teamScoreB ? '比赛已结束' : '一球制胜已创建', icon: 'success' });
          this.load();
        }).catch(err => {
          wx.hideLoading();
          const msg = (err && err.msg) || (err && err.message) || '操作失败，请确认云函数已部署';
          wx.showToast({ title: msg, icon: 'none', duration: 3000 });
        });
      },
      fail: (err) => {
        console.error('打开结束比赛弹窗失败', err);
        wx.showToast({ title: '操作弹窗打开失败，请重试', icon: 'none' });
      }
    });
  },

  // 团队赛调队（Plan-4 R4-B.5）
  onShowSwapModal() { this.setData({ showSwapModal: true }); },
  onCloseSwapModal() { this.setData({ showSwapModal: false }); },
  onSwapMember(e) {
    const { openid } = e.currentTarget.dataset;
    wx.showLoading({ title: '调整中…' });
    api.swapTeamMember(this.data.id, openid)
      .then(() => {
        wx.showToast({ title: '已调整', icon: 'success' });
        this.load();   // 重新拉数据，重新算 teamAMembers/teamBMembers
      })
      .catch(err => wx.showToast({ title: (err && err.msg) || '调整失败', icon: 'none' }))
      .then(() => wx.hideLoading());
  },

  onShowCourtMoveModal(e) {
    const matchId = e.currentTarget.dataset.mid;
    const t = this.data.t || {};
    const group = t.groups && t.groups[0];
    const match = group && (group.matches || []).find(item => item.id === matchId);
    if (!match) return;
    this.setData({
      showCourtMoveModal: true,
      courtMoveMatchId: matchId,
      courtMoveCourts: match.courts || []
    });
  },

  onCloseCourtMoveModal() {
    this.setData({ showCourtMoveModal: false, courtMoveMatchId: '', courtMoveCourts: [] });
  },

  onMoveCourtMember(e) {
    const { openid, cid } = e.currentTarget.dataset;
    const targets = (this.data.courtMoveCourts || []).filter(court => court.id !== cid);
    if (targets.length === 0) return;
    wx.showActionSheet({
      itemList: targets.map(court => `${court.name} · ${court.playerCount} 人`),
      success: ({ tapIndex }) => {
        const target = targets[tapIndex];
        wx.showLoading({ title: '调整中' });
        api.moveCourtMember(this.data.id, openid, target.id).then(() => {
          wx.showToast({ title: '已调整场地', icon: 'success' });
          this.setData({ showCourtMoveModal: false });
          this.load();
        }).catch(err => {
          wx.showToast({ title: (err && err.msg) || '调整失败', icon: 'none' });
        }).then(() => wx.hideLoading());
      }
    });
  },

  onPanelTap() {
    // 阻止冒泡到外层 edit-overlay（参考 profile.wxml 的 .edit-panel catchtap）
  },
  onTeamCaptainAChange(e) {
    this.setData({ 'teamDraw.captainA': e.detail.value });
  },
  onTeamCaptainBChange(e) {
    this.setData({ 'teamDraw.captainB': e.detail.value });
  },
  onTeamBestOfChange(e) {
    const v = parseInt(e.detail.value);
    this.setData({ 'teamDraw.bestOf': v });
  },
  onTeamCourtsInput(e) {
    const value = e.detail.value;
    const parsed = parseInt(value);
    const playerCount = (this.data.t && this.data.t.players || []).length;
    let warning = '';
    if (!isNaN(parsed) && parsed > 0) {
      const density = playerCount / parsed;
      if (parsed > this.data.teamDrawMaxCourts) warning = `两队人数最多支持 ${this.data.teamDrawMaxCourts} 片混队场地`;
      else if (density < 4) warning = '平均每片少于 4 人，轮换密度可能不足';
      else if (density > 8) warning = '平均每片超过 8 人，等待时间可能较长';
    }
    this.setData({ 'teamDraw.courts': value, teamDrawCourtWarning: warning });
  },
  onTeamCourtsBlur() {
    const courts = Math.min(this.data.teamDrawMaxCourts, Math.max(1, parseInt(this.data.teamDraw.courts) || 1));
    this.setData({ 'teamDraw.courts': courts, teamDrawCourtWarning: '' });
  },
  onTeamDrawConfirm() {
    const { captainA, captainB, bestOf, courts } = this.data.teamDraw;
    if (!captainA || !captainB) {
      return wx.showToast({ title: '请选两位队长', icon: 'none' });
    }
    if (captainA === captainB) {
      return wx.showToast({ title: 'A/B 队长不能是同一人', icon: 'none' });
    }
    const normalizedCourts = Math.max(1, parseInt(courts) || 1);
    if (normalizedCourts > this.data.teamDrawMaxCourts) {
      return wx.showToast({ title: `最多 ${this.data.teamDrawMaxCourts} 片场地`, icon: 'none' });
    }
    wx.showLoading({ title: '抽签中…' });
    api
      .drawTournament(this.data.id, {
        captainA, captainB, bestOf,
        teamMatchCourts: normalizedCourts
      })
      .then(() => {
        this.setData({ showTeamDrawModal: false });
        wx.showToast({ title: '抽签完成', icon: 'success' });
        this.load();
      })
      .catch(err => {
        wx.showToast({ title: (err && err.msg) || '抽签失败', icon: 'none' });
      })
      .then(() => wx.hideLoading());
  },

  // 派生：把当前 pairs 重新算一遍 unpairedPlayers / pairsDetail / pairsComplete
  // 配对状态变化的 4 处入口都用这个统一更新
  recomputePairing(newPairs) {
    const players = (this.data.t && this.data.t.players) || [];
    const playerCount = players.length;
    const pairedOids = new Set();
    newPairs.forEach(([a, b]) => { pairedOids.add(a); pairedOids.add(b); });
    const oidToName = {};
    players.forEach(p => { oidToName[p.openid] = p.wecomName; });
    return {
      pairs: newPairs,
      pairsComplete: playerCount > 0 && playerCount % 2 === 0 && pairedOids.size === playerCount,
      unpairedPlayers: players.filter(p => !pairedOids.has(p.openid)),
      pairsDetail: newPairs.map(([a, b], idx) => ({
        idx,
        a: { openid: a, wecomName: oidToName[a] || '?' },
        b: { openid: b, wecomName: oidToName[b] || '?' }
      }))
    };
  },

  // 双打：点击玩家头像切换"待配对"高亮；如果已选过另一人则形成 pair
  onTogglePair(e) {
    const oid = e.currentTarget.dataset.openid;
    if (!oid) return;
    const { pairs, pairSelectedOpenid } = this.data;
    // 已经在某个 pair 里：忽略（要拆配对请用 onUnpair）
    const inSomePair = pairs.some(([a, b]) => a === oid || b === oid);
    if (inSomePair) return;
    // 第一次点：选中
    if (!pairSelectedOpenid) {
      this.setData({ pairSelectedOpenid: oid });
      return;
    }
    // 同一个人再点：取消选择
    if (pairSelectedOpenid === oid) {
      this.setData({ pairSelectedOpenid: '' });
      return;
    }
    // 与已选的人组成 pair
    const newPairs = pairs.concat([[pairSelectedOpenid, oid]]);
    this.setData({
      ...this.recomputePairing(newPairs),
      pairSelectedOpenid: ''
    });
  },

  // 双打：拆掉一个已成的 pair
  onUnpair(e) {
    const idx = +e.currentTarget.dataset.idx;
    if (isNaN(idx)) return;
    const newPairs = this.data.pairs.slice();
    newPairs.splice(idx, 1);
    this.setData(this.recomputePairing(newPairs));
  },

  // 双打：一键清空所有配对
  onResetPairs() {
    this.setData({
      ...this.recomputePairing([]),
      pairSelectedOpenid: ''
    });
  },

  // 双打：随机配对（懒人版，admin 不想手动选时用）
  onRandomPair() {
    const players = (this.data.t && this.data.t.players) || [];
    if (players.length === 0) return;
    if (players.length % 2 !== 0) {
      return wx.showToast({ title: '需要偶数报名才能配对', icon: 'none' });
    }
    const shuffled = players.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      pairs.push([shuffled[i].openid, shuffled[i + 1].openid]);
    }
    this.setData({
      ...this.recomputePairing(pairs),
      pairSelectedOpenid: ''
    });
  },

  // 开始淘汰赛
  onStartKnockout() {
    wx.showModal({
      title: '进入淘汰赛',
      content: '小组赛已全部完成，确认进入淘汰赛阶段？',
      success: res => {
        if (res.confirm) {
          api.startKnockout(this.data.id).then(() => {
            wx.showToast({ title: '淘汰赛开始', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 重算小组排名（使用最新 H2H 逻辑）
  onRecalcStandings() {
    wx.showModal({
      title: '重算排名',
      content: '将按「胜场 → 胜负关系 → 净胜盘」重新计算所有小组排名。不涉及积分变动。',
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.recalcStandings(this.data.id).then(() => {
            wx.showToast({ title: '排名已更新', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '重算失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 重建淘汰赛对阵（先撤回所有淘汰赛比分，再按修正后排名重新生成）
  onRegenKnockout() {
    wx.showModal({
      title: '重建对阵',
      content: '将按修正后的小组排名（含 H2H）重新生成淘汰赛对阵表。不会改动已撤回的比分数据。',
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.regenKnockout(this.data.id).then(() => {
            wx.showToast({ title: '对阵已重建', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '重建失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 小组赛 - 开始录分
  onEditGroupScore(e) {
    const { gi, mid } = e.currentTarget.dataset;
    this.setData({
      editingGroup: { groupIndex: gi, matchId: mid },
      groupScoreA: '',
      groupScoreB: ''
    });
  },

  onGroupScoreAInput(e) {
    this.setData({ groupScoreA: e.detail.value });
  },

  onGroupScoreBInput(e) {
    this.setData({ groupScoreB: e.detail.value });
  },

  onCancelGroupScore() {
    this.setData({ editingGroup: null });
  },

  onSaveGroupScore() {
    const a = parseInt(this.data.groupScoreA);
    const b = parseInt(this.data.groupScoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    const { groupIndex, matchId } = this.data.editingGroup;
    api.scoreGroup(this.data.id, groupIndex, matchId, a, b).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ editingGroup: null });
      this.load();
    });
  },

  // 团队赛：打开场地内对局录分，或全局一球制胜录分。
  onOpenEncounterModal(e) {
    const { mid, cid, eid, tiebreak, recommend } = e.currentTarget.dataset;
    const isTiebreak = tiebreak === true || tiebreak === 'true';
    const useRecommendation = recommend === true || recommend === 'true';
    const t = this.data.t || {};
    const match = (t.groups && t.groups[0] && t.groups[0].matches || []).find(item => item.id === mid);
    if (!match) return;
    const court = !isTiebreak && (match.courts || []).find(item => item.id === cid);
    if (!isTiebreak && !court) return;
    if (isTiebreak ? !match.canScoreTiebreak : !court.canScore) {
      wx.showToast({ title: isTiebreak ? '仅队长或管理员可录分' : '你只能录入所在场地的比分', icon: 'none' });
      return;
    }
    const encounter = isTiebreak
      ? match.tiebreak
      : ((court.encounters || []).find(item => item.id === eid) || null);
    const recommendation = useRecommendation && court ? court.recommendation : null;
    const lineA = recommendation
      ? recommendation.lineup.A.slice()
      : encounter && encounter.lineup ? (encounter.lineup.A || []).slice() : [];
    const lineB = recommendation
      ? recommendation.lineup.B.slice()
      : encounter && encounter.lineup ? (encounter.lineup.B || []).slice() : [];
    const setA = {}; lineA.forEach(openid => { setA[openid] = true; });
    const setB = {}; lineB.forEach(openid => { setB[openid] = true; });
    this.setData({
      showEncounterModal: true,
      editingTeamEncounter: {
        matchId: mid,
        courtId: cid || '',
        encounterId: eid || '',
        isTiebreak,
        isNew: !isTiebreak && !encounter,
        hasScore: !!(encounter && encounter.winner)
      },
      encounterTeamAMembers: isTiebreak ? (match.tiebreak.lineupAPlayers || []) : (court.teamAPlayers || []),
      encounterTeamBMembers: isTiebreak ? (match.tiebreak.lineupBPlayers || []) : (court.teamBPlayers || []),
      teamSlotScoreA: encounter && encounter.winner ? String(encounter.setsA) : '',
      teamSlotScoreB: encounter && encounter.winner ? String(encounter.setsB) : '',
      teamSlotLineupA: lineA,
      teamSlotLineupB: lineB,
      teamSlotLineupASet: setA,
      teamSlotLineupBSet: setB
    });
  },

  onCycleCourtRecommendation(e) {
    const { cid } = e.currentTarget.dataset;
    const offsets = { ...(this.data.courtRecommendationOffsets || {}) };
    offsets[cid] = (offsets[cid] || 0) + 1;
    this.setData({ courtRecommendationOffsets: offsets });
    this.load();
  },

  onCloseEncounterModal() {
    this.setData({ showEncounterModal: false, editingTeamEncounter: null });
  },

  // toggle 上场队员（chip 多选，每队最多 2 人）
  onToggleEncounterLineup(e) {
    const { side, openid } = e.currentTarget.dataset;
    const isA = side === 'A';
    const arrKey = isA ? 'teamSlotLineupA' : 'teamSlotLineupB';
    const setKey = isA ? 'teamSlotLineupASet' : 'teamSlotLineupBSet';
    const cur = (this.data[arrKey] || []).slice();
    const curSet = { ...(this.data[setKey] || {}) };
    const idx = cur.indexOf(openid);
    if (idx >= 0) {
      cur.splice(idx, 1);
      delete curSet[openid];
    } else {
      if (cur.length >= 2) {
        wx.showToast({ title: '每队最多 2 人', icon: 'none' });
        return;
      }
      cur.push(openid);
      curSet[openid] = true;
    }
    this.setData({ [arrKey]: cur, [setKey]: curSet });
  },

  onTeamSlotAInput(e) {
    this.setData({ teamSlotScoreA: e.detail.value });
  },

  onTeamSlotBInput(e) {
    this.setData({ teamSlotScoreB: e.detail.value });
  },

  onSaveEncounterLineup() {
    const lineA = this.data.teamSlotLineupA || [];
    const lineB = this.data.teamSlotLineupB || [];
    const editing = this.data.editingTeamEncounter;
    if (!editing || editing.isTiebreak) return;
    if (lineA.length === 0 || lineA.length !== lineB.length) {
      wx.showToast({ title: '两队上场人数需相同', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '添加中' });
    api.saveEncounterLineup(
      this.data.id,
      editing.matchId,
      editing.courtId,
      lineA,
      lineB,
      editing.encounterId
    ).then(() => {
      wx.showToast({ title: '场次已添加', icon: 'success' });
      this.setData({ showEncounterModal: false, editingTeamEncounter: null });
      this.load();
    }).catch(err => {
      wx.showToast({ title: (err && err.msg) || '添加失败', icon: 'none' });
    }).then(() => wx.hideLoading());
  },

  onSaveEncounterScore() {
    const a = parseInt(this.data.teamSlotScoreA);
    const b = parseInt(this.data.teamSlotScoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    const lineA = this.data.teamSlotLineupA || [];
    const lineB = this.data.teamSlotLineupB || [];
    const editing = this.data.editingTeamEncounter;
    if (!editing) return;
    if (!editing.isTiebreak && !editing.encounterId) {
      wx.showToast({ title: '请先确认上场人员', icon: 'none' });
      return;
    }
    if (!editing.isTiebreak && (lineA.length === 0 || lineA.length !== lineB.length)) {
      wx.showToast({ title: '两队上场人数需相同', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    api.enterEncounterScore(
      this.data.id,
      editing.matchId,
      editing.courtId,
      a,
      b,
      lineA,
      lineB,
      editing.encounterId,
      editing.isTiebreak
    ).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showEncounterModal: false, editingTeamEncounter: null });
      this.load();
    }).catch(err => {
      wx.showToast({ title: (err && err.msg) || '保存失败', icon: 'none' });
    }).then(() => wx.hideLoading());
  },

  onRevertEncounterScore() {
    const editing = this.data.editingTeamEncounter;
    if (!editing || !editing.encounterId || editing.isTiebreak) return;
    if (!this.data.isOwner) {
      wx.showToast({ title: '仅管理员可撤回比分', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '撤回比分',
      content: '确认撤回这场对局？撤回后将重新计算队际比分和小分；全部比分撤回后可修改 SETS。',
      confirmText: '确认撤回',
      confirmColor: '#c4452f',
      success: res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '撤回中' });
        api.revertEncounterScore(
          this.data.id,
          editing.matchId,
          editing.courtId,
          editing.encounterId
        ).then(() => {
          wx.showToast({ title: '比分已撤回，人员已保留', icon: 'success' });
          this.setData({ showEncounterModal: false, editingTeamEncounter: null });
          this.load();
        }).catch(err => {
          wx.showToast({ title: (err && err.msg) || '撤回失败', icon: 'none' });
        }).then(() => wx.hideLoading());
      }
    });
  },

  // 淘汰赛 - 开始录分
  onEditKOScore(e) {
    const { ri, mid } = e.currentTarget.dataset;
    this.setData({
      editingKO: { roundIndex: ri, matchId: mid },
      koScoreA: '',
      koScoreB: ''
    });
  },

  onKOScoreAInput(e) {
    this.setData({ koScoreA: e.detail.value });
  },

  onKOScoreBInput(e) {
    this.setData({ koScoreB: e.detail.value });
  },

  onCancelKOScore() {
    this.setData({ editingKO: null });
  },

  onSaveKOScore() {
    const a = parseInt(this.data.koScoreA);
    const b = parseInt(this.data.koScoreB);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      wx.showToast({ title: '请输入有效比分', icon: 'none' });
      return;
    }
    if (a === b) {
      wx.showToast({ title: '比分不能相同', icon: 'none' });
      return;
    }
    const { roundIndex, matchId } = this.data.editingKO;
    api.scoreKnockout(this.data.id, roundIndex, matchId, a, b).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ editingKO: null });
      this.load();
    });
  },

  // 删除赛事（creator/admin，所有阶段可用）
  onDeleteTournament() {
    const t = this.data.t;
    if (!t) return;
    const isSignup = t.status === 'signup';
    wx.showModal({
      title: '删除赛事',
      content: isSignup
        ? `确认删除「${t.title}」？已报名的 ${t.players ? t.players.length : 0} 人将被解除报名。此操作不可撤销。`
        : `确认删除「${t.title}」？所有已录比分、ELO 变动、积分将被回滚，赛事数据彻底清除。此操作不可撤销。`,
      confirmColor: '#c4452f',
      success: res => {
        if (res.confirm) {
          api.deleteTournament(this.data.id).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 600);
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 生成赛事报名小程序码
  onShowQRCode() {
    this.setData({ showQRModal: true });
  },

  onCloseQRCode() {
    this.setData({ showQRModal: false });
  },

  // ====== 中途加人 ======
  onShowAddPlayerModal() {
    const t = this.data.t;
    if (!t) return;
    const existingOids = new Set((t.players || []).map(p => p.openid));
    // 团队赛还要把 teams 里的 oid 也算上（避免重复添加已在队里的人）
    if (t.type === 'team' && t.teams) {
      t.teams.forEach(team => (team.members || []).forEach(m => {
        if (m.openid) existingOids.add(m.openid);
      }));
    }
    api.listMembers().then(res => {
      const members = (res && res.list) || [];
      const filtered = members.filter(m =>
        m.wecomName && !existingOids.has(m.openid)
      );
      const nameMap = {};
      members.forEach(m => { if (m.openid) nameMap[m.openid] = m.wecomName || ''; });
      const groupLabels = (t.groups || []).map(g => g.name + ' 组');
      this.setData({
        showAddPlayerModal: true,
        addPlayerMembers: members,
        addPlayerFiltered: filtered,
        addPlayerSearch: '',
        addPlayerSelected: [],
        addPlayerSelectedSet: {},
        addPlayerTargetGroup: 0,
        addPlayerTargetTeam: 'A',
        addPlayerGroupLabels: groupLabels,
        addPlayerNameMap: nameMap
      });
    }).catch(() => {
      wx.showToast({ title: '加载成员列表失败', icon: 'none' });
    });
  },

  onCloseAddPlayerModal() {
    this.setData({ showAddPlayerModal: false });
  },

  onAddPlayerSearch(e) {
    const keyword = (e.detail.value || '').trim().toLowerCase();
    const members = this.data.addPlayerMembers || [];
    const t = this.data.t;
    const existingOids = new Set((t && t.players || []).map(p => p.openid));
    if (t && t.type === 'team' && t.teams) {
      t.teams.forEach(team => (team.members || []).forEach(m => {
        if (m.openid) existingOids.add(m.openid);
      }));
    }
    const filtered = members.filter(m => {
      if (!m.wecomName || existingOids.has(m.openid)) return false;
      if (!keyword) return true;
      return m.wecomName.toLowerCase().includes(keyword);
    });
    this.setData({ addPlayerSearch: e.detail.value, addPlayerFiltered: filtered });
  },

  onToggleAddPlayer(e) {
    const oid = e.currentTarget.dataset.openid;
    if (!oid) return;
    const t = this.data.t;
    const isDoubles = t && t.type === 'doubles';
    // 双打一次补完整的一对；团队赛和单打允许批量加入同一目标队伍/小组。
    const maxSelect = isDoubles ? 2 : Infinity;
    let selected = this.data.addPlayerSelected.slice();

    const idx = selected.indexOf(oid);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      if (selected.length >= maxSelect) {
        wx.showToast({ title: `最多选择 ${maxSelect} 人`, icon: 'none' });
        return;
      } else {
        selected.push(oid);
      }
    }
    const selectedSet = {};
    selected.forEach(selectedOid => { selectedSet[selectedOid] = true; });
    this.setData({
      addPlayerSelected: selected,
      addPlayerSelectedSet: selectedSet
    });
  },

  onAddPlayerGroupChange(e) {
    this.setData({ addPlayerTargetGroup: parseInt(e.detail.value) || 0 });
  },

  onAddPlayerTeamChange(e) {
    this.setData({ addPlayerTargetTeam: e.detail.value });
  },

  onConfirmAddPlayer() {
    const { addPlayerSelected, addPlayerTargetGroup, addPlayerTargetTeam, t } = this.data;
    if (addPlayerSelected.length === 0) {
      wx.showToast({ title: '请选择要添加的选手', icon: 'none' });
      return;
    }
    const isTeam = t && t.type === 'team';
    const isDoubles = t && t.type === 'doubles';
    if (isDoubles && addPlayerSelected.length !== 2) {
      wx.showToast({ title: '双打需选择 2 人组成一对', icon: 'none' });
      return;
    }
    api.addPlayerToTournament(
      this.data.id,
      addPlayerSelected,
      isTeam ? undefined : addPlayerTargetGroup,
      isTeam ? addPlayerTargetTeam : undefined
    ).then(() => {
      wx.showToast({ title: `已添加 ${addPlayerSelected.length} 人`, icon: 'success' });
      this.setData({ showAddPlayerModal: false });
      this.load();
    }).catch(() => {});
  },

  // 撤回小组赛比分
  onRevertGroup(e) {
    const { gi, mid, score } = e.currentTarget.dataset;
    wx.showModal({
      title: '撤回比分',
      content: `确认撤回这场比分（${score}）？双方本场获得的 ELO 和积分将被冲销，可重新录入。`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.revertScore(this.data.id, {
            stage: 'group',
            groupIndex: gi,
            matchId: mid
          }).then(() => {
            wx.showToast({ title: '已撤回', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  // 移除选手（仅 group 阶段、creator/admin）
  onRemovePlayer(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除选手',
      content: `确认将「${name || openid}」从本赛事移除？\n\n该选手参与的未录分对阵将随之清除；已有比分的场次需先撤回。`,
      confirmColor: '#c4452f',
      success: res => {
        if (res.confirm) {
          api.removePlayer(this.data.id, openid).then(() => {
            wx.showToast({ title: '已移除', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '移除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // 回滚到报名态（仅 group 阶段、无已录分、creator/admin）
  onRollbackToSignup() {
    wx.showModal({
      title: '回滚到报名态',
      content: '将清除所有分组和对阵数据，已报名选手保留。\n\n⚠️ 请确认所有比分已撤回，否则无法回滚。',
      confirmColor: '#c4452f',
      success: res => {
        if (res.confirm) {
          api.rollbackToSignup(this.data.id).then(() => {
            wx.showToast({ title: '已回滚到报名态', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '回滚失败', icon: 'none' });
          });
        }
      }
    });
  },

  // ====== 调整赛制 ======
  openConfigModal(setsOnly) {
    const t = this.data.t;
    const config = t.config || {};
    const bestOf = t.bestOf || 6;
    const bestOfValues = this.data.configBestOfValues;
    this.setData({
      showConfigModal: true,
      configSetsOnly: !!setsOnly,
      configForm: { advanceCount: config.advanceCount || 2, bestOf },
      configBestOfIndex: Math.max(0, bestOfValues.indexOf(bestOf))
    });
  },
  onShowConfigModal() { this.openConfigModal(false); },
  onMetaSetsTap() {
    const { canEditSets, isOwner, t } = this.data;
    if (!isOwner || !t) return;
    if (t.status !== 'group') {
      wx.showToast({ title: '当前阶段不能修改盘数', icon: 'none' });
      return;
    }
    if (!canEditSets) {
      wx.showToast({ title: '已有比分，不能修改盘数', icon: 'none' });
      return;
    }
    this.openConfigModal(true);
  },
  onCloseConfigModal() { this.setData({ showConfigModal: false, configSetsOnly: false }); },
  onConfigAdvanceChange(e) {
    const vals = this.data.advanceOptions;
    this.setData({ 'configForm.advanceCount': vals[+e.detail.value] });
  },
  onConfigBestOfChange(e) {
    const vals = this.data.configBestOfValues;
    const idx = +e.detail.value;
    this.setData({ configBestOfIndex: idx, 'configForm.bestOf': vals[idx] });
  },
  onSaveConfig() {
    const { advanceCount, bestOf } = this.data.configForm;
    const t = this.data.t;
    const oldBestOf = t.bestOf || 6;
    const opts = {};
    if (advanceCount !== ((t.config && t.config.advanceCount) || 2)) opts.advanceCount = advanceCount;
    if (bestOf !== oldBestOf) opts.bestOf = bestOf;

    if (Object.keys(opts).length === 0) {
      this.setData({ showConfigModal: false });
      return;
    }

    const doUpdate = (forceClear) => {
      if (forceClear) opts.forceClearScores = true;
      api.updateTournamentConfig(this.data.id, opts).then(() => {
        wx.showToast({ title: '已更新', icon: 'success' });
        this.setData({ showConfigModal: false });
        this.load();
      }).catch(err => {
        const msg = (err && err.msg) || '';
        if (err && err.needConfirm) {
          wx.showModal({
            title: '修改赛制需清空比分',
            content: `${msg}\n\n选手和分组将保留，所有比分和积分/ELO 变动将被回滚。`,
            confirmColor: '#c4452f',
            confirmText: '确认清空',
            success: res => { if (res.confirm) doUpdate(true); }
          });
        } else {
          wx.showToast({ title: msg || '更新失败', icon: 'none' });
        }
      });
    };
    doUpdate(false);
  },

  // ====== 三四名决赛 ======
  onAddThirdPlace() {
    wx.showModal({
      title: '添加三四名决赛',
      content: '半决赛负者将争夺季军，胜者为季军、负者为殿军。',
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.addThirdPlaceMatch(this.data.id).then(() => {
            wx.showToast({ title: '已添加', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '添加失败', icon: 'none' });
          });
        }
      }
    });
  },
  onFinalizeFourStrong() {
    wx.showModal({
      title: '只分四强',
      content: '半决赛负者将并列四强，不再进行季军争夺战。确认后无法再添加三四名决赛。',
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.finalizeFourStrong(this.data.id).then(() => {
            wx.showToast({ title: '已确认', icon: 'success' });
            this.load();
          }).catch(err => {
            wx.showToast({ title: (err && err.msg) || '失败', icon: 'none' });
          });
        }
      }
    });
  },

  // ====== 手动调组（单打/双打） ======
  onMovePlayer(e) {
    const { openid, name } = e.currentTarget.dataset;
    const groups = (this.data.t && this.data.t.groups) || [];
    if (groups.length < 2) {
      wx.showToast({ title: '只有一个组，无法调组', icon: 'none' });
      return;
    }
    const groupLabels = groups.map(g => g.name + ' 组');
    wx.showActionSheet({
      itemList: groupLabels,
      success: res => {
        const toIdx = res.tapIndex;
        api.movePlayer(this.data.id, openid, toIdx).then(() => {
          wx.showToast({ title: '已调组', icon: 'success' });
          this.load();
        }).catch(err => {
          wx.showToast({ title: (err && err.msg) || '调组失败', icon: 'none' });
        });
      }
    });
  },

  // 撤回淘汰赛比分
  onRevertKO(e) {
    const { ri, mid, score } = e.currentTarget.dataset;
    const t = this.data.t;
    const willResetFinish = t && t.status === 'finished';
    const extraWarn = willResetFinish
      ? '\n注意：本赛事已结束，撤回决赛会同时清空名次奖（冠/亚/四强等），可补录后重发。'
      : '';
    wx.showModal({
      title: '撤回比分',
      content: `确认撤回这场比分（${score}）？双方本场获得的 ELO 和积分将被冲销，下一轮的对位将自动清空。${extraWarn}`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.revertScore(this.data.id, {
            stage: 'knockout',
            roundIndex: ri,
            matchId: mid
          }).then(() => {
            wx.showToast({ title: '已撤回', icon: 'success' });
            this.load();
          });
        }
      }
    });
  }
});
