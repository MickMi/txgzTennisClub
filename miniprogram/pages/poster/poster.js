// pages/poster/poster.js
const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');
const { POSTER_STYLES } = require('../../utils/poster-styles.js');
const { drawPoster, computeCanvasH, W } = require('../../utils/poster-draw.js');
const { computeHighlight, collectUserMatches } = require('../../utils/highlight.js');

function formatDateMono(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
}

function placementText(rank) {
  if (!rank) return '—';
  if (rank === 1) return '冠军';
  if (rank === 2) return '亚军';
  if (rank === 3) return '季军';
  return `第${rank}`;
}

Page({
  data: {
    navTop: 0,
    posterType: 'personal', // 'personal' | 'report'
    styles: POSTER_STYLES,
    currentStyleIndex: 0,
    currentStyle: POSTER_STYLES[0],
    loading: true,
    posterReady: false
  },

  // 缓存数据（不进 setData，节省渲染开销）
  tournament: null,
  me: null,
  userStats: null,
  reportStats: null,
  highlight: null,
  canvasNode: null,
  ctx: null,

  onLoad(opts) {
    const app = getApp();
    const nav = app.globalData.nav;
    const navTop = nav ? nav.navTopRpx : 0;
    const capsuleGap = nav ? nav.capsuleGapRpx : 190;
    const posterType = opts.type === 'report' ? 'report' : 'personal';
    this.tournamentId = opts.tournamentId;
    if (!this.tournamentId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.me = getCachedUser();
    this.setData({
      navTop,
      capsuleGap,
      posterType,
      currentStyle: POSTER_STYLES[0]
    });
    this.loadData();
  },

  goBack() {
    wx.navigateBack();
  },

  loadData() {
    api.getTournament(this.tournamentId)
      .then(t => {
        this.tournament = this.enrichTournament(t);
        if (this.data.posterType === 'personal') {
          this.userStats = this.computeUserStats(t);
          this.highlight = computeHighlight(t, (this.me && this.me.openid) || '');
        } else {
          this.reportStats = this.computeReportStats(t);
          this.tournament._reportStats = this.reportStats;
        }
        this.setData({ loading: false }, () => {
          // 等 wxml 渲染完再获取 canvas
          setTimeout(() => this.initCanvasAndRender(), 50);
        });
      })
      .catch(err => {
        console.error('[poster] load tournament failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  enrichTournament(t) {
    return {
      ...t,
      _dateStr: formatDateMono(t.matchDate || t.createdAt)
    };
  },

  // 个人战绩卡数据
  computeUserStats(tournament) {
    const openid = (this.me && this.me.openid) || '';
    const matches = collectUserMatches(tournament, openid);
    const wins = matches.filter(m => m.scored && m.won).length;
    const losses = matches.filter(m => m.scored && !m.won).length;

    const award = (tournament.placementAwards || []).find(a => a.openid === openid);
    const placementIdx = (tournament.placementAwards || []).findIndex(a => a.openid === openid);

    // ELO 变化：从用户在赛事内的所有对战累加（match.pointsAwarded.winnerEloDelta / loserEloDelta）
    let eloChange = 0;
    matches.forEach(m => {
      const pa = m.match && m.match.pointsAwarded;
      if (!pa) return;
      if (pa.winnerOpenid === openid) eloChange += pa.winnerEloDelta || 0;
      else if (pa.loserOpenid === openid) eloChange += pa.loserEloDelta || 0;
    });

    // 比分文本 + 对手 + 胜负
    const matchRows = matches
      .filter(m => m.scored)
      .map(m => ({
        round: m.round,
        opponentName: m.opponent && m.opponent.wecomName,
        scoreText: m.scoreSummary || '',
        win: !!m.won
      }));

    return {
      placementText: award ? placementText(award.placement) : (placementIdx >= 0 ? `第${placementIdx + 1}` : '—'),
      pointsEarned: award ? (award.points || 0) : 0,
      eloChange,
      wins,
      losses,
      matches: matchRows
    };
  },

  // 赛事战报数据
  computeReportStats(tournament) {
    let total = 0;
    let fullDistanceCount = 0;
    const bestOf = tournament.bestOf || 0;

    const collectFrom = matches => {
      (matches || []).forEach(m => {
        if (!m.winner) return;
        total++;
        if (m.scoreSummary) {
          const [a, b] = m.scoreSummary.split(':').map(s => parseInt(s, 10));
          if (!isNaN(a) && !isNaN(b) && bestOf > 0 && a + b >= bestOf * 2 - 1) {
            fullDistanceCount++;
          }
        }
      });
    };

    (tournament.groups || []).forEach(g => collectFrom(g.matches));
    const rounds = tournament.knockout && tournament.knockout.rounds ? tournament.knockout.rounds : [];
    rounds.forEach(rd => collectFrom(rd.matches));

    // 决赛比分（最后一轮淘汰赛 final）
    let finalScore = '—';
    if (rounds.length > 0) {
      const finalRound = rounds[rounds.length - 1];
      const finalMatch = (finalRound.matches || [])[0];
      if (finalMatch && finalMatch.scoreSummary) {
        finalScore = finalMatch.scoreSummary;
      }
    }

    return {
      totalMatches: total,
      finalScore,
      fullDistanceCount
    };
  },

  // Canvas 初始化 + 渲染
  initCanvasAndRender() {
    const query = wx.createSelectorQuery();
    query
      .select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) {
          console.error('[poster] canvas node not found');
          return;
        }
        this.canvasNode = res[0].node;
        this.ctx = this.canvasNode.getContext('2d');
        // canvas 高度由 drawPoster 内部按数据动态设置，这里只先给个占位值
        this.canvasNode.width = W;
        this.canvasNode.height = 1600;
        this.renderPoster();
      });
  },

  renderPoster() {
    if (!this.ctx || !this.canvasNode) return;
    const data = {
      type: this.data.posterType,
      tournament: this.tournament,
      me: this.me || {},
      userStats: this.userStats || {},
      highlight: this.highlight,
      style: this.data.currentStyle
    };
    // drawPoster 会先按内容计算 canvasH 并设置 canvas.width/height，再绘制
    drawPoster(this.ctx, this.canvasNode, data);
    // 同步预览框宽高比（让 CSS aspect-ratio 跟着实际 canvas 变化）
    const ratio = this.canvasNode.width / this.canvasNode.height;
    this.setData({ posterReady: true, previewRatio: ratio });
  },

  switchStyle(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10);
    if (isNaN(idx) || idx === this.data.currentStyleIndex) return;
    this.setData({
      currentStyleIndex: idx,
      currentStyle: POSTER_STYLES[idx]
    }, () => {
      this.renderPoster();
    });
  },

  onSave() {
    if (!this.canvasNode) {
      wx.showToast({ title: '海报未生成', icon: 'none' });
      return;
    }
    const cw = this.canvasNode.width;
    const ch = this.canvasNode.height;
    console.log('[poster] onSave: starting export', { w: cw, h: ch });
    wx.showLoading({ title: '导出中', mask: true });
    // ⚠️ type=2d canvas 必须显式传 x/y/width/height/destWidth/destHeight，
    // 否则会拿 canvas 的 CSS 尺寸（可能是 0 或被拉伸）导出，输出空白
    wx.canvasToTempFilePath({
      canvas: this.canvasNode,
      x: 0,
      y: 0,
      width: cw,
      height: ch,
      destWidth: cw,
      destHeight: ch,
      fileType: 'png',
      quality: 1,
      success: res => {
        wx.hideLoading();
        console.log('[poster] canvasToTempFilePath ok, path=', res.tempFilePath);
        this.saveToAlbum(res.tempFilePath);
      },
      fail: err => {
        wx.hideLoading();
        console.error('[poster] canvasToTempFilePath FAILED', err);
        wx.showModal({
          title: '导出失败',
          content: `[canvasToTempFilePath]\n${(err && err.errMsg) || JSON.stringify(err)}`,
          showCancel: false
        });
      }
    });
  },

  // 保存到相册：处理授权流程
  saveToAlbum(tempFilePath) {
    console.log('[poster] saveToAlbum, path=', tempFilePath);
    const doSave = () => {
      console.log('[poster] calling wx.saveImageToPhotosAlbum');
      wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: r => {
          console.log('[poster] saveImageToPhotosAlbum SUCCESS', r);
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        },
        fail: err => {
          console.error('[poster] saveImageToPhotosAlbum FAILED', err);
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('auth deny') > -1 || msg.indexOf('authorize') > -1) {
            // 用户曾经拒绝过授权，引导去设置开启
            wx.showModal({
              title: '需要相册权限',
              content: '保存海报需要授权"保存到相册"，请在设置中开启',
              confirmText: '去设置',
              success: r => {
                if (r.confirm) {
                  wx.openSetting({
                    success: ss => {
                      if (ss.authSetting['scope.writePhotosAlbum']) {
                        // 开启后再试一次
                        this.saveToAlbum(tempFilePath);
                      }
                    }
                  });
                }
              }
            });
          } else {
            // 把真实错误显示给用户（modal 比 toast 看得清）
            wx.showModal({
              title: '保存失败',
              content: `[saveImageToPhotosAlbum]\n${msg || JSON.stringify(err)}`,
              showCancel: false
            });
          }
        }
      });
    };

    // 先查授权状态，没授权过就直接调（首次会自动弹权限框），授权过就直接走
    wx.getSetting({
      success: res => {
        console.log('[poster] getSetting authSetting=', res.authSetting);
        if (res.authSetting['scope.writePhotosAlbum'] === false) {
          // 之前明确拒绝过
          wx.showModal({
            title: '需要相册权限',
            content: '保存海报需要授权"保存到相册"，请在设置中开启',
            confirmText: '去设置',
            success: r => {
              if (r.confirm) {
                wx.openSetting({
                  success: ss => {
                    if (ss.authSetting['scope.writePhotosAlbum']) doSave();
                  }
                });
              }
            }
          });
        } else {
          // 未授权或已授权 → 直接调用（未授权会自动弹权限框）
          doSave();
        }
      },
      fail: () => doSave()
    });
  },

  // 用户点"发送给朋友" → 触发 openSetting 不行，要用 button open-type=share
  // 这里给出引导，实际分享走 onShareAppMessage
  onShare() {
    wx.showToast({ title: '点击右上角…菜单分享', icon: 'none' });
  },

  // 从微信菜单分享时触发：返回带海报图的卡片
  onShareAppMessage() {
    if (!this.canvasNode) {
      return { title: '腾讯广州网球社', path: '/pages/match-list/match-list' };
    }
    const tournamentTitle = (this.tournament && this.tournament.title) || '腾讯广州网球社';
    return new Promise(resolve => {
      const cw = this.canvasNode.width;
      const ch = this.canvasNode.height;
      wx.canvasToTempFilePath({
        canvas: this.canvasNode,
        x: 0, y: 0,
        width: cw, height: ch,
        destWidth: cw, destHeight: ch,
        fileType: 'jpg',
        quality: 0.9,
        success: res => {
          resolve({
            title: tournamentTitle,
            path: `/pages/tournament-detail/tournament-detail?id=${this.tournamentId}`,
            imageUrl: res.tempFilePath
          });
        },
        fail: () => {
          resolve({
            title: tournamentTitle,
            path: `/pages/tournament-detail/tournament-detail?id=${this.tournamentId}`
          });
        }
      });
    });
  }
});
