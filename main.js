// Karmin Client — главный процесс Electron.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const APPS = require('./src/apps');
const gh = require('./src/github');

const IS_WIN = process.platform === 'win32';
const SHOT = process.env.KARMIN_SCREENSHOT; // режим автотеста: сделать скриншот и выйти
let win;

if (!app.requestSingleInstanceLock() && !SHOT) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

/* ---------------- состояние (userData/state.json) ---------------- */
const statePath = () => path.join(app.getPath('userData'), 'state.json');
let state = { apps: {}, releases: {} };
function loadState() {
  try { state = Object.assign({ apps: {}, releases: {} }, JSON.parse(fs.readFileSync(statePath(), 'utf8'))); } catch { /* первый запуск */ }
}
function saveState() {
  try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch (e) { console.error('state save', e); }
}
const appState = id => (state.apps[id] = state.apps[id] || {});

/* ---------------- GitHub API ---------------- */
const UA = 'KarminClient/' + app.getVersion();
const releaseCache = new Map(); // id -> { at, data }
const TTL = 10 * 60 * 1000;

class UserError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

function netError(e) {
  const c = e && (e.code || (e.cause && e.cause.code));
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(c) || /fetch failed|network/i.test(e && e.message))
    return new UserError('Нет подключения к интернету или GitHub недоступен. Проверьте соединение и попробуйте ещё раз.', 'offline');
  return e instanceof UserError ? e : new UserError('Ошибка сети: ' + (e && e.message || e), 'net');
}

async function ghJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) });
  } catch (e) { throw netError(e); }
  if (res.status === 404) return { notFound: true };
  if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429)) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    const when = reset ? new Date(reset).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'через час';
    throw new UserError(`GitHub временно ограничил число запросов. Попробуйте после ${when}.`, 'ratelimit');
  }
  if (!res.ok) throw new UserError(`GitHub ответил ошибкой ${res.status}.`, 'http');
  return res.json();
}

async function getRelease(appDef, force) {
  const c = releaseCache.get(appDef.id);
  if (!force && c && Date.now() - c.at < TTL) return c.data;
  const repo = gh.parseRepo(appDef.releases);
  if (!repo) throw new UserError(`Неверная ссылка на релизы у «${appDef.name}».`, 'config');
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  let rel = await ghJson(base + '/releases/latest');
  if (rel.notFound) { // нет «latest» (например, только пре-релизы) — берём список
    const list = await ghJson(base + '/releases?per_page=30');
    rel = Array.isArray(list) ? gh.pickNewestRelease(list) : null;
    if (!rel) throw new UserError(`У «${appDef.name}» на GitHub пока нет опубликованных релизов.`, 'norelease');
  }
  const asset = gh.pickInstallerAsset(rel.assets);
  const data = {
    tag: rel.tag_name, name: rel.name || rel.tag_name, publishedAt: rel.published_at, url: rel.html_url,
    notes: (rel.body || '').slice(0, 2000),
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
  };
  releaseCache.set(appDef.id, { at: Date.now(), data });
  state.releases[appDef.id] = data; saveState(); // для офлайн-режима
  return data;
}

/* ---------------- поиск установленного exe ---------------- */
function exeCandidates(appDef) {
  const env = process.env;
  const names = [...new Set([appDef.exeName, appDef.name + '.exe'].filter(Boolean))];
  const folders = [...new Set([appDef.name, appDef.name.toLowerCase(), appDef.id, appDef.name.replace(/\s+/g, '')])];
  const roots = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA,
    env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432,
  ].filter(Boolean);
  const out = [];
  for (const r of roots) for (const f of folders) for (const n of names) out.push(path.join(r, f, n));
  return out;
}
function findShortcutTarget(appDef) {
  if (!IS_WIN) return null;
  const dirs = [process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs'),
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(os.homedir(), 'Desktop')].filter(Boolean);
  for (const d of dirs) for (const sub of ['', appDef.name]) {
    const lnk = path.join(d, sub, appDef.name + '.lnk');
    try { if (fs.existsSync(lnk)) { const t = shell.readShortcutLink(lnk).target; if (t && fs.existsSync(t)) return t; } } catch { }
  }
  return null;
}
function findExe(appDef) {
  const s = appState(appDef.id);
  if (s.exePath && fs.existsSync(s.exePath)) return s.exePath;
  if (!IS_WIN) return null;
  for (const p of exeCandidates(appDef)) if (fs.existsSync(p)) return p;
  // запасной вариант: папки в %LOCALAPPDATA%\Programs, похожие на имя приложения
  try {
    const root = path.join(process.env.LOCALAPPDATA, 'Programs');
    for (const dir of fs.readdirSync(root)) if (dir.toLowerCase().includes(appDef.name.toLowerCase())) {
      for (const n of [appDef.exeName, appDef.name + '.exe'].filter(Boolean)) { const p = path.join(root, dir, n); if (fs.existsSync(p)) return p; }
    }
  } catch { }
  return findShortcutTarget(appDef);
}

