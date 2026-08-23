const api = require('../../utils/api.js');
const { getCachedUser } = require('../../utils/user.js');

Page({
  data: {
    navTop: 0,
    scenarios: [
      { key: 'basic_signup_drawn', label: '基础完整流程' },
      { key: 'mid_recording', label: '录入中' },
      { key: 'tied_partial', label: '平分 · 待一球制胜' },
      { key: 'a_landslide_finished', label: 'A 队完胜' },
      { key: 'b_narrow_finished', label: 'B 队险胜' },
      { key: 'odd_signup_drawn', label: '奇数人蛇形' },
      { key: 'signup_pending_draw', label: '待抽签 (signup)' },
      // —— 本轮新功能测试场景 ——
      { key: 'short_t7_pending',           label: '抢 7 · 待录入（验证比分校验）' },
      { key: 'short_t11_a_wins',           label: '抢 11 · A 队完赛胜（验证整队 ELO）' },
      { key: 'team_lineup_mixed_finished', label: 'Lineup · 混合姿态完赛（海报展示）' },
      { key: 'team_lineup_recording',      label: 'Lineup · 录入中（验证回填）' },
      // —— 排阵/录分解耦 & 中途加人 ——
      { key: 'team_lineup_ready',          label: '排阵测试 · 已抽签无比分' },
      { key: 'team_partial_scored',        label: '加人测试 · 2 slot 已录 3 slot 空' },
      { key: 'multi_court_recording',      label: '拆场地 · 12人2场录入中' },
      { key: 'team_personal_profile',     label: '个人页 · 团队赛战绩验证' }
    ],
    // 单打/双打测试场景（用于中途加人测试）
    tournamentScenarios: [
      { key: 'singles_5_group', label: '单打 · 5人2组（加人/调组/移除）' },
      { key: 'singles_4_group', label: '单打 · 4人1组（移除选手）' },
      { key: 'doubles_6_group', label: '双打 · 6人3对2组（加人/移除）' },
      { key: 'singles_6_clean_group', label: '单打 · 6人2组（回滚/改赛制）' }
    ],
    knockoutScenarios: [
      { key: 'third_place', label: '三四名决赛 · 半决赛已完成' }
    ],
    // UI 页面预览（纯导航，零副作用：不写库、不动登录态）
    uiPreviews: [
      { key: 'onboarding', label: '新用户登记页（onboarding）' }
    ]
  },

  onLoad() {
    const app = getApp();
    this.setData({ navTop: app.globalData.nav ? app.globalData.nav.navTopRpx : 0 });

    const user = getCachedUser();
    if (!user || user.role !== 'admin') {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  goBack() {
    wx.navigateBack();
  },

  onSeed(e) {
    const { scenario } = e.currentTarget.dataset;
    wx.showLoading({ title: '生成中…' });
    api.seedTeamMatchTest(scenario).then(res => {
      wx.hideLoading();
      wx.showToast({ title: '已创建', icon: 'success' });
      setTimeout(() => {
        wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${res._id}` });
      }, 600);
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: (err && err.msg) || '失败', icon: 'none' });
    });
  },

  onSeedTournament(e) {
    const { scenario } = e.currentTarget.dataset;
    wx.showLoading({ title: '生成中…' });
    api.seedTournamentTest(scenario).then(res => {
      wx.hideLoading();
      wx.showToast({ title: '已创建', icon: 'success' });
      setTimeout(() => {
        wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${res._id}` });
      }, 600);
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: (err && err.msg) || '失败', icon: 'none' });
    });
  },

  onSeedKnockout(e) {
    wx.showLoading({ title: '生成中…' });
    api.seedKnockoutTest().then(res => {
      wx.hideLoading();
      wx.showToast({ title: '已创建', icon: 'success' });
      setTimeout(() => {
        wx.navigateTo({ url: `/pages/tournament-detail/tournament-detail?id=${res._id}` });
      }, 600);
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: (err && err.msg) || '失败', icon: 'none' });
    });
  },

  onPreview(e) {
    const { key } = e.currentTarget.dataset;
    const routes = {
      onboarding: '/pages/onboarding/onboarding'
    };
    const url = routes[key];
    if (!url) return wx.showToast({ title: '未知预览项', icon: 'none' });
    wx.navigateTo({ url });
  },

  onCleanup() {
    wx.showModal({
      title: '确认清空',
      content: '这将删除所有 _isTest:true 的测试赛事和测试用户。继续？',
      confirmColor: '#c4452f',
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.showLoading({ title: '清理中…' });
        api.cleanupTestData().then(res => {
          wx.hideLoading();
          wx.showToast({
            title: `已删 ${res.tournamentsDeleted} 赛 ${res.usersDeleted} 人`,
            icon: 'none',
            duration: 3000
          });
        }).catch(err => {
          wx.hideLoading();
          wx.showToast({ title: (err && err.msg) || '清理失败', icon: 'none' });
        });
      }
    });
  }
});
