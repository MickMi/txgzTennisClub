// 成员管理页（admin 限定）
const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');

Page({
  data: {
    list: [],
    filteredList: [],
    total: 0,
    adminCount: 0,
    myOpenid: '',
    filter: 'all', // 'all' | 'admin' | 'member'
    loading: true
  },

  onLoad() {
    const me = getCachedUser();
    if (!me || me.role !== 'admin') {
      wx.showToast({ title: '无权访问', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const app = getApp();
    const nav = app.globalData.nav;
    this.setData({
      myOpenid: me.openid,
      navTop: nav ? nav.navTopRpx : 0,
      capsuleGap: nav ? nav.capsuleGapRpx : 190
    });
    this.load();
  },

  onShow() {
    // 切换角色后回来要刷新（cache 可能过期）
    if (!this.data.loading) this.load();
  },

  goBack() {
    wx.navigateBack();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    return api.listMembers().then(data => {
      const list = data.list || [];
      this.setData({
        list,
        total: list.length,
        adminCount: data.adminCount || 0,
        loading: false
      });
      this.applyFilter();
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  applyFilter() {
    const { list, filter } = this.data;
    let filtered = list;
    if (filter === 'admin') filtered = list.filter(u => u.role === 'admin');
    else if (filter === 'member') filtered = list.filter(u => u.role === 'member');
    this.setData({ filteredList: filtered });
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    if (filter === this.data.filter) return;
    this.setData({ filter });
    this.applyFilter();
  },

  goUserDetail(e) {
    const { openid, name } = e.currentTarget.dataset;
    if (!openid) return;
    wx.navigateTo({
      url: `/pages/user-detail/user-detail?openid=${openid}&name=${encodeURIComponent(name || '')}`
    });
  },

  onPromote(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '提升为管理员',
      content: `确认让「${name}」成为管理员？管理员可编辑/关闭/删除任意活动和赛事。`,
      confirmColor: '#243a30',
      success: res => {
        if (res.confirm) {
          api.setRole(openid, 'admin').then(() => {
            wx.showToast({ title: '已提升', icon: 'success' });
            this.load();
          });
        }
      }
    });
  },

  onDemote(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '降为普通会员',
      content: `确认把「${name}」降为普通会员？将失去管理员权限。`,
      confirmColor: '#b87a36',
      success: res => {
        if (res.confirm) {
          api.setRole(openid, 'member').then(() => {
            wx.showToast({ title: '已降级', icon: 'success' });
            this.load();
          });
        }
      }
    });
  }
});
