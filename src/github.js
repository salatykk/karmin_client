// Работа с релизами GitHub: разбор ссылки, выбор установщика, сравнение версий.
// Чистые функции — покрыты тестами в test/test.js.

function parseRepo(url) {
  const m = String(url || '').trim().match(/github\.com\/([^\/\s?#]+)\/([^\/\s?#]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

// Установщик: имя заканчивается на .exe и не содержит «portable».
function pickInstallerAsset(assets) {
  const list = (assets || []).filter(a => a && typeof a.name === 'string');
  const cands = list.filter(a => /\.exe$/i.test(a.name) && !/portable/i.test(a.name));
  if (!cands.length) return null;
  // если вариантов несколько — предпочитаем «setup/installer», затем x64, затем крупнейший
  const score = a => (/(setup|install)/i.test(a.name) ? 4 : 0) + (/(x64|amd64|win64)/i.test(a.name) ? 2 : 0) - (/(arm64|ia32|x86|win32)/i.test(a.name) ? 1 : 0);
  return cands.slice().sort((a, b) => score(b) - score(a) || (b.size || 0) - (a.size || 0))[0];
}

// Самый свежий релиз из списка /releases: не черновик; стабильные важнее пре-релизов.
function pickNewestRelease(releases) {
  const ok = (releases || []).filter(r => r && !r.draft);
  if (!ok.length) return null;
  const date = r => Date.parse(r.published_at || r.created_at || 0) || 0;
  const sorted = ok.slice().sort((a, b) => date(b) - date(a));
  return sorted.find(r => !r.prerelease) || sorted[0];
}

function parseVer(tag) {
  const m = String(tag || '').trim().replace(/^[^\d]*/, '').match(/^(\d+(?:\.\d+)*)/);
  return m ? m[1].split('.').map(Number) : null;
}

// >0 если a новее b, <0 если старее, 0 если равны. null если сравнить нельзя.
function compareVersions(a, b) {
  if (String(a).trim() === String(b).trim()) return 0;
  const va = parseVer(a), vb = parseVer(b);
  if (!va || !vb) return null;
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] || 0) - (vb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function isUpdateAvailable(installed, latest) {
  if (!installed || !latest) return false;
  const c = compareVersions(latest, installed);
  return c === null ? String(latest).trim() !== String(installed).trim() : c > 0;
}

module.exports = { parseRepo, pickInstallerAsset, pickNewestRelease, compareVersions, isUpdateAvailable };
