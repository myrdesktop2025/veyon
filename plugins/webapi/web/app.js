/* Veyon Web - browser frontend for the Veyon WebAPI plugin
 *
 * Talks to the REST API served by the WebApiHttpServer (default port 11080).
 */

'use strict';

/* ------------------------------------------------------------------ */
/* 常量与配置                                                            */
/* ------------------------------------------------------------------ */

const API_BASE = '/api/v1';

// 认证方法 UUID（与 Veyon 服务端一致）
const AUTH_METHOD_LOGON = '63611f7c-b457-42c7-832e-67d0f9281085';
const AUTH_METHOD_KEY = '0c69b301-81b4-42d6-8fae-128cdd113314';

// 常用功能（按名称与服务端功能列表匹配）
const QUICK_FEATURES = [
  { name: 'ScreenLock', label: '锁屏', toggle: true },
  { name: 'InputDevicesLock', label: '锁定输入', toggle: true },
  { name: 'TextMessage', label: '发送消息', toggle: false },
  { name: 'UserLogoff', label: '注销用户', toggle: false },
  { name: 'Reboot', label: '重启', toggle: false },
  { name: 'PowerDown', label: '关机', toggle: false },
];

// 轮询间隔（毫秒）
const GRID_REFRESH_MS = 4000;
const DETAIL_REFRESH_MS = 2000;
const STATE_REFRESH_MS = 15000;
const HOSTS_REFRESH_MS = 30000;

// 截图尺寸
const GRID_IMG_WIDTH = 400;
const GRID_IMG_HEIGHT = 250;
const DETAIL_IMG_WIDTH = 1280;
const DETAIL_IMG_HEIGHT = 800;

/* ------------------------------------------------------------------ */
/* 小工具                                                               */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function $(id) {
  return document.getElementById(id);
}

/* ------------------------------------------------------------------ */
/* API 客户端                                                           */
/* ------------------------------------------------------------------ */

