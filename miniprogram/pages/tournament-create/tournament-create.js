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
      { key: 'doubles', label: '双打' }
    ],
    bestOfIndex: 1,
    bestOfOptions: [4, 6],
    levelIndex: 0,
    levelOptions: LEVEL_OPTIONS,
    groupCountOptions: [2, 3, 4, 6, 8],
    groupCountIndex: 0,
    advanceOptions: [1, 2, 3, 4],
    advanceIndex: 1,
    submitting: false
  },

  onLoad() {
    this.setData({ 'form.matchDate': todayStr() });
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
    this.setData({ typeIndex: idx, 'form.type': this.data.typeOptions[idx].key });
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
