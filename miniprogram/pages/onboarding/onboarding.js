const api = require('../../utils/api.js');
const { setCachedUser } = require('../../utils/user.js');

Page({
  data: {
    wecomName: '',
    gender: '',
    submitting: false
  },

  onInput(e) {
    this.setData({ wecomName: e.detail.value });
  },

  onGenderChange(e) {
    this.setData({ gender: e.detail.value });
  },

  onSubmit() {
    const name = (this.data.wecomName || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写企微名', icon: 'none' });
      return;
    }
    if (name.length > 20) {
      wx.showToast({ title: '企微名过长', icon: 'none' });
      return;
    }
    if (!this.data.gender) {
      wx.showToast({ title: '请选择性别', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    api
      .updateUser({ wecomName: name, gender: this.data.gender })
      .then(user => {
        setCachedUser(user);
        wx.showToast({ title: '登记成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 600);
      })
      .catch(() => {
        this.setData({ submitting: false });
      });
  }
});
