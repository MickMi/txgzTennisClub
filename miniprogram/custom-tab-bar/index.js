Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '活动' },
      { pagePath: '/pages/match-list/match-list', text: '赛事' },
      { pagePath: '/pages/profile/profile', text: '我的' }
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      const url = this.data.list[idx].pagePath;
      wx.switchTab({ url });
    }
  }
});
