const api = require('../../utils/api.js');
const { todayStr } = require('../../utils/format.js');

const LEVEL_OPTIONS = [
  { key: 'friendly', label: '周赛', seedDefault: 0 },
  { key: 'challenge', label: '月赛', seedDefault: 0 },
  { key: 'major', label: '半年赛', seedDefault: 4 }
];

Page({
  data: {
    form: {
      title: '',
      type: 'singles',
      bestOf: 6,
      level: 'friendly',
      handicapRule: '',
      matchDate: '',
      groupCount: 2,
      advanceCount: 2,
      seedCount: 0
    },
    typeIndex: 0,
    typeOptions: [
      { key: 'singles', label: '单打' },
      { key: 'doubles', label: '双打' },
      { key: 'team', label: '团队赛' }
    ],
    bestOfIndex: 1,
    bestOfOptions: [4, 6, 7, 11],
    bestOfLabels: ['四局制', '六局制', '单盘抢 7', '单盘抢 11'],
    levelIndex: 0,
    levelOptions: LEVEL_OPTIONS,
    groupCountOptions: [1, 2, 3, 4, 6, 8],
    groupCountIndex: 1, // 默认 2 组（兼容老习惯，admin 可改）
    advanceOptions: [1, 2, 3, 4],
    advanceIndex: 1,
    // 团队赛 UI：仅 type=team 时展示对阵槽数输入
    showTeamOptions: false,
    showAdvancedConfig: false,
    submitting: false
  },

  onLoad() {
    const app = getApp();
    this.setData({
      'form.matchDate': todayStr(),
      navTop: app.globalData.nav ? app.globalData.nav.navTopRpx : 0
    });
  },

  goBack() {
    wx.navigateBack();
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  onTypeChange(e) {
    const idx = +e.detail.value;
    const typeKey = this.data.typeOptions[idx].key;
    this.setData({
      typeIndex: idx,
      'form.type': typeKey,
      showTeamOptions: typeKey === 'team'
    });
  },

  onBestOfChange(e) {
    const idx = +e.detail.value;
    this.setData({ bestOfIndex: idx, 'form.bestOf': this.data.bestOfOptions[idx] });
  },

  onLevelChange(e) {
    const idx = +e.detail.value;
    const level = LEVEL_OPTIONS[idx];
    this.setData({
      levelIndex: idx,
      'form.level': level.key,
      'form.seedCount': level.seedDefault
    });
  },

  onGroupCountChange(e) {
    const idx = +e.detail.value;
    const count = this.data.groupCountOptions[idx];
    this.setData({
      groupCountIndex: idx,
      'form.groupCount': count
    });
  },

  onAdvanceChange(e) {
    const idx = +e.detail.value;
    this.setData({ advanceIndex: idx, 'form.advanceCount': this.data.advanceOptions[idx] });
  },

  onDateChange(e) {
    this.setData({ 'form.matchDate': e.detail.value });
  },

  onToggleAdvanced() {
    this.setData({ showAdvancedConfig: !this.data.showAdvancedConfig });
  },

  onSubmit() {
    const f = this.data.form;
    if (!f.title.trim()) return wx.showToast({ title: '请填写赛事名称', icon: 'none' });
    if (!f.matchDate) return wx.showToast({ title: '请选择日期', icon: 'none' });

    const payload = {
      title: f.title.trim(),
      type: f.type,
      bestOf: f.bestOf,
      level: f.level,
      handicapRule: f.handicapRule.trim(),
      matchDate: new Date(`${f.matchDate}T00:00:00`).getTime(),
      groupCount: f.groupCount,
      advanceCount: f.advanceCount,
      seedCount: parseInt(f.seedCount) || 0
    };
    // 团队赛附加字段：不传 level（团队赛无级别区分）
    if (f.type === 'team') {
      delete payload.level;
      // 团队赛不在创建时定 bestOf/group/advance/seed/slots，留到抽签弹层
      delete payload.bestOf;
      delete payload.groupCount;
      delete payload.advanceCount;
      delete payload.seedCount;
    }

    this.setData({ submitting: true });
    api
      .createTournament(payload)
      .then(res => {
        wx.showToast({ title: '已创建', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/tournament-detail/tournament-detail?id=${res._id}` });
        }, 600);
      })
      .catch(() => this.setData({ submitting: false }));
  }
});