/* ---------------- каталог для интерфейса ---------------- */
async function catalog(force) {
  const out = [];
  for (const a of APPS) {
    const s = appState(a.id);
    let release = null, error = null;
    try { release = await getRelease(a, force); }
    catch (e) { error = { message: e.message, code: e.code }; release = state.releases[a.id] || null; }
    const exe = findExe(a);
    const installed = !!(s.installedVersion || exe);
    let status = installed ? 'installed' : 'none';
    if (installed && s.installedVersion && release && gh.isUpdateAvailable(s.installedVersion, release.tag)) status = 'update';
    if (downloads.find(d => d.appId === a.id && ['downloading', 'installing'].includes(d.status))) status = 'busy';
    out.push({ ...a, release, error, status, installedVersion: s.installedVersion || null, exeFound: !!exe });
  }
  return out;
}

/* ---------------- загрузки ---------------- */
const downloads = []; // { id, appId, name, file, version, received, total, speed, status, error, startedAt }
const active = new Map(); // id -> { req, file }
let dlSeq = 0;
const dlDir = () => path.join(app.getPath('temp'), 'KarminClient', 'downloads');
const pub = d => { const { _req, ...rest } = d; return rest; };
function pushDownloads() { if (win && !win.isDestroyed()) win.webContents.send('downloads:update', downloads.map(pub)); }
function pushCatalog() { catalog(false).then(c => win && !win.isDestroyed() && win.webContents.send('catalog:update', c)).catch(() => { }); }

function httpGet(url, onRes, onErr, hops = 0) {
  if (hops > 10) return onErr(new UserError('Слишком много перенаправлений при скачивании.'));
  const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/octet-stream' }, timeout: 30000 }, res => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume(); const next = new URL(res.headers.location, url).toString();
      const r2 = httpGet(next, onRes, onErr, hops + 1); req._next = r2; return;
    }
    onRes(res, req);
  });
  req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  req.on('error', onErr);
  return req;
}

