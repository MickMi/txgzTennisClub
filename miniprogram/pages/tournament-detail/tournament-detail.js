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
    // 双打配对（仅 type=doubles + signup 状态下使用）
    // pairs 形如 [[openid1, openid2], ...]
    // 已选待配对的 openid（点第二人时自动成 pair）
    pairs: [],
    pairSelectedOpenid: '',
    pairsComplete: false  // 派生：报名玩家是否全部已配对
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

  load() {
    return api.getTournament(this.data.id).then(t => {
      const me = this.data.user;
      const myOpenid = me && me.openid;
      const isOwner = !!(me && (t.creator === me.openid || me.role === 'admin'));
      const signed = !!(me && (t.players || []).some(p => p.openid === me.openid));

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
        matches: (g.matches || []).map(tagMatch)
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
          statusText: STATUS_MAP[t.status] || t.status
        },
        isOwner,
        signed,
        drawGroupCount,
        drawAdvanceCount,
        drawSeedCount: t.config.seedCount || 0,
        pairs: cleanedPairs,
        pairsComplete,
        unpairedPlayers,
        pairsDetail
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
    this.setData({ drawSeedCount: parseInt(e.detail.value) || 0 });
  },

  // 抽签
  onDraw() {
    const { drawGroupCount, drawAdvanceCount, drawSeedCount, pairs, t } = this.data;
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
    const seedTxt = drawSeedCount > 0 ? ' · ' + drawSeedCount + '种子' : ' · 随机';
    wx.showModal({
      title: '确认抽签分组',
      content: `${unitCount}${unitName} → 分${drawGroupCount}组 → 每组前${drawAdvanceCount}名晋级${seedTxt}`,
      success: res => {
        if (res.confirm) {
          const opts = {
            groupCount: drawGroupCount,
            advanceCount: drawAdvanceCount,
            seedCount: drawSeedCount
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

  // 删除赛事（仅 signup 阶段、creator/admin）
  onDeleteTournament() {
    const t = this.data.t;
    if (!t || t.status !== 'signup') return;
    wx.showModal({
      title: '删除赛事',
      content: `确认删除「${t.title}」？已报名的 ${t.players ? t.players.length : 0} 人将被解除报名。此操作不可撤销。`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.deleteTournament(this.data.id).then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 600);
          });
        }
      }
    });
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
