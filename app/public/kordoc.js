const studioState = {
  parseResult: null,
  selectedFile: null,
  compareResult: null,
  compareFilter: 'all',
  formTemplateFile: null,
  formFields: [],
  runStatus: '대기',
  runStatusMode: '',
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  [
    'studioState',
    'backToClassicBtn',
    'documentInput',
    'documentFileLabel',
    'pageRangeInput',
    'printPreset',
    'removeHeaderFooter',
    'formulaOcr',
    'parseBtn',
    'statusText',
    'metricType',
    'metricBlocks',
    'metricTables',
    'metricImages',
    'downloadMarkdownBtn',
    'downloadJsonBtn',
    'downloadHtmlBtn',
    'markdownOutput',
    'jsonOutput',
    'htmlPreview',
    'structureOutput',
    'imageOutput',
    'recreateFormat',
    'recreateBtn',
    'recreateMarkdown',
    'compareFileA',
    'compareFileB',
    'compareLabelA',
    'compareLabelB',
    'compareBtn',
    'compareOutput',
    'formsBtn',
    'formTemplateInput',
    'formTemplateLabel',
    'fillFormBtn',
    'formValuesJson',
    'formAiProvider',
    'formAiPrompt',
    'formAiBtn',
    'formFillSummary',
    'formsOutput',
    'footerDocumentStatus',
    'footerCountStatus',
    'footerZoomStatus',
    'footerRunStatus',
  ].forEach((id) => { el[id] = document.getElementById(id); });

  bindStudio();
  updateStatusBar();
  refreshIcons();
  loadHealth();
  window.addEventListener('resize', resizeRecreateEditor);
});