async function startInstall(appId) {
  const a = APPS.find(x => x.id === appId);
  if (!a) throw new UserError('Приложение не найдено в каталоге.');
  if (downloads.find(d => d.appId === appId && ['downloading', 'installing'].includes(d.status)))
    throw new UserError(`«${a.name}» уже скачивается.`);
  const rel = await getRelease(a, true);
  if (!rel.asset) throw new UserError(`В последнем релизе «${a.name}» (${rel.tag}) нет установщика .exe (файлы с «portable» не подходят). Загрузите установщик в релиз на GitHub.`, 'noasset');

  const d = { id: ++dlSeq, appId, name: a.name, accent: a.accent, file: rel.asset.name, version: rel.tag, received: 0, total: rel.asset.size || 0, speed: 0, status: 'downloading', error: null, startedAt: Date.now() };
  downloads.unshift(d);
  fs.mkdirSync(dlDir(), { recursive: true });
  const target = path.join(dlDir(), rel.asset.name.replace(/[\\/:*?"<>|]/g, '_'));
  const part = target + '.part';
  const out = fs.createWriteStream(part);
  let lastT = Date.now(), lastB = 0, lastPush = 0;
  const fail = (e) => {
    if (d.status !== 'downloading') return;
    d.status = 'error'; d.error = netError(e).message; out.destroy(); fs.rm(part, { force: true }, () => { });
    active.delete(d.id); pushDownloads(); pushCatalog();
  };
  const ctl = { req: null, cancel: () => { d.status = 'cancelled'; for (let r = ctl.req; r; r = r._next) { try { r.destroy(); } catch { } } out.destroy(); fs.rm(part, { force: true }, () => { }); active.delete(d.id); pushDownloads(); pushCatalog(); } };
  active.set(d.id, ctl);
  ctl.req = httpGet(rel.asset.url, (res, req) => {
    ctl.cur = req;
    if (d.status !== 'downloading') { res.resume(); return; }
    if (res.statusCode !== 200) { res.resume(); return fail(new UserError(`Сервер вернул ошибку ${res.statusCode} при скачивании.`)); }
    d.total = Number(res.headers['content-length']) || d.total;
    res.on('data', ch => {
      d.received += ch.length;
      const now = Date.now();
      if (now - lastT >= 500) { d.speed = (d.received - lastB) / ((now - lastT) / 1000); lastT = now; lastB = d.received; }
      if (now - lastPush > 150) { lastPush = now; pushDownloads(); }
    });
    res.on('error', fail);
    res.pipe(out);
    out.on('finish', () => {
      if (d.status !== 'downloading') return;
      active.delete(d.id);
      try { fs.rmSync(target, { force: true }); fs.renameSync(part, target); } catch (e) { return fail(e); }
      d.received = d.total || d.received; d.speed = 0; d.path = target;
      runInstaller(a, d, target);
    });
  }, fail);
  ctl.cur = ctl.req;
  pushDownloads(); pushCatalog();
  return d.id;
}

function markInstalled(a, d) {
  const s = appState(a.id); s.installedVersion = d.version; s.installedAt = new Date().toISOString();
  if (s.exePath && !fs.existsSync(s.exePath)) delete s.exePath;
  saveState();
}

function runInstaller(a, d, file) {
  d.status = 'installing'; pushDownloads(); pushCatalog();
  const done = (ok, msg) => {
    if (ok) { markInstalled(a, d); d.status = 'done'; d.finishedAt = Date.now(); }
    else { d.status = 'error'; d.error = msg; }
    pushDownloads(); pushCatalog();
  };
  if (!IS_WIN) return done(false, 'Установка возможна только в Windows. Файл скачан: ' + file);
  // Через ShellExecute — так корректно отрабатывает запрос прав администратора (UAC)
  const viaShell = () => shell.openPath(file).then(err => err ? done(false, 'Не удалось запустить установщик: ' + err) : done(true));
  let child;
  try { child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false }); }
  catch (e) { return viaShell(); }
  child.on('error', () => viaShell()); // например, требуется повышение прав (740)
  child.on('exit', code => {
    if (code === 0) done(true);
    else if (code === 740) viaShell();
    else done(false, `Установка прервана или завершилась с ошибкой (код ${code}). Можно повторить.`);
  });
  child.unref();
}

/* ---------------- окно ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 980, minHeight: 620, frame: false, show: false,
    backgroundColor: '#070204', title: 'Karmin Client',
    icon: path.join(__dirname, 'build', IS_WIN ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());

  if (SHOT) {
    win.webContents.on('console-message', (_e, level, msg) => console.log(`[renderer:${level}] ${msg}`));
    win.webContents.on('did-finish-load', () => setTimeout(async () => {
      if (process.env.KARMIN_EVAL) await win.webContents.executeJavaScript(process.env.KARMIN_EVAL);
      if (process.env.KARMIN_VIEW) await win.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(process.env.KARMIN_VIEW)})`);
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(SHOT, img.toPNG()); console.log('SCREENSHOT_SAVED', SHOT); app.quit();
      }, Number(process.env.KARMIN_WAIT || (process.env.KARMIN_VIEW ? 1500 : 0)));
    }, 4500));
  }
}

ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

const wrap = fn => async (...args) => { try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e), code: e.code }; } };
ipcMain.handle('catalog:get', wrap((_e, force) => catalog(!!force)));
ipcMain.handle('app:install', wrap((_e, id) => startInstall(id)));
ipcMain.handle('downloads:get', () => downloads.map(pub));
ipcMain.handle('download:cancel', wrap((_e, id) => { const c = active.get(id); if (c) c.cancel(); return true; }));
ipcMain.handle('downloads:clear', () => { for (let i = downloads.length - 1; i >= 0; i--) if (!['downloading', 'installing'].includes(downloads[i].status)) downloads.splice(i, 1); pushDownloads(); return true; });
ipcMain.handle('download:retry', wrap((_e, appId) => startInstall(appId)));
ipcMain.handle('download:showFile', (_e, p) => p && shell.showItemInFolder(p));
ipcMain.handle('open:external', (_e, url) => /^https:\/\//.test(url) && shell.openExternal(url));

ipcMain.handle('app:launch', wrap(async (_e, id) => {
  const a = APPS.find(x => x.id === id); if (!a) throw new UserError('Приложение не найдено.');
  let exe = findExe(a);
  if (!exe) {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Указать файл', 'Отмена'], defaultId: 0, cancelId: 1, title: 'Karmin Client',
      message: `Не нашли установленный «${a.name}».`, detail: 'Укажите exe-файл программы один раз — клиент его запомнит.' });
    if (r.response !== 0) return false;
    exe = await pickExe(a); if (!exe) return false;
  }
  const err = await shell.openPath(exe);
  if (err) throw new UserError('Не удалось запустить: ' + err);
  return true;
}));
async function pickExe(a) {
  const r = await dialog.showOpenDialog(win, { title: `Где находится ${a.name}?`, properties: ['openFile'], filters: [{ name: 'Программы', extensions: ['exe'] }],
    defaultPath: IS_WIN && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : os.homedir() });
  if (r.canceled || !r.filePaths[0]) return null;
  const s = appState(a.id); s.exePath = r.filePaths[0]; saveState(); pushCatalog();
  return s.exePath;
}
ipcMain.handle('app:pickExe', wrap(async (_e, id) => { const a = APPS.find(x => x.id === id); return a ? pickExe(a) : null; }));
ipcMain.handle('app:forget', wrap(async (_e, id) => { delete state.apps[id]; saveState(); pushCatalog(); return true; }));

if (SHOT) app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.whenReady().then(() => { loadState(); createWindow(); });
app.on('window-all-closed', () => app.quit());
