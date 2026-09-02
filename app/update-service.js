const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_REPOSITORY = 'cybereun/JamesPDF-V4';
const DEFAULT_ASSET_NAME = 'JamesPDF_Setup.exe';
const DEFAULT_CACHE_MS = 15 * 60 * 1000;
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;

function versionParts(value) {
  const normalized = String(value || '').trim().replace(/^v/i, '').split('-')[0];
  if (!/^\d+(?:\.\d+){2,3}$/.test(normalized)) return null;
  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length < 4) parts.push(0);
  return parts;
}

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 4; index += 1) {
    if (next[index] > installed[index]) return true;
    if (next[index] < installed[index]) return false;
  }
  return false;
}

function selectInstallerAsset(release, assetName = DEFAULT_ASSET_NAME) {
  return Array.isArray(release?.assets)
    ? release.assets.find((asset) => asset?.name === assetName && asset?.state === 'uploaded') || null
    : null;
}

function trustedReleaseUrl(rawUrl, repository, { redirect = false } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (redirect) return host === 'github.com' || host.endsWith('.githubusercontent.com');
  const expectedPrefix = `/${String(repository || DEFAULT_REPOSITORY).toLowerCase()}/releases/download/`;
  return host === 'github.com' && parsed.pathname.toLowerCase().startsWith(expectedPrefix);
}

