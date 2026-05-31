const api = require('../../utils/api.js');
const { setCachedUser } = require('../../utils/user.js');
const { formatDateTime, formatDate } = require('../../utils/format.js');

const RATING_OPTIONS = ['1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0'];

Page({
  data: {
    user: null,
    editing: false,
    wecomNameInput: '',
    genderInput: '',
    // 评级
    rating: '',
    ratingOptions: RATING_OPTIONS,
    ratingIndex: -1,
    editingRating: false,
    // 战绩统计
    stats: { wins: 0, losses: 0, pending: 0, total: 0 },
    winRate: '-',
    // 累计积分
    totalPoints: 0,
    // ELO等级分
    eloRating: 1500,
    // 图表
    chartTab: 0, // 0: ELO曲线, 1: 积分曲线
    eloHistory: [],
    pointsHistory: [],
    // 历史战绩
    matchHistory: [],
    // 参与的活动
    activities: [],
    // Tab 切换
    activeTab: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.loadProfile();
  },

  loadProfile() {
    api
      .getProfile()
      .then(profile => {
        const user = profile.user;
        setCachedUser(user);
        const ratingIndex = RATING_OPTIONS.indexOf(profile.rating);
        // 格式化比赛日期
        const matchHistory = (profile.matchHistory || []).map(m => ({
          ...m,
          matchDateStr: formatDate(m.matchDate),
          resultText: m.result === 'win' ? '胜' : m.result === 'loss' ? '负' : '进行中',
          resultClass: m.result === 'win' ? 'win' : m.result === 'loss' ? 'loss' : 'pending'
        }));
        // 格式化活动日期
        const activities = (profile.activities || []).map(a => ({
          ...a,
          startTimeStr: formatDateTime(a.startTime)
        }));
        const stats = profile.stats || { wins: 0, losses: 0, pending: 0, total: 0 };
        const played = stats.wins + stats.losses;
        const winRate = played > 0 ? Math.round(stats.wins * 100 / played) + '%' : '-';
        this.setData({
          user,
          wecomNameInput: user ? user.wecomName || '' : '',
          rating: profile.rating || '未设置',
          ratingIndex,
          stats,
          winRate,
          totalPoints: user.totalPoints || 0,
          eloRating: user.eloRating || 1500,
          eloHistory: profile.eloHistory || [],
          pointsHistory: profile.pointsHistory || [],
          matchHistory,
          activities
        });
        // 绘制图表（需等 DOM 就绪）
        setTimeout(() => this.drawChart(), 300);
      })
      .catch(() => {
        // fallback: 至少加载基础用户信息
        api.login().then(user => {
          setCachedUser(user);
          this.setData({
            user,
            wecomNameInput: user ? user.wecomName || '' : ''
          });
        }).catch(() => {});
      });
  },

  // Tab 切换
  onTabChange(e) {
    this.setData({ activeTab: parseInt(e.currentTarget.dataset.tab) });
  },

  // 编辑企微名 + 性别
  onEdit() {
    this.setData({
      editing: true,
      genderInput: this.data.user ? this.data.user.gender || '' : ''
    });
  },

  onCancel() {
    this.setData({
      editing: false,
      wecomNameInput: this.data.user ? this.data.user.wecomName || '' : '',
      genderInput: this.data.user ? this.data.user.gender || '' : ''
    });
  },

  onInput(e) {
    this.setData({ wecomNameInput: e.detail.value });
  },

  onGenderChange(e) {
    this.setData({ genderInput: e.detail.value });
  },

  onSave() {
    const name = (this.data.wecomNameInput || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写企微名', icon: 'none' });
      return;
    }
    const payload = { wecomName: name };
    if (this.data.genderInput) {
      payload.gender = this.data.genderInput;
    }
    api
      .updateUser(payload)
      .then(user => {
        setCachedUser(user);
        this.setData({ user, editing: false });
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch(() => {});
  },

  // 评级修改
  onEditRating() {
    this.setData({ editingRating: true });
  },

  onRatingChange(e) {
    const idx = parseInt(e.detail.value);
    const rating = RATING_OPTIONS[idx];
    api
      .updateUser({ rating })
      .then(user => {
        setCachedUser(user);
        this.setData({
          user,
          rating,
          ratingIndex: idx,
          editingRating: false
        });
        wx.showToast({ title: '评级已更新', icon: 'success' });
      })
      .catch(() => {});
  },

  onCancelRating() {
    this.setData({ editingRating: false });
  },

  // 跳转赛事详情
  goMatchDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${id}` });
  },

  // 跳转活动详情
  goActivityDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  },

  // 跳转成员管理（admin only，wxml 已用 user.role === 'admin' 包裹）
  goMemberManagement() {
    wx.navigateTo({ url: '/pages/member-management/member-management' });
  },

  // 图表 Tab 切换
  onChartTabChange(e) {
    this.setData({ chartTab: parseInt(e.currentTarget.dataset.tab) });
    this.drawChart();
  },

  // 绘制折线图
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
    // 清空
    ctx.clearRect(0, 0, width, height);

    if (!data || data.length < 2) {
      // Draw hairline grid placeholder
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
      // Y-axis placeholder labels
      ctx.fillStyle = '#5d6e63';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const y = 20 + (i / 4) * (height - 45);
        ctx.fillText('—', 35, y + 3);
      }
      // Center label
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

    // 坐标转换
    const getX = (i) => padding.left + (i / (data.length - 1)) * chartW;
    const getY = (v) => padding.top + chartH - ((v - minVal) / range) * chartH;

    // 绘制网格线
    ctx.strokeStyle = '#ddd6c4';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Y轴标签
    ctx.fillStyle = '#5d6e63';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxVal - (i / 4) * range);
      const y = padding.top + (i / 4) * chartH;
      ctx.fillText(String(val), padding.left - 5, y + 3);
    }

    // 绘制折线
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

    // 绘制数据点
    ctx.fillStyle = color;
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].value);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制渐变填充
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

    // 起始和结束值标注
    ctx.fillStyle = color;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(data[0].value), getX(0), getY(data[0].value) - 8);
    ctx.textAlign = 'right';
    ctx.fillText(String(data[data.length - 1].value), getX(data.length - 1), getY(data[data.length - 1].value) - 8);
  }
});
