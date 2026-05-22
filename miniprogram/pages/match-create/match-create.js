const api = require('../../utils/api.js');
const { todayStr } = require('../../utils/format.js');

const LEVEL_OPTIONS = [
  { key: 'friendly', label: '周赛', desc: '每周常规赛', winPts: 30, losePts: 10 },
  { key: 'challenge', label: '月赛', desc: '月度排位赛', winPts: 60, losePts: 25 },
  { key: 'major', label: '半年赛', desc: '半年度大赛', winPts: 100, losePts: 40 }
];

Page({
  data: {
    form: {
      title: '',
      type: 'singles',     // singles | doubles
      bestOf: 6,           // 4 / 6
      level: 'friendly',   // friendly | challenge | major
      handicapRule: '',
      matchDate: ''
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
    submitting: false
  },

  onLoad() {
    this.setData({ 'form.matchDate': todayStr() });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  onTypeChange(e) {
    const idx = +e.detail.value;
    this.setData({
      typeIndex: idx,
      'form.type': this.data.typeOptions[idx].key
    });
  },

  onBestOfChange(e) {
    const idx = +e.detail.value;
    this.setData({
      bestOfIndex: idx,
      'form.bestOf': this.data.bestOfOptions[idx]
    });
  },

  onLevelChange(e) {
    const idx = +e.detail.value;
    this.setData({
      levelIndex: idx,
      'form.level': LEVEL_OPTIONS[idx].key
    });
  },

  onDateChange(e) {
    this.setData({ 'form.matchDate': e.detail.value });
  },

  onSubmit() {
    const { title, type, bestOf, level, matchDate } = this.data.form;
    if (!title.trim()) return wx.showToast({ title: '请填写比赛名', icon: 'none' });
    if (!matchDate) return wx.showToast({ title: '请选择日期', icon: 'none' });

    const payload = {
      title: title.trim(),
      type,
      bestOf,
      level,
      handicapRule: this.data.form.handicapRule.trim(),
      matchDate: new Date(`${matchDate}T00:00:00`).getTime()
    };

    this.setData({ submitting: true });
    api
      .createMatch(payload)
      .then(() => {
        wx.showToast({ title: '已创建', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => this.setData({ submitting: false }));
  }
});
