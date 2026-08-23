// 云函数：activity
// action: list | get | create | join | leave
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ACT = 'activities';
const USERS = 'users';
const ACTIVITY_DISABLED_MESSAGE = '活动功能已下线，请使用赛事功能';

async function getUser(openid) {
  const r = await db.collection(USERS).where({ openid }).get();
  return r.data[0];
}

async function getCreatorName(openid) {
  const u = await getUser(openid);
  return u && u.wecomName ? u.wecomName : '匿名';
}

exports.main = async event => {
  // 发布边界：保留历史实现便于回溯，但所有活动能力统一停用。
  // 这道服务端闸门避免旧版本客户端或直接云函数调用继续写入活动数据。
  return { code: 1, msg: ACTIVITY_DISABLED_MESSAGE };

  /* istanbul ignore next -- archived implementation kept for future migration reference */
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  if (action === 'list') {
    // 分页：limit 默认 20，最大 50；before 为上一页最后一条 startTime（cursor）
    const limit = Math.min(Math.max(parseInt(event.limit) || 20, 1), 50);
    const filter = event.filter || 'all'; // 'open' | 'joined' | 'all'
    const now = Date.now();

    // 构造 where 条件（合并 filter + cursor，避免同字段 where 冲突）
    let where = {};
    if (filter === 'open') {
      // 报名中：status=open 且 startTime > now
      where.status = 'open';
      where.startTime = event.before
        ? _.and(_.gt(now), _.lt(event.before))
        : _.gt(now);
    } else if (filter === 'joined') {
      // 已报名：当前用户在 participants 中（dot notation 查嵌套数组对象）
      where['participants.openid'] = OPENID;
      if (event.before) {
        where.startTime = _.lt(event.before);
      }
    } else if (event.before) {
      where.startTime = _.lt(event.before);
    }

    let q = db.collection(ACT)
      .field({
        title: true,
        startTime: true,
        location: true,
        maxPeople: true,
        status: true,
        creator: true,
        creatorName: true,
        participants: true,
        createdAt: true
      })
      .orderBy('startTime', 'desc');
    if (Object.keys(where).length > 0 || filter !== 'all') {
      q = q.where(where);
    }
    const res = await q.limit(limit).get();
    const list = (res.data || []).map(a => {
      const ps = a.participants || [];
      return {
        _id: a._id,
        title: a.title,
        startTime: a.startTime,
        location: a.location,
        maxPeople: a.maxPeople || 0,
        status: a.status,
        creator: a.creator,
        creatorName: a.creatorName,
        participantCount: ps.length,
        joined: ps.some(p => p.openid === OPENID),
        createdAt: a.createdAt
      };
    });
    const hasMore = list.length === limit;
    const nextCursor = hasMore && list.length > 0 ? list[list.length - 1].startTime : null;
    return { code: 0, data: { list, hasMore, nextCursor } };
  }

  if (action === 'get') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const activity = res.data;

    // 为每个参与者附加最新的 rating / gender / avatarUrl（永远显示最新头像，
    // 不依赖 join 时快照写入的字段）
    const participants = activity.participants || [];
    if (participants.length > 0) {
      const openids = participants.map(p => p.openid);
      const usersRes = await db.collection(USERS)
        .where({ openid: _.in(openids) })
        .field({ openid: true, rating: true, gender: true, avatarUrl: true })
        .get();
      const userMap = {};
      for (const u of usersRes.data) {
        userMap[u.openid] = {
          rating: u.rating || '',
          gender: u.gender || '',
          avatarUrl: u.avatarUrl || ''
        };
      }
      activity.participants = participants.map(p => ({
        ...p,
        rating: userMap[p.openid] ? userMap[p.openid].rating : '',
        gender: userMap[p.openid] ? userMap[p.openid].gender : '',
        avatarUrl: userMap[p.openid] ? userMap[p.openid].avatarUrl : ''
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
    // 不允许创建过去的活动（宽限 5 分钟）
    const TOLERANCE_MS = 5 * 60 * 1000;
    if (p.startTime < Date.now() - TOLERANCE_MS) {
      return { code: 1, msg: '活动时间不能早于当前' };
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
    // 开始时间过了：禁止加入（但 leave 仍允许，方便临时退出）
    if (a.startTime && a.startTime <= Date.now()) {
      return { code: 1, msg: '活动已开始，无法加入' };
    }

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
    const a = res.data;
    // 关闭后不允许退出（保持名单完整）；超时但未关闭仍允许（业务需要：临时不能到场）
    if (a.status === 'closed') {
      return { code: 1, msg: '活动已结束，名单已归档' };
    }
    const list = (a.participants || []).filter(p => p.openid !== OPENID);
    await db.collection(ACT).doc(event.id).update({
      data: { participants: list, updatedAt: Date.now() }
    });
    return { code: 0, data: true };
  }

  // 关闭活动（creator/admin 手动归档；status: open → closed）
  if (action === 'close') {
    const res = await db.collection(ACT).doc(event.id).get().catch(() => null);
    if (!res || !res.data) return { code: 1, msg: '活动不存在' };
    const a = res.data;
    const me = await getUser(OPENID);
    if (a.creator !== OPENID && (!me || me.role !== 'admin')) {
      return { code: 1, msg: '无权限关闭' };
    }
    if (a.status === 'closed') return { code: 1, msg: '活动已经是关闭状态' };
    await db.collection(ACT).doc(event.id).update({
      data: { status: 'closed', updatedAt: Date.now() }
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
    // 已关闭的活动不允许再编辑（避免改时间产生时间逻辑混乱）
    if (a.status === 'closed') {
      return { code: 1, msg: '活动已结束，不能再编辑' };
    }
    const p = event.payload || {};
    // 不允许把开始时间改到过去（宽限 5 分钟）
    if (p.startTime !== undefined) {
      const TOLERANCE_MS = 5 * 60 * 1000;
      if (p.startTime < Date.now() - TOLERANCE_MS) {
        return { code: 1, msg: '活动时间不能早于当前' };
      }
    }
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
