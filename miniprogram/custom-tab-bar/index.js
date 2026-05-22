Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index' },
      { pagePath: '/pages/match-list/match-list' },
      { pagePath: '/pages/profile/profile' }
    ],
    inactiveIcons: [
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3.5' y='5.5' width='17' height='14' rx='1.5'/%3E%3Cline x1='3.5' y1='9.5' x2='20.5' y2='9.5'/%3E%3Cline x1='8' y1='3' x2='8' y2='7'/%3E%3Cline x1='16' y1='3' x2='16' y2='7'/%3E%3Ccircle cx='12' cy='14' r='0.8' fill='%235d6e63' stroke='none'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 4 h10 v3 a5 5 0 0 1 -10 0 z'/%3E%3Cpath d='M7 4 H4 v2 a3 3 0 0 0 3 3'/%3E%3Cpath d='M17 4 h3 v2 a3 3 0 0 1 -3 3'/%3E%3Cline x1='12' y1='9' x2='12' y2='14'/%3E%3Cpath d='M9 14 h6 v2 H9 z'/%3E%3Cline x1='8' y1='20' x2='16' y2='20'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%235d6e63' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='9' r='3.5'/%3E%3Cpath d='M5 20 v-1 a5 5 0 0 1 5 -5 h4 a5 5 0 0 1 5 5 v1'/%3E%3C/svg%3E"
    ],
    activeIcons: [
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3.5' y='5.5' width='17' height='14' rx='1.5'/%3E%3Cline x1='3.5' y1='9.5' x2='20.5' y2='9.5'/%3E%3Cline x1='8' y1='3' x2='8' y2='7'/%3E%3Cline x1='16' y1='3' x2='16' y2='7'/%3E%3Ccircle cx='12' cy='14' r='0.8' fill='%231f2e22' stroke='none'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 4 h10 v3 a5 5 0 0 1 -10 0 z'/%3E%3Cpath d='M7 4 H4 v2 a3 3 0 0 0 3 3'/%3E%3Cpath d='M17 4 h3 v2 a3 3 0 0 1 -3 3'/%3E%3Cline x1='12' y1='9' x2='12' y2='14'/%3E%3Cpath d='M9 14 h6 v2 H9 z'/%3E%3Cline x1='8' y1='20' x2='16' y2='20'/%3E%3C/svg%3E",
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%231f2e22' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='9' r='3.5'/%3E%3Cpath d='M5 20 v-1 a5 5 0 0 1 5 -5 h4 a5 5 0 0 1 5 5 v1'/%3E%3C/svg%3E"
    ]
  },
  methods: {
    switchTab(e) {
      const idx = e.currentTarget.dataset.index;
      wx.switchTab({ url: this.data.list[idx].pagePath });
    }
  }
});
