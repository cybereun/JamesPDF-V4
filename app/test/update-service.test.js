const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isNewerVersion,
  selectInstallerAsset,
  trustedReleaseUrl,
  versionParts,
} = require('../update-service');

test('four-part James PDF versions are compared numerically', () => {
  assert.deepEqual(versionParts('v4.2.0.1'), [4, 2, 0, 1]);
  assert.equal(isNewerVersion('v4.2.0.1', '4.2.0.0'), true);
  assert.equal(isNewerVersion('4.10.0.0', '4.2.9.9'), true);
  assert.equal(isNewerVersion('4.2.0.0', '4.2.0.0'), false);
  assert.equal(isNewerVersion('4.1.9.9', '4.2.0.0'), false);
  assert.equal(isNewerVersion('not-a-version', '4.2.0.0'), false);
});

test('only the exact uploaded installer asset is selected', () => {
  const release = {
    assets: [
      { name: 'other.exe', state: 'uploaded' },
      { name: 'JamesPDF_Setup.exe', state: 'new' },
      { name: 'JamesPDF_Setup.exe', state: 'uploaded', digest: 'sha256:abc' },
    ],
  };
  assert.equal(selectInstallerAsset(release)?.digest, 'sha256:abc');
  assert.equal(selectInstallerAsset(release, 'missing.exe'), null);
});

test('release downloads are restricted to the configured GitHub repository', () => {
  const repo = 'cybereun/JamesPDF-V4';
  assert.equal(trustedReleaseUrl(
    'https://github.com/cybereun/JamesPDF-V4/releases/download/v4.2.0.1/JamesPDF_Setup.exe',
    repo,
  ), true);
  assert.equal(trustedReleaseUrl(
    'https://github.com/attacker/JamesPDF-V4/releases/download/v9/JamesPDF_Setup.exe',
    repo,
  ), false);
  assert.equal(trustedReleaseUrl('http://github.com/cybereun/JamesPDF-V4/releases/download/v1/a.exe', repo), false);
  assert.equal(trustedReleaseUrl('https://release-assets.githubusercontent.com/file', repo, { redirect: true }), true);
});
