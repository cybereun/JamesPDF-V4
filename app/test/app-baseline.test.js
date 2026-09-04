const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
);
const serverSource = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');

test('the V4.2.2 application baseline is intact', () => {
  assert.equal(packageJson.version, '4.2.2');
  for (const relativePath of [
    'server.js',
    'public/index.html',
    'public/app.js',
    'public/kordoc.html',
    'public/kordoc.js',
  ]) {
    assert.equal(
      fs.existsSync(path.join(appRoot, relativePath)),
      true,
      relativePath + ' must exist',
    );
  }
});

test('core API routes remain present in the baseline', () => {
  for (const route of [
    "app.get('/api/health'",
    "app.post('/api/upload'",
    "app.get('/api/documents'",
    "app.post('/api/documents/:id/open'",
    "app.delete('/api/documents/:id'",
    "app.post('/api/extract/:id'",
    "app.post('/api/pdf/merge'",
    "app.post('/api/pdf/split'",
    "app.post('/api/ai/chat'",
  ]) {
    assert.equal(
      serverSource.includes(route),
      true,
      'missing baseline route: ' + route,
    );
  }
});

test('PDF operations use bounded disk-backed uploads', () => {
  assert.match(serverSource, /const operationUpload = multer\(/);
  assert.match(serverSource, /const MAX_OPERATION_BATCH_BYTES = 500 \* 1024 \* 1024/);
  for (const route of [
    "app.post('/api/pdf/merge', operationUpload.array",
    "app.post('/api/pdf/compress', operationUpload.single",
    "app.post('/api/pdf/encrypt', operationUpload.single",
    "app.post('/api/pdf/organize-pages', operationUpload.single",
  ]) {
    assert.equal(
      serverSource.includes(route),
      true,
      'disk-backed operation upload missing: ' + route,
    );
  }
});

test('PDF operations expose queued progress, cancellation, retry, and result APIs', () => {
  for (const route of [
    "app.get('/api/jobs/:id'",
    "app.post('/api/jobs/:id/cancel'",
    "app.post('/api/jobs/:id/retry'",
    "app.get('/api/jobs/:id/result'",
  ]) {
    assert.equal(
      serverSource.includes(route),
      true,
      'missing operation job route: ' + route,
    );
  }
  assert.match(serverSource, /function queuedOperationRoute\(/);
  assert.match(serverSource, /x-jamepdf-async/);
  assert.match(serverSource, /function updateOperationProgress\(/);
  assert.match(serverSource, /function parsePageOrder\(/);
});

test('the main UI exposes operation progress and retry controls', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  assert.match(indexSource, /id="operationProgress"/);
  assert.match(indexSource, /id="cancelOperationBtn"/);
  assert.match(indexSource, /class="commandbar"/);
  assert.match(indexSource, /class="command-button is-primary"/);
  assert.match(appSource, /function monitorPdfJob\(/);
  assert.match(appSource, /function retryPdfOperation\(/);
});

test('page organization previews in the viewer without triggering a download', () => {
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  assert.match(appSource, /function stablePdfFilename\(/);
  assert.match(appSource, /downloadResult: false/);
  assert.match(appSource, /async function monitorPdfJob\(jobId, label, previewPdf, signal, options = \{\}\)/);
  assert.match(appSource, /if \(downloadResult\) downloadBlob\(blob, filename\)/);
  assert.match(appSource, /previewFilename: stablePdfFilename\(state\.currentFilename\)/);
});

test('studio navigation uses native links and is not blocked by health checks', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const kordocSource = fs.readFileSync(path.join(appRoot, 'public/kordoc.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const kordocJsSource = fs.readFileSync(path.join(appRoot, 'public/kordoc.js'), 'utf8');
  assert.match(indexSource, /<a id="aiiStudioBtn"[^>]*href="\/kordoc"/);
  assert.match(kordocSource, /<a id="backToClassicBtn"[^>]*href="\/"/);
  assert.doesNotMatch(appSource, /aiiStudioBtn\.disabled\s*=/);
  assert.doesNotMatch(kordocJsSource, /backToClassicBtn\.addEventListener\(['"]click['"]/);
});

test('James Studio follows the Classic PDF shell and ribbon layout', () => {
  const kordocSource = fs.readFileSync(path.join(appRoot, 'public/kordoc.html'), 'utf8');
  const kordocCssSource = fs.readFileSync(path.join(appRoot, 'public/kordoc.css'), 'utf8');
  assert.match(kordocSource, /class="studio-commandbar"/);
  assert.match(kordocSource, /class="studio-ribbon"/);
  assert.match(kordocCssSource, /V4\.3 unified studio shell/);
  assert.match(kordocCssSource, /background: #172033/);
});

test('the two studios share document context across navigation', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const kordocSource = fs.readFileSync(path.join(appRoot, 'public/kordoc.js'), 'utf8');
  assert.match(indexSource, /app\.js\?v=20260904-v4\.2\.2-v1/);
  assert.match(appSource, /function syncStudioNavigationContext\(/);
  assert.match(appSource, /function restoreSharedDocumentFromQuery\(/);
  assert.match(appSource, /STUDIO_DOCUMENT_QUERY_KEY/);
  assert.match(kordocSource, /function syncClassicNavigationContext\(/);
  assert.match(kordocSource, /function hydrateSharedDocument\(/);
  assert.match(kordocSource, /new File\(\[blob\]/);
});

test('the fifth-pass workspace exposes a clear document stage', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(appRoot, 'public/style.css'), 'utf8');
  assert.match(indexSource, /class="viewer-toolbar"/);
  assert.match(indexSource, /id="viewerDocumentName"/);
  assert.match(indexSource, /id="viewerPageBadge"/);
  assert.match(indexSource, /id="rightbarToggleBtn"[^>]*class="viewer-tool-button rightbar-toggle"/);
  assert.match(styleSource, /Fifth-pass workspace architecture/);
  assert.match(styleSource, /\.drop-overlay\s*\{[\s\S]*justify-content: center/);
  assert.match(styleSource, /\.viewer\s*\{[\s\S]*grid-template-rows: 58px minmax\(0, 1fr\)/);
  assert.match(appSource, /'viewerDocumentName'/);
  assert.match(appSource, /els\.viewerPageBadge\.textContent = `페이지 \$\{pageLabel\}`/);
});

test('the fifth-pass workspace supports thumbnail sorting and panel resizing', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(appRoot, 'public/style.css'), 'utf8');
  assert.match(indexSource, /id="rightbarResizeHandle"[^>]*role="separator"/);
  assert.match(appSource, /item\.draggable = true/);
  assert.match(appSource, /async function moveDraggedPages\(/);
  assert.match(appSource, /function initRightbarResize\(/);
  assert.match(appSource, /function startRightbarResize\(/);
  assert.match(appSource, /RIGHTBAR_WIDTH_PREF_KEY/);
  assert.match(styleSource, /\.thumb-item\.drop-before::before/);
  assert.match(styleSource, /\.rightbar-resize-handle\s*\{/);
  assert.match(styleSource, /cursor: col-resize/);
});

test('the fifth-pass command layer exposes keyboard help and status feedback', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(appRoot, 'public/style.css'), 'utf8');
  assert.match(indexSource, /id="shortcutsBtn"/);
  assert.match(indexSource, /id="shortcutsDialog"[^>]*role="dialog"/);
  assert.match(indexSource, /id="closeShortcutsDialogBtn"/);
  assert.match(indexSource, /id="operationStatus"[^>]*data-state="neutral"/);
  assert.match(appSource, /function openShortcutsDialog\(/);
  assert.match(appSource, /event\.key === 'PageUp'/);
  assert.match(appSource, /event\.key === 'PageDown'/);
  assert.match(appSource, /function setOperationStatus\(text\)/);
  assert.match(appSource, /els\.operationStatus\.dataset\.state = tone/);
  assert.match(styleSource, /\.shortcut-grid\s*\{/);
  assert.match(styleSource, /#operationStatus\[data-state="success"\]/);
});

test('the fifth-pass operation state surface unifies progress outcomes and retry', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(appRoot, 'public/style.css'), 'utf8');
  assert.match(indexSource, /id="operationStateCard"[^>]*role="status"/);
  assert.match(indexSource, /id="operationStateProgress"/);
  assert.match(indexSource, /id="operationStateAction"/);
  assert.match(appSource, /function showOperationStage\(/);
  assert.match(appSource, /function scheduleOperationStageHide\(/);
  assert.match(appSource, /state\.operationStageState/);
  assert.match(appSource, /showOperationStage\('success'/);
  assert.match(appSource, /showOperationStage\('error'/);
  assert.match(appSource, /showOperationStage\('warning'/);
  assert.match(styleSource, /\.operation-state-card\[data-state="success"\]/);
  assert.match(styleSource, /\.operation-state-card\[data-state="error"\]/);
});

test('the fifth-pass release polish covers accessibility, responsive chrome, and reduced motion', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(appRoot, 'public/style.css'), 'utf8');
  assert.match(indexSource, /id="canvasHost"[^>]*role="region"/);
  assert.match(indexSource, /id="searchInput"[^>]*aria-label="문서 내 검색"/);
  assert.match(indexSource, /id="operationStateCard"[^>]*aria-busy="false"/);
  assert.match(appSource, /sideTabs\.forEach\(\(tab, index\) =>/);
  assert.match(appSource, /shortcutsReturnFocus/);
  assert.match(appSource, /operationStateCard\.setAttribute\('aria-busy'/);
  assert.match(styleSource, /Fifth-pass final release polish/);
  assert.match(styleSource, /@media screen and \(max-width: 1320px\)/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the second-pass desktop redesign keeps contextual tools accessible', () => {
  const indexSource = fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(appRoot, 'public/app.js'), 'utf8');
  for (const context of ['file', 'home', 'view', 'edit', 'convert', 'security', 'ai']) {
    assert.match(indexSource, new RegExp(`data-command-context="${context}"`));
  }
  assert.match(indexSource, /class="panel-tabs" role="tablist"/);
  assert.match(indexSource, /class="drop-open-button"/);
  assert.match(indexSource, /id="ribbonDensityBtn"/);
  assert.match(appSource, /function updateCommandbarContext\(/);
  assert.match(appSource, /function setRibbonCompact\(/);
  assert.match(appSource, /key === 'o'/);
  assert.match(appSource, /key === 's'/);
});