function bindStudio() {
  el.backToClassicBtn.addEventListener('click', () => {
    window.location.href = '/';
  });

  el.documentInput.addEventListener('change', () => {
    studioState.selectedFile = el.documentInput.files[0] || null;
    el.documentFileLabel.textContent = studioState.selectedFile ? studioState.selectedFile.name : '문서 선택';
    setStatus('대기');
  });

  el.compareFileA.addEventListener('change', () => {
    el.compareLabelA.textContent = el.compareFileA.files[0]?.name || '문서 A';
  });
  el.compareFileB.addEventListener('change', () => {
    el.compareLabelB.textContent = el.compareFileB.files[0]?.name || '문서 B';
  });

  el.formTemplateInput.addEventListener('change', () => {
    studioState.formTemplateFile = el.formTemplateInput.files[0] || null;
    el.formTemplateLabel.textContent = studioState.formTemplateFile ? studioState.formTemplateFile.name : 'HWPX 양식 템플릿';
    studioState.formFields = [];
    el.formValuesJson.value = '';
    el.formsOutput.innerHTML = '<div class="status-line">필드 감지 대기</div>';
    el.formFillSummary.textContent = studioState.formTemplateFile ? '필드 감지 대기' : '템플릿을 선택하고 필드를 감지하세요.';
    if (studioState.formTemplateFile) extractForms();
  });

  el.parseBtn.addEventListener('click', parseDocument);
  el.recreateBtn.addEventListener('click', recreateDocument);
  el.recreateMarkdown.addEventListener('input', resizeRecreateEditor);
  el.compareBtn.addEventListener('click', compareDocuments);
  el.compareOutput.addEventListener('click', (event) => {
    const button = event.target.closest('[data-compare-filter]');
    if (!button || !studioState.compareResult) return;
    studioState.compareFilter = button.dataset.compareFilter || 'all';
    renderCompareResult(studioState.compareResult);
  });
  el.formsBtn.addEventListener('click', extractForms);
  el.fillFormBtn.addEventListener('click', fillDetectedForm);
  el.formAiBtn.addEventListener('click', draftFormValuesWithAi);
  el.formsOutput.addEventListener('input', (event) => {
    if (event.target.matches('[data-form-value]')) updateFormValuesJsonFromInputs();
  });
  el.formValuesJson.addEventListener('change', () => applyValuesJsonToInputs());

  el.downloadMarkdownBtn.addEventListener('click', () => downloadResult('markdown'));
  el.downloadJsonBtn.addEventListener('click', () => downloadResult('json'));
  el.downloadHtmlBtn.addEventListener('click', () => downloadResult('html'));

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  document.querySelectorAll('[data-result-tab]').forEach((button) => {
    button.addEventListener('click', () => setResultTab(button.dataset.resultTab));
  });
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setStatus(message, mode = '') {
  el.statusText.textContent = message;
  el.statusText.classList.toggle('is-error', mode === 'error');
  el.statusText.classList.toggle('is-ok', mode === 'ok');
  studioState.runStatus = message || '대기';
  studioState.runStatusMode = mode;
  updateStatusBar();
}

function updateStatusBar() {
  if (!el.footerDocumentStatus) return;
  const resultMatchesSelectedFile = studioState.parseResult
    && (!studioState.selectedFile || studioState.parseResult.originalName === studioState.selectedFile.name);
  const documentName = studioState.selectedFile?.name || studioState.parseResult?.originalName || '문서 없음';
  const result = resultMatchesSelectedFile ? studioState.parseResult : null;
  const summary = result?.blockSummary || {};
  const blockCount = Number(summary.total || 0);
  const pageCount = Number(
    result?.metadata?.pageCount
      || result?.json?.metadata?.pageCount
      || result?.json?.pageCount
      || result?.json?.['number of pages']
      || 0,
  );
  el.footerDocumentStatus.textContent = documentName;
  el.footerDocumentStatus.title = documentName;
  el.footerCountStatus.textContent = `${blockCount} / ${pageCount || blockCount || 0}`;
  el.footerZoomStatus.textContent = '100%';
  el.footerRunStatus.textContent = studioState.runStatus || '대기';
  el.footerRunStatus.title = studioState.runStatus || '대기';
  el.footerRunStatus.classList.toggle('is-error', studioState.runStatusMode === 'error');
  el.footerRunStatus.classList.toggle('is-ok', studioState.runStatusMode === 'ok');
}

function setView(id) {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === id);
  });
  document.querySelectorAll('.studio-view').forEach((view) => {
    view.classList.toggle('is-active', view.id === id);
  });
  if (id === 'recreateView') requestAnimationFrame(resizeRecreateEditor);
}

function setResultTab(id) {
  document.querySelectorAll('[data-result-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.resultTab === id);
  });
  document.querySelectorAll('.result-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === id);
  });
}

async function loadHealth() {
  try {
    const health = await requestJson('/api/kordoc/health');
    el.studioState.textContent = `${health.version} | ${health.exports.join(', ')}`;
  } catch (error) {
    el.studioState.textContent = 'Kordoc 연결 실패';
    setStatus(error.message, 'error');
  }
}

function buildOptionsForm(file) {
  const form = new FormData();
  form.append('file', file);
  if (el.pageRangeInput.value.trim()) form.append('pages', el.pageRangeInput.value.trim());
  form.append('preset', el.printPreset.value || 'default');
  form.append('removeHeaderFooter', el.removeHeaderFooter.checked ? 'true' : 'false');
  form.append('formulaOcr', el.formulaOcr.checked ? 'true' : 'false');
  return form;
}

