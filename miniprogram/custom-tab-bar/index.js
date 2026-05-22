Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '活动' },
      { pagePath: '/pages/match-list/match-list', text: '赛事' },
      { pagePath: '/pages/profile/profile', text: '我的' }
    ],
    inactiveIcons: [
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3Ccircle cx='12' cy='16' r='1.5' fill='%235d6e63' stroke='none'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 4h8v3a4 4 0 0 1-8 0V4z'/%3E%3Cpath d='M5 5a2 2 0 0 0 2 2'/%3E%3Cpath d='M19 5a2 2 0 0 1-2 2'/%3E%3Cline x1='12' y1='11' x2='12' y2='16'/%3E%3Cpath d='M9 20h6'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'/%3E%3C/svg%3E"
    ],
    activeIcons: [
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3Ccircle cx='12' cy='16' r='1.5' fill='%231f2e22' stroke='none'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 4h8v3a4 4 0 0 1-8 0V4z'/%3E%3Cpath d='M5 5a2 2 0 0 0 2 2'/%3E%3Cpath d='M19 5a2 2 0 0 1-2 2'/%3E%3Cline x1='12' y1='11' x2='12' y2='16'/%3E%3Cpath d='M9 20h6'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'/%3E%3C/svg%3E"
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      wx.switchTab({ url: this.data.list[idx].pagePath });
    }
  }
});
