Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/match-list/match-list' },
      // [HIDDEN] 活动模块因个人主体无社交类目暂时隐藏，恢复时取消注释
      // { pagePath: '/pages/index/index' },
      { pagePath: '/pages/profile/profile' }
    ],
    inactiveIcons: [
      '/assets/icons/tab-trophy.svg',
      // '/assets/icons/tab-calendar.svg',  // [HIDDEN] 活动 tab
      '/assets/icons/tab-person.svg'
    ],
    activeIcons: [
      '/assets/icons/tab-trophy-active.svg',
      // '/assets/icons/tab-calendar-active.svg',  // [HIDDEN] 活动 tab
      '/assets/icons/tab-person-active.svg'
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      wx.switchTab({ url: this.data.list[idx].pagePath });
    }
  }
});
