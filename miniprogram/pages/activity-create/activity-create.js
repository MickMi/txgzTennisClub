const api = require('../../utils/api.js');
const { todayStr, nowTimeStr } = require('../../utils/format.js');

Page({
  data: {
    isEdit: false,
    activityId: '',
    form: {
      title: '',
      date: '',
      time: '',
      location: '',
      maxPeople: '',
      note: ''
    },
    submitting: false
  },

  onLoad(opts) {
    if (opts.id) {
      // 编辑模式：加载已有活动数据
      this.setData({ isEdit: true, activityId: opts.id });
      wx.setNavigationBarTitle({ title: '编辑活动' });
      this.loadActivity(opts.id);
    } else {
      // 创建模式：设置默认日期时间
      this.setData({
        'form.date': todayStr(),
        'form.time': nowTimeStr()
      });
    }
  },

  loadActivity(id) {
    api.getActivity(id).then(detail => {
      const dt = new Date(detail.startTime);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      this.setData({
        form: {
          title: detail.title || '',
          date: `${y}-${m}-${d}`,
          time: `${hh}:${mm}`,
          location: detail.location || '',
          maxPeople: detail.maxPeople ? String(detail.maxPeople) : '',
          note: detail.note || ''
        }
      });
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  onTimeChange(e) {
    this.setData({ 'form.time': e.detail.value });
  },

  goBack() {
    wx.navigateBack();
  },

  onSubmit() {
    const { title, date, time, location, maxPeople, note } = this.data.form;
    if (!title.trim()) return wx.showToast({ title: '请填写活动标题', icon: 'none' });
    if (!date || !time) return wx.showToast({ title: '请选择时间', icon: 'none' });
    if (!location.trim()) return wx.showToast({ title: '请填写地点', icon: 'none' });

    const startTime = new Date(`${date}T${time}:00`).getTime();
    const max = parseInt(maxPeople, 10);
    const payload = {
      title: title.trim(),
      startTime,
      location: location.trim(),
      maxPeople: isNaN(max) || max <= 0 ? 0 : max,
      note: note.trim()
    };

    this.setData({ submitting: true });

    const request = this.data.isEdit
      ? api.updateActivity(this.data.activityId, payload)
      : api.createActivity(payload);

    request
      .then(() => {
        wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => this.setData({ submitting: false }));
  }
});
