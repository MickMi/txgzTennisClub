// 云函数：activity
// action: list | get | create | join | leave
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ACT = 'activities';
const USERS = 'users';

async function getUser(openid) {
  const r = await db.collection(USERS).where({ openid }).get();
  return r.data[0];
}

async function getCreatorName(openid) {
  const u = await getUser(openid);
  return u && u.wecomName ? u.wecomName : '匿名';
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  if (action === 'list') {
    const res = await db.collection(ACT)
      .orderBy('startTime', 'desc')
      .limit(100)
      .get();
    return { code: 0, data: res.data };
  }

  if (action === 'get') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const activity = res.data;

    // 为每个参与者附加评级信息
    const participants = activity.participants || [];
    if (participants.length > 0) {
      const openids = participants.map(p => p.openid);
      const usersRes = await db.collection(USERS)
        .where({ openid: _.in(openids) })
        .field({ openid: true, rating: true, gender: true })
        .get();
      const ratingMap = {};
      for (const u of usersRes.data) {
        ratingMap[u.openid] = { rating: u.rating || '', gender: u.gender || '' };
      }
      activity.participants = participants.map(p => ({
        ...p,
        rating: ratingMap[p.openid] ? ratingMap[p.openid].rating : '',
        gender: ratingMap[p.openid] ? ratingMap[p.openid].gender : ''
      }));
    }

    return { code: 0, data: activity };
  }

  if (action === 'create') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };
    const p = event.payload || {};
    if (!p.title || !p.startTime || !p.location) {
      return { code: 1, msg: '参数不完整' };
    }
    const now = Date.now();
    const addRes = await db.collection(ACT).add({
      data: {
        title: String(p.title).slice(0, 40),
        startTime: p.startTime,
        location: String(p.location).slice(0, 50),
        maxPeople: p.maxPeople || 0,
        note: p.note ? String(p.note).slice(0, 200) : '',
        creator: OPENID,
        creatorName: me.wecomName,
        participants: [],
        status: 'open',
        createdAt: now,
        updatedAt: now
      }
    });
    return { code: 0, data: { _id: addRes._id } };
  }

  if (action === 'join') {
    const me = await getUser(OPENID);
    if (!me || !me.wecomName) return { code: 1, msg: '请先完成登记' };

    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const a = res.data;
    if (a.status === 'closed') return { code: 1, msg: '活动已结束' };

    const list = a.participants || [];
    if (list.some(p => p.openid === OPENID)) {
      return { code: 1, msg: '已经报名过了' };
    }
    if (a.maxPeople > 0 && list.length >= a.maxPeople) {
      return { code: 1, msg: '已满员' };
    }
    list.push({ openid: OPENID, wecomName: me.wecomName, joinedAt: Date.now() });
    await db.collection(ACT).doc(event.id).update({
      data: { participants: list, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  if (action === 'leave') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const list = (res.data.participants || []).filter(p => p.openid !== OPENID);
    await db.collection(ACT).doc(event.id).update({
      data: { participants: list, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  if (action === 'update') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const a = res.data;
    // 仅创建者或管理员可编辑
    const me = await getUser(OPENID);
    if (a.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限编辑' };
    }
    const p = event.payload || {};
    const updateData = { updatedAt: Date.now() };
    if (p.title) updateData.title = String(p.title).slice(0, 40);
    if (p.startTime) updateData.startTime = p.startTime;
    if (p.location) updateData.location = String(p.location).slice(0, 50);
    if (p.maxPeople !== undefined) updateData.maxPeople = p.maxPeople;
    if (p.note !== undefined) updateData.note = String(p.note || '').slice(0, 200);
    await db.collection(ACT).doc(event.id).update({ data: updateData });
    return { code: 0, data: true };
  }

  if (action === 'delete') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const a = res.data;
    // 仅创建者或管理员可删除
    const me = await getUser(OPENID);
    if (a.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限删除' };
    }
    await db.collection(ACT).doc(event.id).remove();
    return { code: 0, data: true };
  }

  return { code: 1, msg: '未知 action' };
};
