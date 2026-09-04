const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');

test('server and browser scripts pass Node syntax validation', () => {
  const files = [
    'server.js',
    'public/app.js',
    'public/kordoc.js',
  ];

  for (const relativePath of files) {
    const filePath = path.join(appRoot, relativePath);
    assert.equal(fs.existsSync(filePath), true, relativePath + ' must exist');

    const result = spawnSync(process.execPath, ['--check', filePath], {
      encoding: 'utf8',
    });

    assert.equal(
      result.status,
      0,
      relativePath + ' has a syntax error:\n' + (result.stderr || result.stdout || 'unknown error'),
    );
  }
});
