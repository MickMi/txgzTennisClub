Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/match-list/match-list' },
      { pagePath: '/pages/index/index' },
      { pagePath: '/pages/profile/profile' }
    ],
    inactiveIcons: [
      '/assets/icons/tab-trophy.svg',
      '/assets/icons/tab-calendar.svg',
      '/assets/icons/tab-person.svg'
    ],
    activeIcons: [
      '/assets/icons/tab-trophy-active.svg',
      '/assets/icons/tab-calendar-active.svg',
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
