// 选手详情页（只读，从排行榜进入）
const api = require('../../utils/api.js');
const { formatDate } = require('../../utils/format.js');

Page({
  data: {
    openid: '',
    user: null,
    loading: true,
    rating: '',
    stats: { wins: 0, losses: 0, pending: 0, total: 0 },
    winRate: '-',
    totalPoints: 0,
    eloRating: 1500,
    chartTab: 0, // 0: ELO, 1: 积分
    eloHistory: [],
    pointsHistory: [],
    matchHistory: []
  },

  onLoad(opts) {
    const openid = opts.openid;
    if (!openid) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const app = getApp();
    const nav = app.globalData.nav;
    this.setData({
      openid,
      navTop: nav ? nav.navTopRpx : 0,
      capsuleGap: nav ? nav.capsuleGapRpx : 190
    });
    this.loadProfile();
  },

  goBack() {
    wx.navigateBack();
  },

  // 跳转赛事详情（用 tournamentId 而非合并 _id）
  goMatchDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${id}` });
  },

  loadProfile() {
    return api
      .getProfileByOpenid(this.data.openid)
      .then(profile => {
        const user = profile.user;
        const matchHistory = (profile.matchHistory || []).map(m => ({
          ...m,
          matchDateStr: formatDate(m.matchDate),
          resultText: m.result === 'win' ? '胜' : m.result === 'loss' ? '负' : '进行中',
          resultClass: m.result === 'win' ? 'win' : m.result === 'loss' ? 'loss' : 'pending'
        }));
        const stats = profile.stats || { wins: 0, losses: 0, pending: 0, total: 0 };
        const played = stats.wins + stats.losses;
        const winRate = played > 0 ? Math.round(stats.wins * 100 / played) + '%' : '-';

        this.setData({
          user,
          loading: false,
          rating: profile.rating || '',
          stats,
          winRate,
          totalPoints: user.totalPoints || 0,
          eloRating: user.eloRating || 1500,
          eloHistory: profile.eloHistory || [],
          pointsHistory: profile.pointsHistory || [],
          matchHistory
        });
        // 等 DOM 渲染完成再绘图
        setTimeout(() => this.drawChart(), 300);
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  onPullDownRefresh() {
    this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  onChartTabChange(e) {
    this.setData({ chartTab: parseInt(e.currentTarget.dataset.tab) });
    this.drawChart();
  },

  // 绘制折线图（与 profile.js 完全一致；emerald-heritage 发丝网格风格）
  drawChart() {
    const query = wx.createSelectorQuery();
    query.select('#trendChart')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;
        const width = res[0].width || 300;
        const height = res[0].height || 150;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const data = this.data.chartTab === 0 ? this.data.eloHistory : this.data.pointsHistory;
        this.renderLineChart(ctx, width, height, data);
      });
  },

  renderLineChart(ctx, width, height, data) {
    ctx.clearRect(0, 0, width, height);

    if (!data || data.length < 2) {
      ctx.strokeStyle = '#ddd6c4';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 2]);
      for (let i = 0; i <= 4; i++) {
        const y = 20 + (i / 4) * (height - 45);
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(width - 15, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#5d6e63';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const y = 20 + (i / 4) * (height - 45);
        ctx.fillText('—', 35, y + 3);
      }
      ctx.fillStyle = '#5d6e63';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO DATA · 暂无趋势', width / 2, height / 2);
      return;
    }

    const padding = { top: 20, right: 15, bottom: 25, left: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const getX = (i) => padding.left + (i / (data.length - 1)) * chartW;
    const getY = (v) => padding.top + chartH - ((v - minVal) / range) * chartH;

    ctx.strokeStyle = '#ddd6c4';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#5d6e63';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxVal - (i / 4) * range);
      const y = padding.top + (i / 4) * chartH;
      ctx.fillText(String(val), padding.left - 5, y + 3);
    }

    const color = this.data.chartTab === 0 ? '#243a30' : '#b87a36';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = color;
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].value);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 0.1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(data[0].value));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(data[i].value));
    }
    ctx.lineTo(getX(data.length - 1), padding.top + chartH);
    ctx.lineTo(getX(0), padding.top + chartH);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(data[0].value), getX(0), getY(data[0].value) - 8);
    ctx.textAlign = 'right';
    ctx.fillText(String(data[data.length - 1].value), getX(data.length - 1), getY(data[data.length - 1].value) - 8);
  }
});