async function apiRequest(method, path, { headers = {}, body = null, binary = false } = {}) {
  const response = await fetch(API_BASE + path, {
    method,
    headers: Object.assign({}, headers, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    let code = -1;
    let message = 'HTTP ' + response.status;
    let details = '';
    try {
      const errorBody = await response.json();
      if (errorBody && errorBody.error) {
        code = errorBody.error.code;
        message = errorBody.error.message || message;
        details = errorBody.error.details || '';
      }
    } catch (e) { /* 非 JSON 错误体 */ }
    throw new ApiError(code, message, details);
  }

  if (binary) {
    return response.blob();
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

const api = {
  get: (path, headers) => apiRequest('GET', path, { headers }),
  post: (path, body, headers) => apiRequest('POST', path, { body, headers }),
  put: (path, body, headers) => apiRequest('PUT', path, { body, headers }),
  delete: (path, headers) => apiRequest('DELETE', path, { headers }),
  image: (path, headers) => apiRequest('GET', path, { headers, binary: true }),
};

/* ------------------------------------------------------------------ */
/* 全局状态                                                             */
/* ------------------------------------------------------------------ */

const state = {
  hosts: [],                    // [{uid, name, hostAddress}]
  conns: new Map(),             // hostAddress -> {connUid, state, features, error, imgUrl}
  selectedHost: null,
  timers: [],
  creds: { mode: 'logon', username: '', password: '', keyname: '', keydata: '' },
};

/* ------------------------------------------------------------------ */
/* 登录流程                                                             */
/* ------------------------------------------------------------------ */

function bindLogin() {
  $('auth-mode').addEventListener('change', (e) => {
    const keyMode = e.target.value === 'key';
    $('logon-fields').classList.toggle('hidden', keyMode);
    $('key-fields').classList.toggle('hidden', !keyMode);
  });

  $('connect-btn').addEventListener('click', async () => {
    const status = $('login-status');
    status.className = 'status-line';
    status.textContent = '';

    state.creds.mode = $('auth-mode').value;
    state.creds.username = $('username').value.trim();
    state.creds.password = $('password').value;
    state.creds.keyname = $('keyname').value.trim();
    state.creds.keydata = $('keydata').value.trim();

    if (state.creds.mode === 'logon' && (!state.creds.username || !state.creds.password)) {
      status.className = 'status-line error';
      status.textContent = '请输入用户名和密码';
      return;
    }
    if (state.creds.mode === 'key' && (!state.creds.keyname || !state.creds.keydata)) {
      status.className = 'status-line error';
      status.textContent = '请输入密钥名称与密钥内容';
      return;
    }

    $('connect-btn').disabled = true;
    status.textContent = '正在连接…';

    try {
      await loadHosts();
      if (state.hosts.length === 0) {
        // 网络目录暂无主机：进入主界面，用户可手动添加
        status.className = 'status-line ok';
        status.textContent = '未从网络目录获取到主机，可手动添加。';
      }
      await connectAllHosts();
      enterApp();
    } catch (err) {
      status.className = 'status-line error';
      status.textContent = '连接失败：' + (err.message || err);
    } finally {
      $('connect-btn').disabled = false;
    }
  });
}

async function loadHosts() {
  const hosts = await api.get('/hosts');
  if (Array.isArray(hosts)) {
    state.hosts = hosts.filter((h) => h && (h.hostAddress || h.name));
  }
  renderGrid();
}

async function connectAllHosts() {
  const results = await Promise.allSettled(state.hosts.map((host) => authenticateHost(host)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const host = state.hosts[i];
      setHostError(host.hostAddress, result.reason && result.reason.message);
    }
  });
  startPolling();
  renderGrid();
}

async function authenticateHost(host) {
  const address = host.hostAddress || host.name;
  const methodsResult = await api.get('/authentication/' + encodeURIComponent(address));
  const methods = Array.isArray(methodsResult.methods) ? methodsResult.methods : [];

  let method;
  let credentials;

  if (state.creds.mode === 'logon') {
    if (!methods.includes(AUTH_METHOD_LOGON)) {
      throw new ApiError(0, '该主机不支持账号密码认证，请改用密钥方式登录');
    }
    method = AUTH_METHOD_LOGON;
    credentials = { username: state.creds.username, password: state.creds.password };
  } else {
    if (!methods.includes(AUTH_METHOD_KEY)) {
      throw new ApiError(0, '该主机不支持密钥认证，请改用账号密码方式登录');
    }
    method = AUTH_METHOD_KEY;
    credentials = { keyname: state.creds.keyname, keydata: state.creds.keydata };
  }

  const authResult = await api.post('/authentication/' + encodeURIComponent(address), {
    method,
    credentials,
  });

  if (!authResult['connection-uid']) {
    throw new ApiError(0, '认证响应缺少 connection-uid');
  }

  const connUid = authResult['connection-uid'];
  const features = await api.get('/feature', { 'Connection-Uid': connUid });

  state.conns.set(address, {
    connUid,
    host,
    state: 'online',
    error: null,
    features: Array.isArray(features) ? features : [],
    imgUrl: null,
  });

  return connUid;
}

function setHostError(address, message) {
  const conn = state.conns.get(address);
  if (conn) {
    conn.error = message;
    conn.state = 'error';
  }
}

/* ------------------------------------------------------------------ */
/* 主界面                                                               */
/* ------------------------------------------------------------------ */

function enterApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  renderGrid();
  renderToolbar();
  updateSummary();
}

function leaveApp() {
  stopPolling();
  const tasks = [];
  for (const [address, conn] of state.conns) {
    tasks.push(api.delete('/authentication/' + encodeURIComponent(address), { 'Connection-Uid': conn.connUid })
      .catch(() => {}));
  }
  Promise.allSettled(tasks).then(() => {
    state.conns.clear();
    state.hosts = [];
    state.selectedHost = null;
    $('app-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
  });
}

function updateSummary() {
  const online = [...state.conns.values()].filter((c) => c.state === 'online').length;
  $('conn-summary').textContent = `已连接 ${online}/${state.hosts.length} 台主机`;
}

function renderGrid() {
  const grid = $('hosts-grid');
  grid.innerHTML = '';

  if (state.hosts.length === 0) {
    const card = el('div', 'host-card');
    const thumb = el('div', 'thumb');
    thumb.appendChild(el('span', 'placeholder', '暂无主机，点击“手动添加主机”'));
    card.appendChild(thumb);
    grid.appendChild(card);
    return;
  }

  for (const host of state.hosts) {
    grid.appendChild(buildHostCard(host));
  }
}

function buildHostCard(host) {
  const address = host.hostAddress || host.name;
  const conn = state.conns.get(address) || { state: 'down', error: null, imgUrl: null };

  const card = el('div', 'host-card');
  if (state.selectedHost === address) {
    card.classList.add('selected');
  }
  if (conn.state === 'error') {
    card.classList.add('offline');
  }

  const thumb = el('div', 'thumb');
  if (conn.imgUrl) {
    const img = el('img');
    img.src = conn.imgUrl;
    img.alt = host.name || address;
    thumb.appendChild(img);
  } else {
    const placeholder = el('span', 'placeholder', conn.state === 'error' ? '连接失败' : '等待画面…');
    thumb.appendChild(placeholder);
  }
  if (conn.error) {
    thumb.appendChild(el('span', 'error-badge', conn.error));
  }
  card.appendChild(thumb);

  const meta = el('div', 'meta');
  const nameWrap = el('div');
  nameWrap.appendChild(el('div', 'name', host.name || address));
  nameWrap.appendChild(el('div', 'address', address));
  meta.appendChild(nameWrap);
  meta.appendChild(el('div', 'state-dot ' + (conn.state || 'down')));
  card.appendChild(meta);

  card.addEventListener('click', () => selectHost(address));
  return card;
}

function selectHost(address) {
  state.selectedHost = address;
  renderGrid();

  const panel = $('detail-panel');
  const conn = state.conns.get(address);
  panel.classList.remove('hidden');

  if (!conn || !conn.connUid) {
    $('detail-title').textContent = address;
    $('detail-session').textContent = '未连接（请重新登录或检查该主机）。';
    $('detail-image').style.display = 'none';
    $('detail-actions').innerHTML = '';
    return;
  }

  const host = conn.host;
  $('detail-title').textContent = host.name || address;

  // 会话与用户信息
  Promise.allSettled([
    api.get('/session', { 'Connection-Uid': conn.connUid }),
    api.get('/user', { 'Connection-Uid': conn.connUid }),
  ]).then(([sessionResult, userResult]) => {
    const lines = [];
    const session = sessionResult.status === 'fulfilled' ? sessionResult.value : {};
    const user = userResult.status === 'fulfilled' ? userResult.value : {};
    if (session.sessionHostName) lines.push('主机名：' + session.sessionHostName);
    if (session.sessionClientName) lines.push('客户端：' + session.sessionClientName);
    if (session.sessionId) lines.push('会话 ID：' + session.sessionId);
    if (user.login) lines.push('用户：' + (user.fullName ? user.fullName + ' (' + user.login + ')' : user.login));
    $('detail-session').textContent = lines.length ? lines.join('\n') : '未获取到会话信息';
  });

  // 大画面
  $('detail-image').style.display = 'block';
  refreshFramebuffer(address, DETAIL_IMG_WIDTH, DETAIL_IMG_HEIGHT, 'detail-image');

  renderDetailActions(conn);
}

function renderDetailActions(conn) {
  const box = $('detail-actions');
  box.innerHTML = '';

  // 快速操作
  const quickRow = el('div', 'row');
  let quickCount = 0;
  for (const quick of QUICK_FEATURES) {
    const feature = (conn.features || []).find((f) => f.name === quick.name);
    if (!feature) continue;
    quickCount++;
    const btn = el('button', null, quick.label);
    if (quick.toggle && feature.active) btn.classList.add('active');
    btn.addEventListener('click', () => toggleFeature(conn, feature.uid, quick.toggle, quick.name));
    quickRow.appendChild(btn);
  }
  if (quickCount === 0) {
    quickRow.appendChild(el('span', 'sub', '该主机没有可用的快捷操作'));
  }
  box.appendChild(quickRow);

  // 全部功能（可切换的开关功能）
  const togglable = (conn.features || []).filter((f) => f.parentUid === '' || !f.parentUid);
  const subLabel = el('div', 'sub', '其他功能：');
  box.appendChild(subLabel);
  const allRow = el('div', 'row');
  let allCount = 0;
  for (const feature of togglable) {
    if (QUICK_FEATURES.some((q) => q.name === feature.name)) continue;
    allCount++;
    const btn = el('button', null, feature.name);
    if (feature.active) btn.classList.add('active');
    btn.addEventListener('click', () => toggleFeature(conn, feature.uid, true, feature.name));
    allRow.appendChild(btn);
  }
  if (allCount === 0) {
    allRow.appendChild(el('span', 'sub', '无'));
  }
  box.appendChild(allRow);
}

async function toggleFeature(conn, featureUid, isToggle, label) {
  try {
    // 非开关型功能（如发送消息、重启）直接执行一次
    if (!isToggle) {
      if (label === 'TextMessage') {
        openMessageDialog(conn, featureUid);
        return;
      }
      await api.put('/feature/' + featureUid, { active: true, arguments: {} }, { 'Connection-Uid': conn.connUid });
      return;
    }

    const feature = (conn.features || []).find((f) => f.uid === featureUid);
    const active = feature ? feature.active : false;
    await api.put('/feature/' + featureUid, { active: !active, arguments: {} }, { 'Connection-Uid': conn.connUid });

    // 刷新功能状态
    const features = await api.get('/feature', { 'Connection-Uid': conn.connUid });
    conn.features = Array.isArray(features) ? features : [];
    if (state.selectedHost === conn.host.hostAddress || state.selectedHost === conn.host.name) {
      renderDetailActions(conn);
    }
  } catch (err) {
    alert('操作失败：' + (err.message || err));
  }
}

/* ------------------------------------------------------------------ */
/* 截图与状态轮询                                                       */
/* ------------------------------------------------------------------ */

async function refreshFramebuffer(address, width, height, imageId) {
  const conn = state.conns.get(address);
  if (!conn || !conn.connUid) return;

  try {
    const blob = await api.image(
      `/framebuffer?format=png&compression=5&quality=75&width=${width}&height=${height}`,
      { 'Connection-Uid': conn.connUid }
    );
    const url = URL.createObjectURL(blob);

    if (imageId) {
      // 详情面板大图
      const img = $(imageId);
      if (!img) return;
      img.src = url;
      img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 3000);
      return;
    }

    // 网格缩略图
    if (conn.imgUrl) URL.revokeObjectURL(conn.imgUrl);
    conn.imgUrl = url;
    conn.error = null;

    const card = findCard(address);
    if (card) {
      const thumb = card.querySelector('.thumb');
      if (thumb) {
        thumb.innerHTML = '';
        const imgEl = el('img');
        imgEl.src = url;
        imgEl.alt = conn.host.name || address;
        thumb.appendChild(imgEl);
      }
    }
  } catch (err) {
    // 画面暂不可用（例如客户端离线或未登录）时保持占位
    if (imageId) {
      const img = $(imageId);
      if (img) img.src = '';
    }
  }
}

async function refreshHostState(address) {
  const conn = state.conns.get(address);
  if (!conn) return;

  try {
    const result = await api.get('/hoststate/' + encodeURIComponent(address));
    const newState = result.state || 'down';
    if (conn.state !== 'error') {
      conn.state = newState;
    }
    updateSummary();
    const card = findCard(address);
    if (card) {
      const dot = card.querySelector('.state-dot');
      if (dot) dot.className = 'state-dot ' + (conn.state === 'error' ? 'error' : conn.state);
    }
  } catch (err) {
    if (conn.state !== 'error') {
      conn.state = 'down';
    }
  }
}

function findCard(address) {
  const cards = document.querySelectorAll('.host-card');
  for (const card of cards) {
    const addrNode = card.querySelector('.address');
    if (addrNode && addrNode.textContent === address) return card;
  }
  return null;
}

function startPolling() {
  stopPolling();

  const pollFramebuffer = () => {
    for (const [address, conn] of state.conns) {
      if (!conn.connUid) continue;
      const isSelected = state.selectedHost === address;
      refreshFramebuffer(address, GRID_IMG_WIDTH, GRID_IMG_HEIGHT, null);
    }
    if (state.selectedHost && state.conns.has(state.selectedHost)) {
      refreshFramebuffer(state.selectedHost, DETAIL_IMG_WIDTH, DETAIL_IMG_HEIGHT, 'detail-image');
    }
  };

  const pollStates = () => {
    for (const address of state.conns.keys()) {
      refreshHostState(address);
    }
  };

  const pollHosts = () => {
    loadHosts().then(() => {
      const known = new Set(state.conns.keys());
      for (const host of state.hosts) {
        const address = host.hostAddress || host.name;
        if (!known.has(address)) {
          authenticateHost(host)
            .then(() => { updateSummary(); renderGrid(); })
            .catch((err) => setHostError(address, err.message));
        }
      }
      renderGrid();
      updateSummary();
    }).catch(() => {});
  };

  state.timers.push(setInterval(pollFramebuffer, GRID_REFRESH_MS));
  state.timers.push(setInterval(pollStates, STATE_REFRESH_MS));
  state.timers.push(setInterval(pollHosts, HOSTS_REFRESH_MS));

  pollFramebuffer();
  pollStates();
}

function stopPolling() {
  for (const timer of state.timers) {
    clearInterval(timer);
  }
  state.timers = [];
}

/* ------------------------------------------------------------------ */
/* 工具栏与对话框                                                       */
/* ------------------------------------------------------------------ */

function renderToolbar() {
  const toolbar = $('toolbar');
  toolbar.innerHTML = '';

  const hint = el('span', 'tb-hint', '选中一台主机后可使用快捷操作');
  toolbar.appendChild(hint);

  toolbar.appendChild(el('span', 'tb-hint', '　'));
  const refreshBtn = el('button', null, '立即刷新画面');
  refreshBtn.addEventListener('click', () => {
    for (const [address, conn] of state.conns) {
      if (conn.connUid) refreshFramebuffer(address, GRID_IMG_WIDTH, GRID_IMG_HEIGHT, null);
    }
    if (state.selectedHost) refreshFramebuffer(state.selectedHost, DETAIL_IMG_WIDTH, DETAIL_IMG_HEIGHT, 'detail-image');
  });
  toolbar.appendChild(refreshBtn);
}

function openMessageDialog(conn, featureUid) {
  const dialog = $('message-dialog');
  $('message-title').value = '';
  $('message-text').value = '';

  $('message-confirm').onclick = async () => {
    const text = $('message-text').value.trim();
    if (!text) return;
    const title = $('message-title').value.trim();
    const args = { text, icon: 0 };
    if (title) args.title = title;

    try {
      await api.put('/feature/' + featureUid, { active: true, arguments: args }, { 'Connection-Uid': conn.connUid });
      dialog.close();
    } catch (err) {
      alert('发送失败：' + (err.message || err));
    }
  };
  $('message-cancel').onclick = () => dialog.close();
  dialog.showModal();
}

function bindDialogs() {
  // 手动添加主机
  $('add-host-btn').addEventListener('click', () => {
    $('add-host-input').value = '';
    $('add-host-dialog').showModal();
  });
  $('add-host-cancel').addEventListener('click', () => $('add-host-dialog').close());
  $('add-host-confirm').addEventListener('click', async () => {
    const address = $('add-host-input').value.trim();
    if (!address) return;
    $('add-host-dialog').close();

    const host = { uid: null, name: address, hostAddress: address };
    if (state.hosts.some((h) => (h.hostAddress || h.name) === address)) {
      alert('该主机已在列表中');
      return;
    }
    state.hosts.push(host);
    renderGrid();

    try {
      await authenticateHost(host);
      updateSummary();
      startPolling();
    } catch (err) {
      setHostError(address, err.message);
      renderGrid();
    }
  });

  $('refresh-hosts-btn').addEventListener('click', async () => {
    try {
      await loadHosts();
      const known = new Set(state.conns.keys());
      for (const host of state.hosts) {
        const address = host.hostAddress || host.name;
        if (!known.has(address)) {
          authenticateHost(host).catch((err) => setHostError(address, err.message));
        }
      }
      updateSummary();
      renderGrid();
    } catch (err) {
      alert('刷新主机失败：' + (err.message || err));
    }
  });

  $('logout-btn').addEventListener('click', leaveApp);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                 */
/* ------------------------------------------------------------------ */

 document.addEventListener('DOMContentLoaded', () => {
  bindLogin();
  bindDialogs();
});