function requestJson(rawUrl, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('업데이트 확인 리디렉션이 너무 많습니다.'));
    const request = https.get(rawUrl, { timeout: 12000, headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return requestJson(new URL(response.headers.location, rawUrl).toString(), headers, redirectCount + 1)
          .then(resolve, reject);
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) response.destroy(new Error('업데이트 응답이 너무 큽니다.'));
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub Release 확인 실패 (HTTP ${response.statusCode})`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('GitHub Release 응답을 읽을 수 없습니다.'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('업데이트 확인 시간이 초과되었습니다.')));
    request.on('error', reject);
  });
}

function downloadFile(rawUrl, destination, repository, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('설치 파일 리디렉션이 너무 많습니다.'));
    if (!trustedReleaseUrl(rawUrl, repository, { redirect: redirectCount > 0 })) {
      return reject(new Error('신뢰할 수 없는 설치 파일 주소입니다.'));
    }
    const request = https.get(rawUrl, { timeout: 30000, headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, rawUrl).toString();
        return downloadFile(nextUrl, destination, repository, headers, redirectCount + 1).then(resolve, reject);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`설치 파일 다운로드 실패 (HTTP ${response.statusCode})`));
        return;
      }
      const declaredSize = Number(response.headers['content-length'] || 0);
      if (declaredSize > MAX_INSTALLER_BYTES) {
        response.resume();
        reject(new Error('설치 파일이 허용 크기를 초과했습니다.'));
        return;
      }
      let received = 0;
      const output = fs.createWriteStream(destination, { flags: 'w' });
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_INSTALLER_BYTES) response.destroy(new Error('설치 파일이 허용 크기를 초과했습니다.'));
      });
      response.pipe(output);
      output.on('finish', () => output.close(() => resolve({ bytes: received })));
      output.on('error', reject);
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('설치 파일 다운로드 시간이 초과되었습니다.')));
    request.on('error', reject);
  });
}

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filename);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
    input.on('error', reject);
  });
}

function safeTag(value) {
  return String(value || 'update').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'update';
}

function updaterHeaders(currentVersion, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `JamesPDF-Updater/${currentVersion}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function createUpdateService(options = {}) {
  const currentVersion = String(options.currentVersion || '0.0.0.0');
  const repository = String(options.repository || process.env.JAMEPDF_UPDATE_REPO || DEFAULT_REPOSITORY);
  const assetName = String(options.assetName || process.env.JAMEPDF_UPDATE_ASSET || DEFAULT_ASSET_NAME);
  const token = String(options.token || process.env.JAMEPDF_UPDATE_TOKEN || '');
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, '..'));
  const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  const headers = updaterHeaders(currentVersion, token);
  let cache = null;
  let cachedAt = 0;

  async function check(force = false) {
    if (!force && cache && Date.now() - cachedAt < DEFAULT_CACHE_MS) return cache;
    const release = await requestJson(apiUrl, headers);
    const asset = selectInstallerAsset(release, assetName);
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    cache = {
      configured: true,
      repository,
      currentVersion,
      latestVersion,
      tag: String(release.tag_name || ''),
      name: String(release.name || release.tag_name || ''),
      notes: String(release.body || '').slice(0, 12000),
      publishedAt: release.published_at || '',
      releaseUrl: release.html_url || `https://github.com/${repository}/releases/latest`,
      available: Boolean(asset && isNewerVersion(latestVersion, currentVersion)),
      installable: Boolean(asset?.browser_download_url && asset?.digest?.startsWith('sha256:')),
      asset: asset ? {
        name: asset.name,
        size: Number(asset.size || 0),
        downloadUrl: asset.browser_download_url,
        digest: String(asset.digest || ''),
      } : null,
    };
    cachedAt = Date.now();
    return cache;
  }

  async function prepareInstall() {
    if (process.platform !== 'win32') throw new Error('자동 설치는 Windows에서만 지원합니다.');
    const update = await check(true);
    if (!update.available) throw new Error('설치할 새 버전이 없습니다.');
    if (!update.installable || !update.asset) throw new Error('검증 가능한 SHA-256 설치 파일이 Release에 없습니다.');
    if (!trustedReleaseUrl(update.asset.downloadUrl, repository)) throw new Error('설치 파일 주소가 배포 저장소와 일치하지 않습니다.');

    const updateDir = path.join(os.tmpdir(), 'JamesPDF-Update', safeTag(update.tag));
    fs.mkdirSync(updateDir, { recursive: true });
    const partialPath = path.join(updateDir, `${assetName}.download`);
    const installerPath = path.join(updateDir, assetName);
    fs.rmSync(partialPath, { force: true });
    await downloadFile(update.asset.downloadUrl, partialPath, repository, headers);
    const actualDigest = await sha256File(partialPath);
    const expectedDigest = update.asset.digest.slice('sha256:'.length).toLowerCase();
    if (actualDigest.toLowerCase() !== expectedDigest) {
      fs.rmSync(partialPath, { force: true });
      throw new Error('설치 파일 SHA-256 검증에 실패했습니다.');
    }
    fs.rmSync(installerPath, { force: true });
    fs.renameSync(partialPath, installerPath);
    return { update, installerPath, digest: actualDigest };
  }

  function launchPreparedInstaller(installerPath, serverPid = process.pid) {
    const launcherPath = path.join(appRoot, 'JamePDF.exe');
    if (!fs.existsSync(launcherPath)) throw new Error('업데이트 후 실행할 JamePDF.exe를 찾을 수 없습니다.');
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!fs.existsSync(powershell)) throw new Error('Windows PowerShell을 찾을 수 없습니다.');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `Wait-Process -Id ${Number(serverPid)} -Timeout 30 -ErrorAction SilentlyContinue`,
      `$setup = Start-Process -FilePath '${installerPath.replace(/'/g, "''")}' -ArgumentList @('/SILENT','/SP-','/CLOSEAPPLICATIONS','/NORESTART') -Wait -PassThru`,
      `if ($setup.ExitCode -eq 0) { Start-Process -FilePath '${launcherPath.replace(/'/g, "''")}' -ArgumentList '--no-browser' -WorkingDirectory '${appRoot.replace(/'/g, "''")}' -WindowStyle Hidden }`,
    ].join('\r\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  return { check, prepareInstall, launchPreparedInstaller };
}

module.exports = {
  createUpdateService,
  isNewerVersion,
  selectInstallerAsset,
  trustedReleaseUrl,
  versionParts,
};
