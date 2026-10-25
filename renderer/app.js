// Karmin Client — интерфейс.
(() => {
  const K = window.karmin;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let apps = [], downloads = [], filter = 'all', query = '', view = 'home';

  /* ---------- окно ---------- */
  $('#tb-min').onclick = () => K.minimize();
  $('#tb-max').onclick = () => K.maximize();
  $('#tb-close').onclick = () => K.close();
  K.onWinState(s => $('#tb-max').title = s.maximized ? 'Восстановить' : 'Развернуть');
  K.info().then(i => $('#ver').textContent = 'Karmin Client v' + i.version);

  /* ---------- меню ---------- */
  if (localStorage.getItem('side') === 'collapsed') document.body.classList.add('side-collapsed');
  $('#burger').onclick = () => {
    document.body.classList.toggle('side-collapsed');
    localStorage.setItem('side', document.body.classList.contains('side-collapsed') ? 'collapsed' : 'open');
    setTimeout(() => dispatchEvent(new Event('resize')), 560);
  };
  function moveGlow() {
    const a = $('.nav-item.active'); if (!a) return;
    $('#nav-glow').style.transform = `translateY(${a.offsetTop}px)`;
  }
  function go(v) {
    if (!$(`.view[data-view="${v}"]`)) return;
    view = v;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === v));
    moveGlow();
    window.KarminScene && window.KarminScene.setHeroActive(v === 'home');
    if (v === 'library') renderLibrary();
  }
  window.__go = go;
  $$('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));

  /* ---------- уведомления ---------- */
  function toast(msg, type = 'info', ms = 5200) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<i>${type === 'err' ? '⚠' : type === 'ok' ? '✓' : '✦'}</i><div>${esc(msg)}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
  }

  /* ---------- утилиты ---------- */
  const plural = (n, f) => f[(n % 10 === 1 && n % 100 !== 11) ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2];
  const mb = b => (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
  const spd = b => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' МБ/с' : Math.round(b / 1024) + ' КБ/с';
  const eta = s => !isFinite(s) || s <= 0 ? '' : s < 60 ? `осталось ${Math.ceil(s)} с` : `осталось ${Math.ceil(s / 60)} мин`;
  const icon = a => `<div class="app-icon" style="--a:${esc(a.accent || '#ff3b4e')}">${a.icon ? `<img src="assets/apps/${esc(a.icon)}" alt="">` : esc((a.name || '?')[0].toUpperCase())}</div>`;
  const STATUS = { installed: 'Установлено', none: 'Не установлено', update: 'Есть обновление', busy: 'Устанавливается…' };
  const statusPill = a => `<span class="status ${a.status}">${STATUS[a.status]}</span>`;
  const verLine = a => {
    const latest = a.release ? a.release.tag : null;
    if (a.status === 'update') return `<span class="ver">${esc(a.installedVersion)} → ${esc(latest)}</span>`;
    if (a.installedVersion) return `<span class="ver">${esc(a.installedVersion)}</span>`;
    return latest ? `<span class="ver">последняя ${esc(latest)}</span>` : '';
  };
  function mainBtn(a, cls = '') {
    if (a.status === 'busy') return `<button class="btn ${cls}" data-act="downloads">Прогресс</button>`;
    if (a.status === 'update') return `<button class="btn upd ${cls}" data-act="install" data-id="${a.id}">Обновить</button>`;
    if (a.status === 'installed') return `<button class="btn ${cls}" data-act="launch" data-id="${a.id}">Запустить ▸</button>`;
    return `<button class="btn ${cls}" data-act="install" data-id="${a.id}">Установить</button>`;
  }

  /* ---------- Главная ---------- */
  function renderHome() {
    const rec = apps.filter(a => a.recommended);
    $('#stat-apps').textContent = apps.length; $('#stat-apps-w').textContent = plural(apps.length, ['приложение', 'приложения', 'приложений']);
    $('#stat-installed').textContent = apps.filter(a => a.status === 'installed' || a.status === 'update').length;
    $('#rec-cards').innerHTML = rec.length ? rec.map((a, i) => `
      <article class="card" style="--a:${esc(a.accent)};animation-delay:${.1 + i * .08}s">
        <span class="ribbon">Рекомендуем</span>
        <div class="top">${icon(a)}<div><h3>${esc(a.name)}</h3><div class="tag">${esc(a.tagline)}</div></div></div>
        <p>${esc(a.description)}</p>
        ${a.tags && a.tags.length ? `<div class="chips">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="bottom"><div>${statusPill(a)}<div style="margin-top:6px">${verLine(a)}</div></div>${mainBtn(a)}</div>
      </article>`).join('') : `<div class="empty"><div class="orb"></div>Пока нет рекомендуемых приложений.</div>`;
    bindTilt();
  }
  function bindTilt() {
    $$('.card').forEach(c => {
      c.onpointermove = e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty('--ry', (x - .5) * 10 + 'deg'); c.style.setProperty('--rx', (.5 - y) * 8 + 'deg');
        c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%');
      };
      c.onpointerleave = () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); };
    });
  }

  /* ---------- Библиотека ---------- */
  const I = {
    gh: '<svg viewBox="0 0 24 24"><path d="M9 19c-4 1.5-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  function renderLibrary() {
    const list = apps.filter(a => (filter === 'all' || (filter === 'installed' ? ['installed', 'update'].includes(a.status) : a.status === filter))
      && (!query || (a.name + ' ' + a.tagline + ' ' + a.description).toLowerCase().includes(query)));
    $('#lib').innerHTML = list.length ? list.map((a, i) => `
      <div class="row" style="--a:${esc(a.accent)};animation-delay:${i * .05}s">
        ${icon(a)}
        <div><h3>${esc(a.name)}</h3><div class="tag">${esc(a.tagline)}</div>
          ${a.error ? `<div class="err-line">${esc(a.error.message)}</div>` : ''}</div>
        <div class="meta">${statusPill(a)}${verLine(a)}</div>
        <div class="actions">
          ${a.status === 'installed' || a.status === 'update' ? `<button class="icon-btn" title="Переустановить" data-act="install" data-id="${a.id}">${I.redo}</button>` : ''}
          ${a.status !== 'none' && a.status !== 'busy' ? `<button class="icon-btn" title="Указать exe-файл программы" data-act="pick" data-id="${a.id}">${I.folder}</button>` : ''}
          <button class="icon-btn" title="Страница релизов на GitHub" data-act="gh" data-url="${esc(a.releases)}">${I.gh}</button>
          ${a.status === 'update' ? `<button class="btn alt sm" data-act="launch" data-id="${a.id}">Запустить</button>` : ''}
          ${mainBtn(a, 'sm')}
        </div>
      </div>`).join('') : `<div class="empty"><div class="orb"></div>${query ? 'Ничего не нашлось.' : 'В этой категории пока пусто.'}</div>`;
  }
  $('#filters').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; filter = c.dataset.f; $$('.chip').forEach(x => x.classList.toggle('active', x === c)); renderLibrary(); };
  $('#search').oninput = e => { query = e.target.value.trim().toLowerCase(); renderLibrary(); };
  $('#refresh').onclick = async () => {
    const b = $('#refresh'); b.classList.add('spin');
    await load(true); b.classList.remove('spin');
    const e = apps.find(a => a.error); e ? toast(e.error.message, 'err') : toast('Каталог обновлён', 'ok', 2500);
  };

  /* ---------- Скачивания ---------- */
  const ST = { downloading: 'Скачивание', installing: 'Установка — следуйте инструкциям установщика', done: 'Установлено', error: 'Ошибка', cancelled: 'Отменено' };
  function renderDownloads() {
    const act = downloads.filter(d => ['downloading', 'installing'].includes(d.status));
    const fin = downloads.filter(d => !['downloading', 'installing'].includes(d.status));
    const badge = $('#dl-badge'); badge.hidden = !act.length; badge.textContent = act.length;
    const item = d => {
      const pct = d.total ? Math.min(100, d.received / d.total * 100) : 0;
      const barCls = d.status === 'installing' ? 'indet' : d.status === 'done' ? 'done' : ['error', 'cancelled'].includes(d.status) ? 'fail' : '';
      const info = d.status === 'downloading'
        ? `<span class="st">${pct.toFixed(0)}%</span><span>${mb(d.received)} / ${d.total ? mb(d.total) : '—'}</span><span>${spd(d.speed || 0)}</span><span>${eta((d.total - d.received) / (d.speed || 0))}</span>`
        : `<span class="st">${ST[d.status]}</span>${d.error ? `<span style="color:#ff8f9a;font-family:var(--f-body)">${esc(d.error)}</span>` : `<span>${d.total ? mb(d.total) : ''}</span>`}`;
      const btns = d.status === 'downloading' ? `<button class="icon-btn" title="Отменить" data-act="cancel" data-dl="${d.id}">${I.x}</button>`
        : ['error', 'cancelled'].includes(d.status) ? `<button class="btn alt sm" data-act="install" data-id="${d.appId}">Повторить</button>`
        : d.status === 'done' ? `<button class="btn sm" data-act="launch" data-id="${d.appId}">Запустить ▸</button>` : '';
      return `<div class="dl" style="--a:${esc(d.accent)}">${icon(d)}
        <div><div class="dl-top"><b>${esc(d.name)} <span class="ver">${esc(d.version)}</span></b><span class="file">${esc(d.file)}</span></div>
          <div class="bar ${barCls}"><i style="width:${['done'].includes(d.status) ? 100 : pct}%"></i></div>
          <div class="dl-info">${info}</div></div>
        <div class="actions">${btns}</div></div>`;
    };
    $('#dl-active').innerHTML = act.length ? act.map(item).join('') : `<div class="empty"><div class="orb"></div>Сейчас ничего не скачивается. Откройте «Библиотеку» и нажмите «Установить».</div>`;
    $('#dl-done').innerHTML = fin.length ? fin.map(item).join('') : `<div class="empty"><div class="orb"></div>История загрузок пуста.</div>`;
  }
  $('#dl-clear').onclick = () => K.clearDownloads();

  /* ---------- действия ---------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'downloads') return go('downloads');
    if (act === 'gh') return K.openExternal(b.dataset.url);
    if (act === 'cancel') return K.cancel(Number(b.dataset.dl));
    b.disabled = true;
    try {
      if (act === 'install') {
        const r = await K.install(id);
        if (!r.ok) toast(r.error, 'err', 8000);
        else { toast('Загрузка началась', 'info', 2500); go('downloads'); }
      } else if (act === 'launch') {
        const r = await K.launch(id);
        if (!r.ok) toast(r.error, 'err'); else if (r.data) toast('Запускаем…', 'ok', 2200);
      } else if (act === 'pick') {
        const r = await K.pickExe(id); if (r.ok && r.data) toast('Путь к программе сохранён', 'ok', 2500);
      }
    } finally { b.disabled = false; }
  });

  /* ---------- данные ---------- */
  function renderAll() { renderHome(); renderLibrary(); }
  async function load(force) {
    const r = await K.catalog(force);
    if (r.ok) { apps = r.data; renderAll(); }
    else toast(r.error, 'err');
  }
  K.onCatalog(c => { apps = c; renderAll(); });
  let prev = {};
  K.onDownloads(d => {
    d.forEach(x => {
      if (prev[x.id] && prev[x.id] !== x.status) {
        if (x.status === 'installing') toast(`${x.name} скачан — запускаем установщик`, 'info', 4000);
        if (x.status === 'done') toast(`${x.name} ${x.version} установлен`, 'ok');
        if (x.status === 'error') toast(`${x.name}: ${x.error}`, 'err', 8000);
      }
      prev[x.id] = x.status;
    });
    downloads = d; renderDownloads();
  });

  (async () => {
    renderDownloads();
    const boot = load(false);
    await Promise.race([boot, new Promise(r => setTimeout(r, 2500))]);
    document.body.classList.remove('booting');
    setTimeout(() => $('#splash').remove(), 900);
    requestAnimationFrame(() => { document.body.classList.add('ready'); moveGlow(); });
    await boot;
    const e = apps.find(a => a.error);
    if (e) toast(e.error.message, 'err', 8000);
    K.downloads().then(d => { downloads = d; renderDownloads(); });
  })();
  addEventListener('resize', moveGlow);
})();