async function parseDocument() {
  const file = studioState.selectedFile;
  if (!file) {
    setStatus('문서를 선택하세요.', 'error');
    return;
  }
  setStatus('분석 중');
  el.parseBtn.disabled = true;
  try {
    const result = await requestJson('/api/kordoc/parse', {
      method: 'POST',
      body: buildOptionsForm(file),
    });
    if (!result.success) {
      throw new Error(result.json?.error || '문서 분석에 실패했습니다.');
    }
    studioState.parseResult = result;
    renderParseResult(result);
    setStatus('분석 완료', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    el.parseBtn.disabled = false;
  }
}

function renderParseResult(result) {
  const summary = result.blockSummary || {};
  el.metricType.textContent = result.fileType || '-';
  el.metricBlocks.textContent = String(summary.total || 0);
  el.metricTables.textContent = String(summary.table || 0);
  el.metricImages.textContent = String(result.images?.length || summary.image || 0);
  el.markdownOutput.value = result.markdown || '';
  el.recreateMarkdown.value = result.markdown || '';
  resizeRecreateEditor();
  el.jsonOutput.value = JSON.stringify(result.json || {}, null, 2);
  el.htmlPreview.srcdoc = result.html || '';
  renderStructure(result.json?.blocks || []);
  renderImages(result.images || []);
  updateStatusBar();
}

function resizeRecreateEditor() {
  if (!el.recreateMarkdown) return;
  const maxHeight = Math.max(180, window.innerHeight - 190);
  el.recreateMarkdown.style.height = 'auto';
  const nextHeight = Math.min(Math.max(el.recreateMarkdown.scrollHeight + 2, 160), maxHeight);
  el.recreateMarkdown.style.height = `${nextHeight}px`;
}

function renderStructure(blocks) {
  const rows = [];
  const visit = (items, depth = 0) => {
    (items || []).forEach((block, index) => {
      rows.push({
        index: rows.length + 1,
        depth,
        type: block.type || '',
        page: block.pageNumber || '',
        text: block.text || tableSummary(block.table) || '',
      });
      if (Array.isArray(block.children)) visit(block.children, depth + 1);
    });
  };
  visit(blocks);
  if (!rows.length) {
    el.structureOutput.innerHTML = '<div class="status-line">구조 블록 없음</div>';
    return;
  }
  el.structureOutput.innerHTML = `<table>
    <thead><tr><th>#</th><th>Type</th><th>Page</th><th>Text</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${row.index}</td><td>${escapeHtml(`${'· '.repeat(row.depth)}${row.type}`)}</td><td>${escapeHtml(row.page)}</td><td>${escapeHtml(row.text).slice(0, 500)}</td></tr>`).join('')}</tbody>
  </table>`;
}

function renderImages(images) {
  if (!images.length) {
    el.imageOutput.innerHTML = '<div class="status-line">이미지 없음</div>';
    return;
  }
  el.imageOutput.innerHTML = images.map((image) => `
    <a href="${image.url}" target="_blank" rel="noreferrer">
      <strong>${escapeHtml(image.filename)}</strong>
      <span>${escapeHtml(image.mimeType)} | ${formatBytes(image.bytes)}</span>
    </a>
  `).join('');
}

async function recreateDocument() {
  const markdown = el.recreateMarkdown.value;
  if (!markdown.trim()) {
    setStatus('재생성할 Markdown이 없습니다.', 'error');
    return;
  }
  const format = el.recreateFormat.value || 'hwpx';
  setStatus(`${format.toUpperCase()} 생성 중`);
  el.recreateBtn.disabled = true;
  try {
    const response = await fetch('/api/kordoc/recreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown,
        format,
        preset: el.printPreset.value || 'default',
        filename: studioState.parseResult?.originalName || 'aii-in-one-output',
        sourceId: studioState.parseResult?.id || '',
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    downloadBlob(blob, filenameFromResponse(response) || `aii-in-one-output.${format}`);
    setStatus('재생성 완료', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    el.recreateBtn.disabled = false;
  }
}

async function compareDocumentsJsonDebug() {
  const a = el.compareFileA.files[0];
  const b = el.compareFileB.files[0];
  if (!a || !b) {
    el.compareOutput.textContent = '문서 A와 B를 선택하세요.';
    setStatus('문서 A와 B를 선택하세요.', 'error');
    return;
  }
  el.compareBtn.disabled = true;
  el.compareOutput.textContent = '비교 중';
  setStatus('비교 중');
  try {
    const form = new FormData();
    form.append('files', a);
    form.append('files', b);
    if (el.pageRangeInput.value.trim()) form.append('pages', el.pageRangeInput.value.trim());
    const diff = await requestJson('/api/kordoc/compare', { method: 'POST', body: form });
    el.compareOutput.textContent = JSON.stringify(diff, null, 2);
    setStatus('비교 완료', 'ok');
  } catch (error) {
    el.compareOutput.textContent = error.message;
    setStatus(error.message, 'error');
  } finally {
    el.compareBtn.disabled = false;
  }
}

async function compareDocuments() {
  const a = el.compareFileA.files[0];
  const b = el.compareFileB.files[0];
  if (!a || !b) {
    renderCompareMessage('문서 A와 B를 선택하세요.', '비교할 두 문서를 모두 선택해야 합니다.');
    setStatus('문서 A와 B를 선택하세요.', 'error');
    return;
  }
  el.compareBtn.disabled = true;
  renderCompareMessage('비교 중입니다.', '문서 구조를 분석하고 변경점을 계산하고 있습니다.');
  setStatus('비교 중');
  try {
    const form = new FormData();
    form.append('files', a);
    form.append('files', b);
    if (el.pageRangeInput.value.trim()) form.append('pages', el.pageRangeInput.value.trim());
    const diff = await requestJson('/api/kordoc/compare', { method: 'POST', body: form });
    studioState.compareResult = diff;
    studioState.compareFilter = 'all';
    renderCompareResult(diff);
    setStatus('비교 완료', 'ok');
  } catch (error) {
    renderCompareMessage('비교 실패', error.message, true);
    setStatus(error.message, 'error');
  } finally {
    el.compareBtn.disabled = false;
  }
}

function renderCompareMessage(title, detail = '', isError = false) {
  el.compareOutput.innerHTML = `
    <div class="compare-message${isError ? ' status-line is-error' : ''}">
      <strong>${escapeHtml(title)}</strong>
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
    </div>`;
}

function renderCompareResult(diff) {
  const items = compareItems(diff);
  const stats = compareStats(diff, items);
  const filter = studioState.compareFilter || 'all';
  const filteredItems = filter === 'all'
    ? items
    : items.filter((item) => compareType(item) === filter);
  const filterButtons = [
    ['all', '전체', items.length],
    ['added', '추가', stats.added],
    ['removed', '삭제', stats.removed],
    ['modified', '변경', stats.modified],
    ['unchanged', '동일', stats.unchanged],
  ];

  el.compareOutput.innerHTML = `
    <div class="compare-summary">
      ${compareStatCard('전체', stats.total)}
      ${compareStatCard('추가', stats.added)}
      ${compareStatCard('삭제', stats.removed)}
      ${compareStatCard('변경', stats.modified)}
      ${compareStatCard('동일', stats.unchanged)}
    </div>
    <div class="compare-filters" aria-label="비교 결과 필터">
      ${filterButtons.map(([key, label, count]) => `
        <button type="button" class="${filter === key ? 'is-active' : ''}" data-compare-filter="${key}">
          ${label} ${count}
        </button>`).join('')}
    </div>
    ${filteredItems.length
      ? `<div class="compare-list">${filteredItems.map((item, index) => renderCompareItem(item, index)).join('')}</div>`
      : '<div class="compare-empty"><strong>표시할 변경점이 없습니다.</strong><span>다른 필터를 선택하거나 문서를 다시 비교하세요.</span></div>'}
    <details class="compare-raw">
      <summary>원본 JSON 보기</summary>
      <pre>${escapeHtml(JSON.stringify(diff || {}, null, 2))}</pre>
    </details>`;
}

function compareStatCard(label, value) {
  return `<div class="compare-stat"><span>${escapeHtml(label)}</span><strong>${Number(value) || 0}</strong></div>`;
}

function compareItems(diff) {
  if (Array.isArray(diff)) return diff;
  return diff?.diffs || diff?.changes || diff?.items || diff?.results || [];
}

function compareStats(diff, items) {
  const raw = diff?.stats || diff?.summary || {};
  const counts = {
    added: Number(raw.added || raw.add || raw.inserted || 0),
    removed: Number(raw.removed || raw.remove || raw.deleted || 0),
    modified: Number(raw.modified || raw.changed || raw.updated || 0),
    unchanged: Number(raw.unchanged || raw.same || raw.equal || 0),
  };
  if (!Object.values(counts).some(Boolean)) {
    items.forEach((item) => {
      const type = compareType(item);
      if (counts[type] !== undefined) counts[type] += 1;
    });
  }
  counts.total = counts.added + counts.removed + counts.modified + counts.unchanged;
  return counts;
}

function compareType(item) {
  const raw = String(item?.type || item?.status || item?.changeType || '').toLowerCase();
  if (['add', 'added', 'insert', 'inserted', 'new'].includes(raw)) return 'added';
  if (['remove', 'removed', 'delete', 'deleted', 'missing'].includes(raw)) return 'removed';
  if (['modify', 'modified', 'change', 'changed', 'update', 'updated'].includes(raw)) return 'modified';
  if (['same', 'equal', 'unchanged'].includes(raw)) return 'unchanged';
  if (item?.before && !item?.after) return 'removed';
  if (!item?.before && item?.after) return 'added';
  if (item?.before && item?.after) return 'modified';
  return 'modified';
}

function compareTypeLabel(type) {
  return {
    added: '추가',
    removed: '삭제',
    modified: '변경',
    unchanged: '동일',
  }[type] || '변경';
}

function renderCompareItem(item, index) {
  const type = compareType(item);
  const before = item?.before || null;
  const after = item?.after || null;
  const blockType = blockTypeLabel(after || before || item);
  const page = after?.pageNumber || before?.pageNumber || item?.pageNumber || item?.page || '';
  const similarity = Number.isFinite(Number(item?.similarity))
    ? `유사도 ${Math.round(Number(item.similarity) * 100)}%`
    : '';
  const meta = [page ? `페이지 ${page}` : '', similarity].filter(Boolean).join(' · ');
  return `
    <article class="compare-card">
      <div class="compare-card-header">
        <span class="diff-badge ${type}">${compareTypeLabel(type)}</span>
        <div class="compare-card-title">#${index + 1} ${escapeHtml(blockType)}</div>
        <div class="compare-meta">${escapeHtml(meta)}</div>
      </div>
      <div class="compare-card-body">
        <section class="compare-side">
          <h3>문서 A</h3>
          ${renderCompareBlock(before, item, 'before')}
        </section>
        <section class="compare-side">
          <h3>문서 B</h3>
          ${renderCompareBlock(after, item, 'after')}
        </section>
      </div>
    </article>`;
}

function renderCompareBlock(block, diffItem, side) {
  if (!block) return '<pre class="compare-text">-</pre>';
  if (block.table) return renderCompareTable(block.table, diffItem?.cellDiffs || [], side);
  const text = blockText(block);
  return `<pre class="compare-text">${escapeHtml(text || JSON.stringify(block, null, 2))}</pre>`;
}

function renderCompareTable(table, cellDiffs, side) {
  const rows = Array.isArray(table?.cells) ? table.cells : [];
  if (!rows.length) return `<pre class="compare-text">${escapeHtml(tableSummary(table))}</pre>`;
  return `
    <div class="compare-table-wrap">
      <table class="compare-table">
        <tbody>
          ${rows.map((row, rowIndex) => `<tr>${(row || []).map((cell, colIndex) => {
            const normalizedCell = typeof cell === 'object' && cell ? cell : { text: cell };
            const cellDiff = cellDiffs?.[rowIndex]?.[colIndex] || {};
            const cellType = compareType(cellDiff);
            const changed = cellDiff?.type && cellType !== 'unchanged';
            const sideText = side === 'before'
              ? (cellDiff.before ?? normalizedCell.text ?? '')
              : (cellDiff.after ?? normalizedCell.text ?? '');
            return `<td class="${changed ? `is-${cellType}` : ''}" colspan="${Number(normalizedCell.colSpan) || 1}" rowspan="${Number(normalizedCell.rowSpan) || 1}">${escapeHtml(sideText)}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function blockText(block) {
  if (!block || typeof block !== 'object') return String(block || '');
  return block.text || block.content || block.value || block.markdown || block.caption || block.description || '';
}

function blockTypeLabel(block) {
  const type = String(block?.type || block?.kind || '').toLowerCase();
  return {
    paragraph: '문단',
    heading: '제목',
    table: '표',
    image: '이미지',
    list: '목록',
    form: '양식',
  }[type] || type || '블록';
}

async function extractForms() {
  const file = studioState.selectedFile;
  if (!file) {
    el.formsOutput.innerHTML = '<div class="status-line is-error">문서를 선택하세요.</div>';
    setStatus('문서를 선택하세요.', 'error');
    return;
  }
  el.formsBtn.disabled = true;
  el.formsOutput.innerHTML = '<div class="status-line">추출 중</div>';
  setStatus('양식 필드 추출 중');
  try {
    const result = await requestJson('/api/kordoc/forms', {
      method: 'POST',
      body: buildOptionsForm(file),
    });
    const fields = result.form?.fields || [];
    if (!fields.length) {
      el.formsOutput.innerHTML = '<div class="status-line">양식 필드 없음</div>';
      setStatus('양식 필드 없음', 'ok');
      return;
    }
    el.formsOutput.innerHTML = `<table>
      <thead><tr><th>Label</th><th>Value</th><th>Row</th><th>Col</th></tr></thead>
      <tbody>${fields.map((field) => `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(field.value)}</td><td>${field.row ?? ''}</td><td>${field.col ?? ''}</td></tr>`).join('')}</tbody>
    </table>`;
    setStatus(`양식 필드 ${fields.length}개 추출`, 'ok');
  } catch (error) {
    el.formsOutput.innerHTML = `<div class="status-line is-error">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, 'error');
  } finally {
    el.formsBtn.disabled = false;
  }
}

async function extractForms() {
  const file = studioState.formTemplateFile;
  if (!file) {
    el.formsOutput.innerHTML = '<div class="status-line is-error">HWPX 양식 템플릿을 선택하세요.</div>';
    el.formFillSummary.textContent = '템플릿이 필요합니다.';
    setStatus('HWPX 양식 템플릿을 선택하세요.', 'error');
    return;
  }
  el.formsBtn.disabled = true;
  el.formsOutput.innerHTML = '<div class="status-line">필드 감지 중</div>';
  el.formFillSummary.textContent = '필드 감지 중';
  setStatus('양식 필드 감지 중');
  try {
    const form = new FormData();
    form.append('file', file);
    const result = await requestJson('/api/kordoc/forms', { method: 'POST', body: form });
    const fields = result.form?.fields || [];
    studioState.formFields = fields;
    renderFormFields(fields, result.valuesTemplate || {});
    setStatus(`양식 필드 ${fields.length}개 감지`, 'ok');
  } catch (error) {
    studioState.formFields = [];
    el.formsOutput.innerHTML = `<div class="status-line is-error">${escapeHtml(error.message)}</div>`;
    el.formFillSummary.textContent = '필드 감지 실패';
    setStatus(error.message, 'error');
  } finally {
    el.formsBtn.disabled = false;
  }
}

function renderFormFields(fields, values = {}) {
  if (!fields.length) {
    el.formsOutput.innerHTML = '<div class="status-line">감지된 양식 필드가 없습니다. 표의 라벨-빈칸 구조를 확인하세요.</div>';
    el.formValuesJson.value = '{}';
    el.formFillSummary.textContent = '감지된 필드 없음';
    return;
  }
  const labelCounts = new Map();
  const keyedFields = [];
  fields.forEach((field) => {
    const label = String(field.label || '').trim();
    if (!label) return;
    const occurrence = Number(field.occurrence || 0) || ((labelCounts.get(label) || 0) + 1);
    labelCounts.set(label, occurrence);
    const valueKey = String(field.valueKey || (occurrence > 1 ? `${label} ${occurrence}` : label)).trim();
    keyedFields.push({ ...field, label, occurrence, valueKey });
  });
  const deduped = keyedFields;
  studioState.formFields = keyedFields;
  el.formsOutput.innerHTML = `<table class="form-fields-table">
    <thead><tr><th>#</th><th>필드명</th><th>현재값</th><th>입력값</th><th>위치</th></tr></thead>
    <tbody>${keyedFields.map((field, index) => {
      const value = values[field.valueKey] ?? values[field.label] ?? '';
      const pos = Number(field.row) >= 0 ? `행 ${Number(field.row) + 1}, 열 ${Number(field.col) + 1}` : '본문';
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(field.label)}</strong>${field.occurrence > 1 ? ` <span class="muted">#${field.occurrence}</span>` : ''}</td>
        <td>${escapeHtml(field.value || '')}</td>
        <td><input data-form-value data-label="${escapeHtml(field.label)}" value="${escapeHtml(value)}" placeholder="채울 값"></td>
        <td>${escapeHtml(pos)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
  el.formsOutput.querySelectorAll('[data-form-value]').forEach((input, index) => {
    input.dataset.valueKey = keyedFields[index]?.valueKey || input.dataset.label || '';
  });
  updateFormValuesJsonFromInputs();
  el.formFillSummary.textContent = `필드 ${deduped.length}개 감지됨`;
}

function updateFormValuesJsonFromInputs() {
  const values = {};
  el.formsOutput.querySelectorAll('[data-form-value]').forEach((input) => {
    const key = input.dataset.valueKey || input.dataset.label || '';
    values[key] = input.value || '';
  });
  el.formValuesJson.value = JSON.stringify(values, null, 2);
}

function applyValuesJsonToInputs() {
  const values = parseFormValuesText(el.formValuesJson.value);
  el.formsOutput.querySelectorAll('[data-form-value]').forEach((input) => {
    const key = input.dataset.valueKey || input.dataset.label || '';
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      input.value = values[key] ?? '';
    } else if (Object.prototype.hasOwnProperty.call(values, input.dataset.label)) {
      input.value = values[input.dataset.label] ?? '';
    }
  });
}

function parseFormValuesText(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return normalizeFormValues(parsed);
  } catch {
    try {
      return normalizeFormValues(JSON.parse(`[${raw.replace(/}\s*{/g, '},{')}]`));
    } catch {}
    const values = {};
    raw.split(/\r?\n|,/).forEach((line) => {
      const match = String(line).match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
      if (match && match[1].trim()) {
        const key = match[1].trim().replace(/^["']|["']$/g, '');
        const value = match[2].trim().replace(/^["']|["']?[,]?$/g, '');
        values[key] = value;
      }
    });
    return values;
  }
}

function normalizeFormValues(parsed) {
  const entries = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((row, rowIndex) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      Object.entries(row).forEach(([key, value]) => {
        entries.push([rowIndex > 0 ? `${key} ${rowIndex + 1}` : key, value]);
      });
    });
  } else {
    Object.entries(parsed).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => entries.push([index > 0 ? `${key} ${index + 1}` : key, item]));
      } else {
        entries.push([key, value]);
      }
    });
  }
  return Object.fromEntries(entries.map(([key, value]) => [String(key), String(value ?? '')]));
}

async function fillDetectedForm() {
  const file = studioState.formTemplateFile;
  if (!file) {
    setStatus('HWPX 양식 템플릿을 선택하세요.', 'error');
    return;
  }
  applyValuesJsonToInputs();
  const values = parseFormValuesText(el.formValuesJson.value);
  const nonEmptyValues = Object.fromEntries(Object.entries(values).filter(([, value]) => String(value || '').trim()));
  if (!Object.keys(nonEmptyValues).length) {
    setStatus('채울 값을 입력하세요.', 'error');
    el.formFillSummary.textContent = '채울 값이 없습니다.';
    return;
  }
  el.fillFormBtn.disabled = true;
  el.formFillSummary.textContent = '원본 서식 보존 저장 중';
  setStatus('양식 자동 채우기 중');
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('format', 'hwpx-preserve');
    form.append('valuesJson', JSON.stringify(nonEmptyValues));
    const result = await requestJson('/api/kordoc/forms/fill', { method: 'POST', body: form });
    const filled = result.filled?.length || 0;
    const unmatched = result.unmatched?.length || 0;
    const savedPath = result.savedPath ? `<span class="muted">저장 위치: ${escapeHtml(result.savedPath)}</span>` : '';
    el.formFillSummary.innerHTML = `채움 ${filled}개 · 미매칭 ${unmatched}개 <a class="form-download-link" href="${result.download}" download="${escapeHtml(result.filename || 'filled.hwpx')}">다운로드</a> ${savedPath}`;
    if (result.download) {
      const response = await fetch(result.download);
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      downloadBlob(blob, result.filename || 'filled.hwpx');
    }
    setStatus(`양식 채우기 완료: ${filled}개`, 'ok');
  } catch (error) {
    el.formFillSummary.textContent = '자동 채우기 실패';
    setStatus(error.message, 'error');
  } finally {
    el.fillFormBtn.disabled = false;
  }
}

async function draftFormValuesWithAi() {
  const prompt = el.formAiPrompt.value.trim();
  if (!prompt) {
    setStatus('AI에 전달할 값을 설명하세요.', 'error');
    return;
  }
  const labels = studioState.formFields.map((field) => field.valueKey || field.label).filter(Boolean);
  if (!labels.length) {
    setStatus('먼저 필드를 감지하세요.', 'error');
    return;
  }
  el.formAiBtn.disabled = true;
  setStatus('AI 값 초안 생성 중');
  try {
    const aiPrompt = [
      '다음 HWPX 공문서 양식 필드에 채울 값을 JSON 객체로만 작성하세요.',
      '설명, 코드블록, 마크다운 없이 JSON만 출력하세요.',
      `필드 목록: ${labels.join(', ')}`,
      `사용자 설명: ${prompt}`,
    ].join('\n');
    const result = await requestJson('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: el.formAiProvider.value || 'codex', prompt: aiPrompt }),
    });
    const values = extractJsonObject(result.output || '');
    if (!Object.keys(values).length) throw new Error('AI 응답에서 JSON 값을 찾지 못했습니다.');
    const current = parseFormValuesText(el.formValuesJson.value);
    el.formValuesJson.value = JSON.stringify({ ...current, ...values }, null, 2);
    applyValuesJsonToInputs();
    setStatus('AI 값 초안 적용 완료', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    el.formAiBtn.disabled = false;
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function downloadResult(type) {
  if (!studioState.parseResult?.downloads?.[type]) {
    setStatus('다운로드할 결과가 없습니다.', 'error');
    return;
  }
  window.location.href = studioState.parseResult.downloads[type];
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.error || data.message || JSON.stringify(data);
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function filenameFromResponse(response) {
  const header = response.headers.get('Content-Disposition') || '';
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = header.match(/filename="?([^"]+)"?/i);
  return plain ? plain[1] : '';
}

function tableSummary(table) {
  if (!table) return '';
  return `${table.rows || 0}x${table.cols || 0} table`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
