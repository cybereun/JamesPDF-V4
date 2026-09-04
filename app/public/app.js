const state = {
  document: null,
  currentBlob: null,
  currentFilename: '',
  pdf: null,
  page: 1,
  pageCount: 0,
  scale: 1.2,
  pageText: '',
  selectedPages: new Set(),
  undoStack: [],
  redoStack: [],
  historyBusy: false,
  documentDirty: false,
  lastPdfUrl: '',
  saveHandle: null,
  saveToken: '',
  editModeActive: false,
  editTool: 'select',
  annotations: [],
  activeAnnotationId: null,
  extractedJson: null,
  extractedMarkdown: '',
  isExtracting: false,
  searchKeyword: '',
  searchResults: [],
  searchActiveIndex: -1,
  rightbarCollapsed: false,
  rightbarWidth: 372,
  ribbonCompact: false,
  aiProviders: {},
  aiAbortController: null,
  aiModelSelections: {},
  availableUpdate: null,
  updateInstalling: false,
  recentDocuments: [],
  recentDocumentsQuery: '',
  pdfOperationAbortController: null,
  pdfOperationJobId: '',
  lastFailedPdfOperation: null,
  operationStageState: 'idle',
  operationStageTimer: null,
  pdfOperationLabel: '',
  shortcutsReturnFocus: null,
  thumbnailDrag: null,
  suppressThumbnailClick: false,
};

const els = {};

const RIBBON_TAB_TO_PANEL = {
  home: 'extractPanel',
  edit: 'editPanel',
  convert: 'convertPanel',
  security: 'securityPanel',
  ai: 'aiPanel',
};

const PANEL_TO_RIBBON_TAB = {
  extractPanel: 'home',
  editPanel: 'edit',
  pagePanel: 'edit',
  convertPanel: 'convert',
  securityPanel: 'security',
  aiPanel: 'ai',
};

const AI_MODEL_PRESETS = {
  codex: [
    { value: 'codex-auto', label: 'Codex Auto', note: 'Recommended' },
    { value: 'gpt-5-codex', label: 'GPT-5 Codex', note: 'Coding' },
    { value: 'gpt-5-high', label: 'GPT-5 High', note: 'Deep' },
    { value: 'gpt-5-medium', label: 'GPT-5 Medium', note: 'Balanced' },
  ],
  antigravity: [
    { value: 'gemini-3.5-flash-medium', label: 'Gemini 3.5 Flash (Medium)', note: 'Fast' },
    { value: 'gemini-3.5-flash-high', label: 'Gemini 3.5 Flash (High)', note: 'Fast' },
    { value: 'gemini-3.5-flash-low', label: 'Gemini 3.5 Flash (Low)', note: 'Fast' },
    { value: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { value: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { value: 'claude-sonnet-4.6-thinking', label: 'Claude Sonnet 4.6 (Thinking)' },
    { value: 'claude-opus-4.6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
    { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ],
  claude: [
    { value: 'claude-auto', label: 'Claude Auto', note: 'Recommended' },
    { value: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
    { value: 'claude-haiku', label: 'Claude Haiku', note: 'Fast' },
  ],
};

const RIGHTBAR_PREF_KEY = 'jamepdf:rightbarCollapsed';
const RIGHTBAR_WIDTH_PREF_KEY = 'jamepdf:rightbarWidth';
const RIGHTBAR_DEFAULT_WIDTH = 372;
const RIGHTBAR_MIN_WIDTH = 300;
const RIGHTBAR_MAX_WIDTH = 560;
const RIGHTBAR_LABEL_HIDE = '\uc624\ub978\ucabd \ud328\ub110 \uc228\uae30\uae30';
const RIGHTBAR_LABEL_SHOW = '\uc624\ub978\ucabd \ud328\ub110 \ubcf4\uc774\uae30';
const RIBBON_DENSITY_PREF_KEY = 'jamepdf:ribbonCompact';
const DOCUMENT_VIEW_PREF_KEY = 'jamepdf:documentViewState';
const STUDIO_DOCUMENT_QUERY_KEY = 'documentId';
const REMOVE_DOCUMENT_ON_CLOSE = false;

const COMMAND_CONTEXT_META = {
  file: { title: '\ud30c\uc77c', note: '\ubb38\uc11c\ub97c \uc5f4\uace0 \uc800\uc7a5\ud569\ub2c8\ub2e4' },
  home: { title: '\ud648', note: '\ud398\uc774\uc9c0\uc640 \ud14d\uc2a4\ud2b8\ub97c \uad00\ub9ac\ud569\ub2c8\ub2e4' },
  view: { title: '\ubcf4\uae30', note: '\ud398\uc774\uc9c0 \ubc30\uc728\uacfc \ud328\ub110\uc744 \uc870\uc808\ud569\ub2c8\ub2e4' },
  edit: { title: '\ud3b8\uc9d1', note: '\ud14d\uc2a4\ud2b8\uc640 \ud398\uc774\uc9c0\ub97c \uc218\uc815\ud569\ub2c8\ub2e4' },
  convert: { title: '\ubcc0\ud658', note: '\ud30c\uc77c\uc744 \ubcd1\ud569\ud558\uace0 \ubcc0\ud658\ud569\ub2c8\ub2e4' },
  security: { title: '\ubcf4\uc548', note: '\ubb38\uc11c \uc554\ud638\ub97c \uad00\ub9ac\ud569\ub2c8\ub2e4' },
  ai: { title: 'AI', note: 'AI Agent\ub85c \ubb38\uc11c \uc791\uc5c5\uc744 \ub3c4\uc6c0\ubc1b\uc2b5\ub2c8\ub2e4' },
};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  configurePdfJs();
  bindUi();
  renderAiModelOptions();
  initRightbarToggle();
  initRightbarResize();
  initRibbonDensity();
  updateCommandbarContext('file');
  updateHistoryButtons();
  updatePageSelectionUi();
  setDocumentDirty(false);
  syncStudioNavigationContext();
  loadHealth();
  loadDocuments();
  restoreSharedDocumentFromQuery();
  refreshIcons();
  loadSystemFonts();
  setTimeout(() => checkForAppUpdate(), 3500);
  setInterval(() => checkForAppUpdate(), 6 * 60 * 60 * 1000);
});

function cacheElements() {
  [
    'serverState',
    'toolState',
    'aiiStudioBtn',
    'searchInput',
    'openPdfInput',
    'saveCurrentBtn',
    'closePdfBtn',
    'recentDocumentsBtn',
    'prevPageBtn',
    'nextPageBtn',
    'pageNumberInput',
    'pageCountLabel',
    'zoomOutBtn',
    'zoomInBtn',
    'fitWidthBtn',
    'copyPageTextBtn',
    'extractBtn',
    'thumbCount',
    'selectedPageCount',
    'selectAllPagesBtn',
    'deleteSelectedPagesBtn',
    'duplicateSelectedPagesBtn',
    'movePageUpBtn',
    'movePageDownBtn',
    'thumbnailList',
    'dropOverlay',
    'canvasHost',
    'pdfCanvas',
    'printRenderHost',
    'saveDialog',
    'saveCurrentLocationBtn',
    'saveAsBtn',
    'closeSaveDialogBtn',
    'cancelSaveDialogBtn',
    'saveNote',
    'recentDocumentsDialog',
    'recentDocumentsSearch',
    'recentDocumentsList',
    'recentDocumentsCount',
    'closeRecentDocumentsBtn',
    'closeRecentDocumentsBtnFooter',
    'refreshRecentDocumentsBtn',
    'shortcutsBtn',
    'shortcutsDialog',
    'closeShortcutsDialogBtn',
    'closeShortcutsDialogFooterBtn',
    'updateDialog',
    'updateVersionSummary',
    'updateCurrentVersion',
    'updateLatestVersion',
    'updateReleaseNotes',
    'updateProgress',
    'closeUpdateDialogBtn',
    'laterUpdateBtn',
    'viewReleaseBtn',
    'installUpdateBtn',
    'printDialog',
    'printScope',
    'printPages',
    'printPagesPerSheet',
    'printOrientation',
    'printPaper',
    'printMargin',
    'printDuplex',
    'printCopies',
    'printFitMode',
    'printReverse',
    'printBorder',
    'runPrintBtn',
    'downloadPrintBtn',
    'closePrintDialogBtn',
    'cancelPrintDialogBtn',
    'printNote',
    'currentTextOutput',
    'copyCurrentTextBtn',
    'extractMode',
    'extractPages',
    'runExtractBtn',
    'extractNote',
    'markdownOutput',
    'jsonOutput',
    'copyMarkdownBtn',
    'copyJsonBtn',
    'editPage',
    'editFontSize',
    'editX',
    'editY',
    'editColor',
    'editText',
    'applyTextBtn',
    'watermarkText',
    'watermarkSize',
    'watermarkOpacity',
    'watermarkAngle',
    'watermarkPages',
    'watermarkBtn',
    'pageRangeInput',
    'extractPagesBtn',
    'splitPdfBtn',
    'rotateDegrees',
    'rotateBtn',
    'mergeFilesInput',
    'mergeFileLabel',
    'mergeBtn',
    'imageFilesInput',
    'imageFileLabel',
    'imagesToPdfBtn',
    'compressLevel',
    'compressBtn',
    'compressNote',
    'encryptUserPassword',
    'encryptOwnerPassword',
    'encryptBtn',
    'decryptPassword',
    'decryptBtn',
    'securityNote',
    'aiProvider',
    'aiModel',
    'aiConnectionState',
    'aiStatusNote',
    'aiRefreshBtn',
    'aiOutput',
    'aiPrompt',
    'aiSendBtn',
    'aiClearBtn',
    'documentName',
    'viewerDocumentName',
    'viewerDocumentState',
    'documentDirtyState',
    'pageStatus',
    'viewerPageBadge',
    'zoomStatus',
    'viewerZoomBadge',
    'operationStatus',
    'operationStateCard',
    'operationStateIcon',
    'operationStateTitle',
    'operationStateDetail',
    'operationStateProgress',
    'operationStateAction',
    'operationProgress',
    'cancelOperationBtn',
    'toast',
    'toolSelectBtn',
    'toolTextBtn',
    'toolRedactBtn',
    'editFontFamily',
    'editOverlay',
    'floatingFormatToolbar',
    'toolbarFontFamily',
    'toolbarFontSize',
    'toolbarBtnItalic',
    'toolbarBtnUnderline',
    'toolbarBtnStrikethrough',
    'toolbarColor',
    'toolbarBtnDelete',
    'searchWidget',
    'widgetSearchInput',
    'searchWidgetResults',
    'resultsCount',
    'resultsList',
    'widgetSearchPrev',
    'widgetSearchNext',
    'closeSearchWidgetBtn',
    'rightbarToggleBtn',
    'rightbarResizeHandle',
    'ribbonDensityBtn',
    'undoBtn',
    'redoBtn',
    'commandbarContext',
    'commandbarContextTitle',
    'commandbarContextNote',
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

/* 글꼴 이름 → CSS font-family 문자열 변환 헬퍼 */
function fontFamilyToCss(name) {
  const map = {
    'malgun': '"Malgun Gothic", "맑은 고딕", sans-serif',
    'helvetica': 'Arial, Helvetica, sans-serif',
    'courier': 'Courier New, Courier, monospace',
  };
  if (map[name]) return map[name];
  // 시스템 폰트: 그대로 사용
  return `"${name}", sans-serif`;
}

/* 데스크탑 설치 글꼴 목록 로드 (Local Font Access API) */
async function loadSystemFonts() {
  const fallbackFonts = [
    '맑은 고딕', '굴림', '돋움', '바탕', '궁서',
    '나눔고딕', '나눔명조', '나눔바른고딕',
    'Arial', 'Times New Roman', 'Courier New', 'Georgia',
    'Verdana', 'Tahoma', 'Trebuchet MS', 'Comic Sans MS',
    'Impact', 'Consolas', 'Segoe UI',
  ];

  let fontFamilies = [];

  try {
    if ('queryLocalFonts' in window) {
      const fonts = await window.queryLocalFonts();
      const familySet = new Set();
      fonts.forEach(f => familySet.add(f.family));
      fontFamilies = [...familySet].sort((a, b) => a.localeCompare(b, 'ko'));
    }
  } catch (e) {
    // 권한 거부 또는 API 미지원
  }

  if (fontFamilies.length === 0) {
    fontFamilies = fallbackFonts;
  }

  // 드롭다운 채우기 함수
  function populateSelect(selectEl) {
    if (!selectEl) return;
    const currentValue = selectEl.value;
    selectEl.innerHTML = '';
    fontFamilies.forEach(family => {
      const opt = document.createElement('option');
      opt.value = family;
      opt.textContent = family;
      opt.style.fontFamily = `"${family}"`;
      selectEl.appendChild(opt);
    });
    // 기존 선택값 복원 시도
    if (fontFamilies.includes(currentValue)) {
      selectEl.value = currentValue;
    } else if (fontFamilies.includes('맑은 고딕')) {
      selectEl.value = '맑은 고딕';
    } else {
      selectEl.value = fontFamilies[0];
    }
  }

  populateSelect(els.toolbarFontFamily);
  populateSelect(els.editFontFamily);
}

function configurePdfJs() {
  if (!window.pdfjsLib) return;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

const SCIENCE_SUBSCRIPT_MAP = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  x: 'ₓ',
  y: 'ᵧ',
};

const SCIENCE_SUPERSCRIPT_MAP = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
};

const HWP_EQUATION_CHAR_MAP = (() => {
  const map = new Map();
  Array.from('1234567890').forEach((digit, index) => map.set(0xE034 + index, digit));
  Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').forEach((letter, index) => map.set(0xE000 + index, letter));
  Array.from('abcdefghijklmnopqrstuvwxyz').forEach((letter, index) => map.set(0xE0E5 + index, letter));
  Object.entries({
    0xE046: '-',
    0xE047: '=',
    0xE048: '+',
    0xE04D: ',',
    0xE04F: ':',
    0xE053: '.',
    0xE054: '/',
    0xE055: '<',
    0xE056: '>',
    0xE06D: ' ⟦FRAC⟧ ',
  }).forEach(([code, value]) => map.set(Number(code), value));
  return map;
})();

function toScienceSubscript(value) {
  return String(value || '').replace(/[0-9a-z]/g, (char) => SCIENCE_SUBSCRIPT_MAP[char] || char);
}

function toScienceSuperscript(value) {
  return String(value || '').replace(/[0-9+\-−]/g, (char) => SCIENCE_SUPERSCRIPT_MAP[char] || char);
}

function linearFraction(denominator, numerator) {
  const den = String(denominator || '').trim();
  const num = String(numerator || '').trim();
  if (!den || !num) return `${den} ${num}`.trim();
  const simple = /^[A-Za-z0-9₀-₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓᵧ]+$/;
  return `${simple.test(num) ? num : `(${num})`}/${simple.test(den) ? den : `(${den})`}`;
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/[\uE000-\uF8FF]/g, (char) => HWP_EQUATION_CHAR_MAP.get(char.codePointAt(0)) || char)
    .replace(/\uFFFD/g, '□')
    .replace(/\s+/g, ' ')
    .replace(/([0-9])\s*\.\s*([0-9])/g, '$1.$2')
    .replace(/([0-9])\s*℃/g, '$1℃')
    .replace(/\(\s*([a-z])\s+([a-z])\s*\)/g, '($1$2)')
    .replace(/\(\s*([gsl])\s*\)/g, '($1)')
    .replace(/\b(g|mol|M)\s*\/\s*(mL|L|mol)\b/g, '$1/$2')
    .replace(/⟦FRAC⟧\s*([A-Za-z0-9.+\-−₀-₉]+)\s+([A-Za-z0-9.+\-−₀-₉]+)/g, (_, den, num) => linearFraction(den, num))
    .replace(/\b([A-Z][a-z]?)\s+([0-9]+)\s*([+\-−])(?=[\s),.;]|$)/g, (_, element, power, sign) => `${element}${toScienceSuperscript(power)}${toScienceSuperscript(sign)}`)
    .replace(/\b([A-Z][a-z]?)\s*([+\-−])(?=[\s),.;]|$)/g, (_, element, sign) => `${element}${toScienceSuperscript(sign)}`)
    .replace(/\b([A-Z][a-z]?)\s+([0-9]+)\s*([xy])(?=[\sA-Z(,.;]|$)/g, (_, element, digits, variable) => `${element}${toScienceSubscript(`${digits}${variable}`)}`)
    .replace(/\b([A-Z][a-z]?)\s+([0-9]+)(?=\s*[A-Z(,.;]|$)/g, (_, element, digits) => `${element}${toScienceSubscript(digits)}`)
    .replace(/\b([A-Z][a-z]?)([0-9]+)(?=[A-Z(,.;]|$)/g, (_, element, digits) => `${element}${toScienceSubscript(digits)}`)
    .replace(/\b([A-Z][a-z]?)\s+([xy])(?=\s*[A-Z(,.;]|$)/g, (_, element, variable) => `${element}${toScienceSubscript(variable)}`)
    .replace(/([A-Z][a-z]?[₀-₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓᵧ]+)\s+(?=[A-Z][a-z]?)/g, '$1')
    .replace(/\s+([),.;:?!])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SCIENCE_SUBSCRIPT_MAP_V2 = Object.freeze({
  0: '\u2080',
  1: '\u2081',
  2: '\u2082',
  3: '\u2083',
  4: '\u2084',
  5: '\u2085',
  6: '\u2086',
  7: '\u2087',
  8: '\u2088',
  9: '\u2089',
  a: '\u2090',
  e: '\u2091',
  h: '\u2095',
  i: '\u1d62',
  j: '\u2c7c',
  k: '\u2096',
  l: '\u2097',
  m: '\u2098',
  n: '\u2099',
  o: '\u2092',
  p: '\u209a',
  r: '\u1d63',
  s: '\u209b',
  t: '\u209c',
  x: '\u2093',
  y: '\u1d67',
});

const SCIENCE_SUPERSCRIPT_MAP_V2 = Object.freeze({
  0: '\u2070',
  1: '\u00b9',
  2: '\u00b2',
  3: '\u00b3',
  4: '\u2074',
  5: '\u2075',
  6: '\u2076',
  7: '\u2077',
  8: '\u2078',
  9: '\u2079',
  '+': '\u207a',
  '-': '\u207b',
  '\u2212': '\u207b',
});

const HWP_EQUATION_CHAR_MAP_V2 = (() => {
  const map = new Map();
  Array.from('1234567890').forEach((digit, index) => map.set(0xe034 + index, digit));
  Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').forEach((letter, index) => map.set(0xe000 + index, letter));
  Array.from('abcdefghijklmnopqrstuvwxyz').forEach((letter, index) => map.set(0xe0e5 + index, letter));
  Object.entries({
    0xe046: '-',
    0xe047: '=',
    0xe048: '+',
    0xe04d: ',',
    0xe04f: ':',
    0xe053: '.',
    0xe054: '/',
    0xe055: '<',
    0xe056: '>',
    0xe06d: ' __FRAC__ ',
  }).forEach(([code, value]) => map.set(Number(code), value));
  return map;
})();

function toScienceSubscriptV2(value) {
  return String(value || '').replace(/[0-9a-z]/g, (char) => SCIENCE_SUBSCRIPT_MAP_V2[char] || char);
}

function toScienceSuperscriptV2(value) {
  return String(value || '').replace(/[0-9+\-\u2212]/g, (char) => SCIENCE_SUPERSCRIPT_MAP_V2[char] || char);
}

function linearFractionV2(denominator, numerator) {
  const den = String(denominator || '').trim();
  const num = String(numerator || '').trim();
  if (!den || !num) return `${den} ${num}`.trim();

  const needsDenGroup = /^[0-9]+[A-Za-z]/.test(den);
  const needsNumGroup = /[+\-*/]/.test(num);
  const safeDen = needsDenGroup ? `(${den})` : den;
  const safeNum = needsNumGroup ? `(${num})` : num;
  return `${safeNum}/${safeDen}`;
}

function normalizeExtractedTextV2(text) {
  return String(text || '')
    .replace(/[\uE000-\uF8FF]/g, (char) => HWP_EQUATION_CHAR_MAP_V2.get(char.codePointAt(0)) || char)
    .replace(/\uFFFD/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([0-9])\s*\.\s*([0-9])/g, '$1.$2')
    .replace(/([0-9])\s*\u2103/g, '$1\u2103')
    .replace(/\(\s*([a-z])\s+([a-z])\s*\)/g, '($1$2)')
    .replace(/\(\s*([gsl])\s*\)/g, '($1)')
    .replace(/\b(g|mol|M)\s*\/\s*(mL|L|mol)\b/g, '$1/$2')
    .replace(/(?:__FRAC__|\u27e6FRAC\u27e7)\s*([A-Za-z0-9.+\-\u2212]+)\s+([A-Za-z0-9.+\-\u2212]+)/g, (_, den, num) => linearFractionV2(den, num))
    .replace(/((?:[A-Za-z0-9.+\-\u2212]+\s+){5})①\s+__FRAC__\s+([A-Za-z0-9.+\-\u2212]+)\s+②\s+__FRAC__\s+([A-Za-z0-9.+\-\u2212]+)\s+③\s+__FRAC__\s+([A-Za-z0-9.+\-\u2212]+)\s+④\s+__FRAC__\s+([A-Za-z0-9.+\-\u2212]+)\s+⑤\s+__FRAC__\s+([A-Za-z0-9.+\-\u2212]+)/g, (_, nums, d1, d2, d3, d4, d5) => {
      const [n1, n2, n3, n4, n5] = nums.trim().split(/\s+/).slice(-5);
      return `① ${linearFractionV2(d1, n1)} ② ${linearFractionV2(d2, n2)} ③ ${linearFractionV2(d3, n3)} ④ ${linearFractionV2(d4, n4)} ⑤ ${linearFractionV2(d5, n5)}`;
    })
    .replace(/([A-Z][a-z]?)\s*([0-9]+)\s*([+\-\u2212])(?=$|[\s),.;:!?가-힣])/g, (_, element, power, sign) => `${element}${toScienceSuperscriptV2(power)}${toScienceSuperscriptV2(sign)}`)
    .replace(/([A-Z][a-z]?)\s*([+\-\u2212])(?=$|[\s),.;:!?가-힣])/g, (_, element, sign) => `${element}${toScienceSuperscriptV2(sign)}`)
    .replace(/([A-Z][a-z]?)\s*([0-9]+[xy]?)(?=$|[A-Z\s(,.;:!?\]\}가-힣])/g, (_, element, part) => `${element}${toScienceSubscriptV2(part)}`)
    .replace(/([A-Z][a-z]?)\s+([xy])(?=$|[A-Z\s(,.;:!?\]\}가-힣])/g, (_, element, variable) => `${element}${toScienceSubscriptV2(variable)}`)
    .replace(/([A-Z][a-z]?)([xy])(?=$|[A-Z\s(,.;:!?\]\}가-힣])/g, (_, element, variable) => `${element}${toScienceSubscriptV2(variable)}`)
    .replace(/(\))\s*([0-9]+)(?=$|[\s(,.;:!?\]\}가-힣])/g, (_, close, digits) => `${close}${toScienceSubscriptV2(digits)}`)
    .replace(/(^|[^A-Za-z])([Vv])\s*([0-9]+)/g, (_, prefix, variable, digits) => `${prefix}${variable}${toScienceSubscriptV2(digits)}`)
    .replace(/\s+([),.;:?!])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function bindUi() {
  els.openPdfInput.addEventListener('change', () => {
    const file = els.openPdfInput.files[0];
    if (file) uploadAndOpenPdf(file);
  });
  els.saveCurrentBtn.addEventListener('click', () => {
    openSaveDialog();
  });
  els.closePdfBtn.addEventListener('click', closeCurrentPdf);
  els.recentDocumentsBtn.addEventListener('click', openRecentDocuments);
  els.cancelOperationBtn.addEventListener('click', cancelPdfOperation);
  els.operationStateAction.addEventListener('click', cancelPdfOperation);
  els.saveCurrentLocationBtn.addEventListener('click', () => saveCurrentPdf('current'));
  els.saveAsBtn.addEventListener('click', () => saveCurrentPdf('saveAs'));
  els.closeSaveDialogBtn.addEventListener('click', closeSaveDialog);
  els.cancelSaveDialogBtn.addEventListener('click', closeSaveDialog);
  els.saveDialog.addEventListener('click', (event) => {
    if (event.target === els.saveDialog) closeSaveDialog();
  });
  els.closeRecentDocumentsBtn.addEventListener('click', closeRecentDocuments);
  els.closeRecentDocumentsBtnFooter.addEventListener('click', closeRecentDocuments);
  els.refreshRecentDocumentsBtn.addEventListener('click', () => loadDocuments());
  els.recentDocumentsSearch.addEventListener('input', () => {
    state.recentDocumentsQuery = els.recentDocumentsSearch.value;
    renderRecentDocuments();
  });
  els.recentDocumentsDialog.addEventListener('click', (event) => {
    if (event.target === els.recentDocumentsDialog) closeRecentDocuments();
  });
  els.closeUpdateDialogBtn.addEventListener('click', closeUpdateDialog);
  els.laterUpdateBtn.addEventListener('click', closeUpdateDialog);
  els.installUpdateBtn.addEventListener('click', installAppUpdate);
  els.updateDialog.addEventListener('click', (event) => {
    if (event.target === els.updateDialog && !state.updateInstalling) closeUpdateDialog();
  });
  els.shortcutsBtn.addEventListener('click', openShortcutsDialog);
  els.closeShortcutsDialogBtn.addEventListener('click', closeShortcutsDialog);
  els.closeShortcutsDialogFooterBtn.addEventListener('click', closeShortcutsDialog);
  els.shortcutsDialog.addEventListener('click', (event) => {
    if (event.target === els.shortcutsDialog) closeShortcutsDialog();
  });
  els.prevPageBtn.addEventListener('click', () => goToPage(state.page - 1));
  els.nextPageBtn.addEventListener('click', () => goToPage(state.page + 1));
  els.pageNumberInput.addEventListener('change', () => goToPage(Number(els.pageNumberInput.value)));
  els.undoBtn.addEventListener('click', undoPdfEdit);
  els.redoBtn.addEventListener('click', redoPdfEdit);
  els.selectAllPagesBtn.addEventListener('click', toggleSelectAllPages);
  els.deleteSelectedPagesBtn.addEventListener('click', deleteSelectedPages);
  els.duplicateSelectedPagesBtn.addEventListener('click', duplicateSelectedPages);
  els.movePageUpBtn.addEventListener('click', () => moveSelectedPages('up'));
  els.movePageDownBtn.addEventListener('click', () => moveSelectedPages('down'));
  els.zoomOutBtn.addEventListener('click', () => setZoom(state.scale - 0.15));
  els.zoomInBtn.addEventListener('click', () => setZoom(state.scale + 0.15));
  els.fitWidthBtn.addEventListener('click', fitWidth);
  els.copyPageTextBtn.addEventListener('click', () => copyText(state.pageText, '현재 페이지 텍스트를 복사했습니다.'));
  els.copyCurrentTextBtn.addEventListener('click', () => copyText(state.pageText, '현재 페이지 텍스트를 복사했습니다.'));
  els.extractBtn.addEventListener('click', runExtraction);
  els.runExtractBtn.addEventListener('click', runExtraction);
  els.copyMarkdownBtn.addEventListener('click', () => copyText(els.markdownOutput.value, 'Markdown을 복사했습니다.'));
  els.copyJsonBtn.addEventListener('click', () => copyText(els.jsonOutput.value, 'JSON을 복사했습니다.'));
  els.printScope.addEventListener('change', updatePrintScope);
  els.runPrintBtn.addEventListener('click', () => runPrintJob({ downloadOnly: false }));
  els.downloadPrintBtn.addEventListener('click', () => runPrintJob({ downloadOnly: true }));
  els.closePrintDialogBtn.addEventListener('click', closePrintDialog);
  els.cancelPrintDialogBtn.addEventListener('click', closePrintDialog);
  els.printDialog.addEventListener('click', (event) => {
    if (event.target === els.printDialog) closePrintDialog();
  });

  els.applyTextBtn.addEventListener('click', applyTextAnnotation);
  els.watermarkBtn.addEventListener('click', applyWatermark);
  els.extractPagesBtn.addEventListener('click', extractPages);
  els.splitPdfBtn.addEventListener('click', splitPdf);
  els.rotateBtn.addEventListener('click', rotatePdf);
  els.mergeBtn.addEventListener('click', mergePdfs);
  els.imagesToPdfBtn.addEventListener('click', imagesToPdf);
  els.compressBtn.addEventListener('click', compressPdf);
  els.encryptBtn.addEventListener('click', encryptPdf);
  els.decryptBtn.addEventListener('click', decryptPdf);
  els.aiRefreshBtn.addEventListener('click', loadAiStatus);
  els.aiSendBtn.addEventListener('click', () => {
    if (state.aiAbortController) {
      state.aiAbortController.abort();
      return;
    }
    runAiChat();
  });
  els.aiClearBtn.addEventListener('click', () => {
    clearAiConversation();
    els.aiPrompt.value = '';
  });
  els.aiPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runAiChat();
    }
  });
  els.aiProvider.addEventListener('change', () => {
    renderAiModelOptions();
    updateAiConnectionState();
  });
  els.aiModel.addEventListener('change', () => {
    state.aiModelSelections[els.aiProvider.value || 'codex'] = els.aiModel.value;
  });
  document.querySelectorAll('[data-ai-preset]').forEach((button) => {
    button.addEventListener('click', () => runAiPreset(button.dataset.aiPreset));
  });
  if (els.rightbarToggleBtn) {
    els.rightbarToggleBtn.addEventListener('click', () => {
      setRightbarCollapsed(!state.rightbarCollapsed);
    });
  }
  if (els.ribbonDensityBtn) {
    els.ribbonDensityBtn.addEventListener('click', () => {
      setRibbonCompact(!state.ribbonCompact);
    });
  }

  els.mergeFilesInput.addEventListener('change', () => {
    els.mergeFileLabel.textContent = `${els.mergeFilesInput.files.length}개 PDF 선택`;
  });
  els.imageFilesInput.addEventListener('change', () => {
    els.imageFileLabel.textContent = `${els.imageFilesInput.files.length}개 이미지 선택`;
  });

  document.querySelectorAll('[data-ribbon-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.ribbonTab;
      showRibbonTab(tabName, { syncPanel: true });
      
      // 편집 모드 제어
      if (tabName === 'edit') {
        state.editModeActive = true;
        els.editOverlay.classList.remove('hidden');
        setEditTool(state.editTool || 'select');
        updateEditOverlayGeometry();
      } else {
        state.editModeActive = false;
        els.editOverlay.classList.add('hidden');
        deselectActiveAnnotation();
      }
      updateOcrOverlayBoxes();
    });
  });

  document.querySelectorAll('[data-panel]:not([data-trigger]), [data-side-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      showSidePanel(button.dataset.panel || button.dataset.sideTab);
      focusPanelControl(button.dataset.focus);
    });
  });

  const sideTabs = [...document.querySelectorAll('[data-side-tab]')];
  sideTabs.forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sideTabs.length - 1
          : (index + direction + sideTabs.length) % sideTabs.length;
      const nextTab = sideTabs[nextIndex];
      nextTab.focus();
      nextTab.click();
    });
  });

  document.querySelectorAll('[data-print-dialog]').forEach((button) => {
    button.addEventListener('click', () => openPrintDialog(button.dataset.focus));
  });

  document.querySelectorAll('[data-trigger]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.panel) showSidePanel(button.dataset.panel);
      focusPanelControl(button.dataset.focus);
      const target = document.getElementById(button.dataset.trigger);
      if (target) target.click();
    });
  });

  document.querySelectorAll('[data-result-tab]').forEach((button) => {
    button.addEventListener('click', () => showResultTab(button.dataset.resultTab));
  });

  els.searchInput.addEventListener('input', updateSearchStatus);
  els.searchInput.addEventListener('click', () => {
    const keyword = els.searchInput.value.trim();
    if (!keyword) return;
    
    const widget = els.searchWidget;
    if (widget && widget.classList.contains('hidden')) {
      widget.classList.remove('hidden');
      refreshIcons();
    }
  });
  updatePrintScope();

  ['dragenter', 'dragover'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      event.preventDefault();
      document.querySelector('.viewer').classList.add('is-dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      event.preventDefault();
      document.querySelector('.viewer').classList.remove('is-dragging');
    });
  });

  document.addEventListener('drop', (event) => {
    const pdf = Array.from(event.dataTransfer.files || []).find((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (pdf) uploadAndOpenPdf(pdf);
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const hasModifier = event.ctrlKey || event.metaKey;
    const targetTag = event.target?.tagName;
    const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag);
    const isInteractiveTarget = ['BUTTON', 'A', 'SELECT'].includes(targetTag) || event.target?.isContentEditable;

    if (hasModifier && !isFormField) {
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoPdfEdit();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoPdfEdit();
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        els.openPdfInput.click();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        openSaveDialog();
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        openPrintDialog('runPrintBtn');
        return;
      }
    }

    if (!hasModifier && !isFormField && !isInteractiveTarget && state.pdf) {
      if (event.key === 'PageUp') {
        event.preventDefault();
        void goToPage(state.page - 1);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        void goToPage(state.page + 1);
        return;
      }
    }

    if (!hasModifier && !isFormField && !isInteractiveTarget && (event.key === '?' || (event.shiftKey && event.key === '/'))) {
      event.preventDefault();
      openShortcutsDialog();
      return;
    }

    if (event.key === 'Escape') {
      if (!els.saveDialog.classList.contains('hidden')) {
        closeSaveDialog();
      } else if (!els.recentDocumentsDialog.classList.contains('hidden')) {
        closeRecentDocuments();
      } else if (!els.printDialog.classList.contains('hidden')) {
        closePrintDialog();
      } else if (!els.updateDialog.classList.contains('hidden') && !state.updateInstalling) {
        closeUpdateDialog();
      } else if (!els.shortcutsDialog.classList.contains('hidden')) {
        closeShortcutsDialog();
      } else if (!els.searchWidget.classList.contains('hidden')) {
        hideSearchWidget();
      } else if (state.activeAnnotationId && !state.isEditingText) {
        deselectActiveAnnotation();
      }
    } else if (event.key === 'Delete' && state.activeAnnotationId && !state.isEditingText) {
      deleteAnnotation(state.activeAnnotationId);
    } else if (hasModifier && key === 'f') {
      event.preventDefault();
      toggleSearchWidget();
    }
  });

  els.widgetSearchInput.addEventListener('input', runWidgetSearch);
  els.closeSearchWidgetBtn.addEventListener('click', hideSearchWidget);
  els.widgetSearchPrev.addEventListener('click', navigateSearchPrev);
  els.widgetSearchNext.addEventListener('click', navigateSearchNext);

  setupEditOverlay();

  window.addEventListener('resize', () => {
    if (state.editModeActive) {
      updateEditOverlayGeometry();
    }
    updateOcrOverlayBoxes();
  });
}

async function checkForAppUpdate({ force = false } = {}) {
  try {
    const status = await requestJson(`/api/update/status${force ? '?force=1' : ''}`);
    if (!status.available || !status.installable) return;
    state.availableUpdate = status;
    els.updateVersionSummary.textContent = `${status.name || status.tag || '새 버전'}을 설치할 수 있습니다.`;
    els.updateCurrentVersion.textContent = `현재 ${status.currentVersion}`;
    els.updateLatestVersion.textContent = `최신 ${status.latestVersion}`;
    els.updateReleaseNotes.textContent = status.notes || '이번 릴리스의 상세 설명이 없습니다.';
    els.updateProgress.textContent = '설치 파일은 GitHub Release의 SHA-256 값과 대조한 후 실행됩니다.';
    els.viewReleaseBtn.href = status.releaseUrl || '#';
    els.updateDialog.classList.remove('hidden');
    document.body.classList.add('modal-open');
    refreshIcons();
  } catch (error) {
    console.warn('Update check failed:', error);
  }
}

function closeUpdateDialog() {
  if (state.updateInstalling) return;
  els.updateDialog.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function openShortcutsDialog() {
  const activeElement = document.activeElement;
  state.shortcutsReturnFocus = activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null;
  els.shortcutsDialog.classList.remove('hidden');
  els.shortcutsDialog.classList.add('is-open');
  document.body.classList.add('modal-open');
  refreshIcons();
  focusPanelControl('closeShortcutsDialogBtn');
}

function closeShortcutsDialog() {
  els.shortcutsDialog.classList.add('hidden');
  els.shortcutsDialog.classList.remove('is-open');
  if (
    els.saveDialog.classList.contains('hidden')
    && els.recentDocumentsDialog.classList.contains('hidden')
    && els.printDialog.classList.contains('hidden')
    && els.updateDialog.classList.contains('hidden')
  ) {
    document.body.classList.remove('modal-open');
  }
  const returnFocus = state.shortcutsReturnFocus;
  state.shortcutsReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

async function installAppUpdate() {
  if (state.updateInstalling || !state.availableUpdate) return;
  state.updateInstalling = true;
  els.installUpdateBtn.disabled = true;
  els.closeUpdateDialogBtn.disabled = true;
  els.laterUpdateBtn.disabled = true;
  els.updateProgress.textContent = '설치 파일을 다운로드하고 SHA-256을 검증하는 중입니다. 창을 닫지 마세요.';
  try {
    const response = await fetch('/api/update/install', {
      method: 'POST',
      headers: { 'X-JamePDF-Update-Request': '1' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || response.statusText);
    els.updateProgress.textContent = result.message || '업데이트를 설치하고 앱을 다시 시작합니다.';
    waitForUpdatedServer(result.version || state.availableUpdate.latestVersion);
  } catch (error) {
    state.updateInstalling = false;
    els.installUpdateBtn.disabled = false;
    els.closeUpdateDialogBtn.disabled = false;
    els.laterUpdateBtn.disabled = false;
    els.updateProgress.textContent = `업데이트 실패: ${error.message}`;
    showToast(error.message, true);
  }
}

async function waitForUpdatedServer(expectedVersion) {
  const deadline = Date.now() + 3 * 60 * 1000;
  await new Promise((resolve) => setTimeout(resolve, 1800));
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/api/health?update=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const health = await response.json();
        if (!expectedVersion || health.version === expectedVersion) {
          window.location.reload();
          return;
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  state.updateInstalling = false;
  els.updateProgress.textContent = '설치는 시작됐지만 앱 재시작을 확인하지 못했습니다. James PDF를 다시 실행해주세요.';
}

async function loadHealth() {
  try {
    const health = await requestJson('/api/health');
    els.serverState.textContent = `v${health.version}`;
    els.serverState.className = 'ready';

    const hasQpdf = Boolean(health.dependencies?.qpdf);
    const hasGs = Boolean(health.dependencies?.ghostscript);
    const hasHybrid = Boolean(health.dependencies?.hybrid?.available);
    const hasKordocStudio = Boolean(health.dependencies?.kordocStudio?.dist);
    els.toolState.textContent = hasHybrid ? 'Hybrid 준비' : 'Hybrid 대기';
    els.toolState.className = hasHybrid ? 'ready' : 'limited';

    els.securityNote.textContent = hasQpdf ? '' : '암호 설정·해제는 qpdf 설치 후 활성화됩니다.';
    els.compressNote.textContent = hasGs ? '' : 'Ghostscript가 없어 압축은 객체 재저장 방식으로 동작합니다.';
    if (els.aiiStudioBtn) {
      els.aiiStudioBtn.title = hasKordocStudio
        ? 'James Studio 열기'
        : 'James Studio 구성 요소를 확인하는 중입니다. 그래도 열 수 있습니다.';
      els.aiiStudioBtn.setAttribute('data-studio-ready', hasKordocStudio ? 'true' : 'false');
    }
    if (els.extractNote) {
      els.extractNote.textContent = hasHybrid ? '' : '추출은 실행 시 Hybrid OCR/Formula 서버를 자동으로 시작합니다.';
    }
  } catch (error) {
    els.serverState.textContent = '오프라인';
    els.toolState.textContent = '확인 실패';
    showToast(error.message, true);
  }
  loadAiStatus();
}

async function loadAiStatus() {
  if (!els.aiStatusNote) return;
  els.aiStatusNote.textContent = 'AI 상태를 확인하는 중입니다.';
  setAiConnectionState('checking', 'AI 연결 확인 중');
  try {
    const status = await requestJson('/api/ai/status');
    const providers = status.providers || {};
    state.aiProviders = providers;
    const parts = [];
    const gemma = providers.gemma || {};
    renderAiModelOptions();
    parts.push(`Gemma/Ollama: ${gemma.available ? '준비' : 'offline'}`);
    parts.push(`Codex: ${providers.codex?.available ? '준비' : '없음'}`);
    parts.push(`Antigravity: ${providers.antigravity?.available ? '준비' : '없음'}`);
    parts.push(`Claude: ${providers.claude?.available ? '준비' : '없음'}`);
    els.aiStatusNote.textContent = parts.join(' | ');
    els.aiStatusNote.classList.toggle('is-ok', Boolean(providers.codex?.available || providers.antigravity?.available || gemma.available || providers.claude?.available));
    updateAiConnectionState();
  } catch (error) {
    state.aiProviders = {};
    els.aiStatusNote.textContent = `AI 상태 확인 실패: ${error.message}`;
    els.aiStatusNote.classList.remove('is-ok');
    setAiConnectionState('offline', 'AI 상태 확인 실패');
  }
}

function selectedAiProviderStatus() {
  const provider = els.aiProvider?.value || 'codex';
  const providers = state.aiProviders || {};
  if (provider === 'gemma') return providers.gemma || {};
  return providers[provider] || {};
}

function updateAiConnectionState() {
  const provider = els.aiProvider?.value || 'codex';
  const status = selectedAiProviderStatus();
  const connected = Boolean(status.available);
  const labels = {
    gemma: 'Gemma/Ollama',
    antigravity: 'Antigravity',
    codex: 'Codex CLI',
    claude: 'Claude CLI',
  };
  const label = labels[provider] || provider;
  setAiConnectionState(connected ? 'online' : 'offline', connected ? `${label} 연결됨` : `${label} 연결 안 됨`);
}

function renderAiModelOptions() {
  if (!els.aiModel) return;
  const provider = els.aiProvider?.value || 'codex';
  const selected = state.aiModelSelections[provider];
  const models = aiModelsForProvider(provider);
  els.aiModel.innerHTML = '';
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.value;
    option.textContent = model.note ? `${model.label}  ${model.note}` : model.label;
    option.title = model.note ? `${model.label} (${model.note})` : model.label;
    els.aiModel.appendChild(option);
  });
  const fallback = provider === 'gemma' ? 'gemma4:e4b' : models[0]?.value || '';
  const nextValue = selected && models.some((model) => model.value === selected) ? selected : fallback;
  els.aiModel.value = nextValue;
  state.aiModelSelections[provider] = els.aiModel.value;
}

function aiModelsForProvider(provider) {
  if (provider === 'gemma') {
    const status = state.aiProviders?.gemma || {};
    const names = Array.isArray(status.models) && status.models.length ? status.models : ['gemma4:e4b'];
    const uniqueNames = Array.from(new Set(['gemma4:e4b', ...names].filter(Boolean)));
    return uniqueNames.map((name) => ({
      value: name,
      label: name,
      note: name === 'gemma4:e4b' ? 'Local' : 'Ollama',
    }));
  }
  return AI_MODEL_PRESETS[provider] || [{ value: `${provider}-auto`, label: 'Auto' }];
}

function setAiConnectionState(mode, text) {
  if (!els.aiConnectionState) return;
  els.aiConnectionState.classList.toggle('is-online', mode === 'online');
  els.aiConnectionState.classList.toggle('is-offline', mode === 'offline');
  els.aiConnectionState.classList.toggle('is-checking', mode === 'checking');
  const label = els.aiConnectionState.querySelector('strong');
  if (label) label.textContent = text;
}

async function loadLegacyDocuments() {
  // 앱 시작 시 이전 문서를 자동으로 불러오는 것을 방지하고 항상 클린 상태(빈 화면)로 시작하도록 비활성화합니다.
  /*
  try {
    const docs = await requestJson('/api/documents');
    if (Array.isArray(docs) && docs.length && !state.document) {
      const latest = docs[0];
      state.document = latest;
      state.currentFilename = latest.originalName;
      await loadPdfFromUrl(latest.url, latest.originalName);
    }
  } catch {
    // Empty document history is a normal first-run state.
  }
  */
}

function formatRecentDocumentSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return (value / (1024 ** index)).toFixed(index ? 1 : 0) + ' ' + units[index];
}

function formatRecentDocumentDate(doc) {
  const raw = doc.lastOpenedAt || doc.date;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function recentDocumentMatches(doc, query) {
  if (!query) return true;
  const values = [
    doc.originalName,
    doc.filename,
    formatRecentDocumentDate(doc),
  ];
  return values.some((value) => String(value || '').toLocaleLowerCase('ko-KR').includes(query));
}

function renderRecentDocuments() {
  if (!els.recentDocumentsList) return;

  const query = String(state.recentDocumentsQuery || '').trim().toLocaleLowerCase('ko-KR');
  const documents = [...state.recentDocuments]
    .sort((a, b) => {
      const left = new Date(a.lastOpenedAt || a.date || 0).getTime();
      const right = new Date(b.lastOpenedAt || b.date || 0).getTime();
      return right - left;
    })
    .filter((doc) => recentDocumentMatches(doc, query));

  els.recentDocumentsList.innerHTML = '';
  if (els.recentDocumentsCount) {
    els.recentDocumentsCount.textContent = documents.length + ' / ' + state.recentDocuments.length + '개';
  }

  if (!documents.length) {
    const empty = document.createElement('div');
    empty.className = 'recent-documents-empty';
    empty.textContent = state.recentDocuments.length
      ? '검색 결과가 없습니다.'
      : '최근 문서가 없습니다.';
    els.recentDocumentsList.appendChild(empty);
    return;
  }

  documents.forEach((doc) => {
    const item = document.createElement('article');
    item.className = 'recent-document-item';
    if (doc.available === false) item.classList.add('is-missing');

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'recent-document-open';
    openButton.disabled = doc.available === false;

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', doc.available === false ? 'file-warning' : 'file-text');
    const details = document.createElement('span');
    details.className = 'recent-document-details';
    const name = document.createElement('strong');
    name.textContent = doc.originalName || doc.filename || '이름 없는 PDF';
    const meta = document.createElement('span');
    const metaParts = [
      formatRecentDocumentDate(doc),
      formatRecentDocumentSize(doc.size),
      Number(doc.pageCount) > 0 ? String(doc.pageCount) + '페이지' : '',
    ].filter(Boolean);
    meta.textContent = metaParts.join(' · ');
    details.append(name, meta);
    openButton.append(icon, details);

    if (doc.available === false) {
      const missing = document.createElement('span');
      missing.className = 'recent-document-missing';
      missing.textContent = '원본 파일 없음';
      details.appendChild(missing);
    } else {
      openButton.addEventListener('click', () => openRecentDocument(doc));
    }

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mini-button recent-document-delete';
    deleteButton.title = '이 문서와 분석 결과 삭제';
    deleteButton.setAttribute('aria-label', '이 문서와 분석 결과 삭제');
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteRecentDocument(doc));

    item.append(openButton, deleteButton);
    els.recentDocumentsList.appendChild(item);
  });
  refreshIcons();
}

async function loadDocuments() {
  try {
    const documents = await requestJson('/api/documents');
    state.recentDocuments = Array.isArray(documents) ? documents : [];
  } catch (error) {
    state.recentDocuments = [];
    console.warn('Failed to load recent documents:', error);
  }
  renderRecentDocuments();
  return state.recentDocuments;
}

function syncStudioNavigationContext() {
  if (!els.aiiStudioBtn) return;
  const url = new URL('/kordoc', window.location.href);
  const documentId = String(state.document?.id || '').trim();
  if (documentId) {
    url.searchParams.set(STUDIO_DOCUMENT_QUERY_KEY, documentId);
    if (Number.isInteger(Number(state.page)) && Number(state.page) > 0) {
      url.searchParams.set('page', String(state.page));
    }
  }
  els.aiiStudioBtn.href = `${url.pathname}${url.search}`;
}

async function restoreSharedDocumentFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const documentId = String(params.get(STUDIO_DOCUMENT_QUERY_KEY) || '').trim();
  if (!documentId) return;

  try {
    resetPdfHistory();
    setOperationStatus('공유 문서 여는 중');
    const documentInfo = await requestJson('/api/documents/' + encodeURIComponent(documentId) + '/open', {
      method: 'POST',
    });
    state.document = documentInfo;
    state.currentBlob = null;
    state.currentFilename = documentInfo.originalName || 'document.pdf';
    await loadPdfFromUrl(documentInfo.url, state.currentFilename);

    const requestedPage = Number(params.get('page'));
    if (Number.isInteger(requestedPage) && requestedPage > 0) {
      await goToPage(requestedPage);
    }

    syncStudioNavigationContext();
    setOperationStatus('공유 문서 열림');
    showToast('James Studio에서 이어서 작업할 문서를 열었습니다.');

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(STUDIO_DOCUMENT_QUERY_KEY);
    cleanUrl.searchParams.delete('page');
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}`);
  } catch (error) {
    setOperationStatus('공유 문서 열기 실패');
    showToast(error.message || '공유 문서를 열 수 없습니다.', true);
  }
}

async function openRecentDocuments() {
  els.recentDocumentsDialog.classList.remove('hidden');
  els.recentDocumentsDialog.classList.add('is-open');
  document.body.classList.add('modal-open');
  await loadDocuments();
  refreshIcons();
  if (els.recentDocumentsSearch) {
    els.recentDocumentsSearch.focus();
    els.recentDocumentsSearch.select();
  }
}

function closeRecentDocuments() {
  els.recentDocumentsDialog.classList.add('hidden');
  els.recentDocumentsDialog.classList.remove('is-open');
  if (
    els.saveDialog.classList.contains('hidden')
    && els.printDialog.classList.contains('hidden')
    && els.updateDialog.classList.contains('hidden')
  ) {
    document.body.classList.remove('modal-open');
  }
}

async function openRecentDocument(doc) {
  if (!doc || doc.available === false) return;
  if (state.pdf && state.document?.id !== doc.id) {
    const proceed = window.confirm('현재 문서를 닫고 선택한 최근 문서를 열까요? 저장하지 않은 변경 사항은 사라질 수 있습니다.');
    if (!proceed) return;
  }

  resetPdfHistory();
  try {
    setOperationStatus('최근 문서를 여는 중');
    const updated = await requestJson('/api/documents/' + encodeURIComponent(doc.id) + '/open', {
      method: 'POST',
    });
    state.document = updated || doc;
    state.currentBlob = null;
    state.currentFilename = state.document.originalName || doc.originalName || 'document.pdf';
    await loadPdfFromUrl(state.document.url || doc.url, state.currentFilename);
    syncStudioNavigationContext();
    closeRecentDocuments();
    setOperationStatus('최근 문서 열림');
    showToast('최근 문서를 열었습니다.');
    await loadDocuments();
  } catch (error) {
    setOperationStatus('최근 문서 열기 실패');
    showToast(error.message || '최근 문서를 열 수 없습니다.', true);
  }
}

async function deleteRecentDocument(doc) {
  if (!doc?.id) return;
  const name = doc.originalName || doc.filename || '선택한 문서';
  const proceed = window.confirm('"' + name + '"과 저장된 분석 결과를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
  if (!proceed) return;

  try {
    await requestJson('/api/documents/' + encodeURIComponent(doc.id), {
      method: 'DELETE',
    });
    if (state.document?.id === doc.id) {
      await closeCurrentPdf();
    }
    await loadDocuments();
    showToast('최근 문서와 분석 결과를 삭제했습니다.');
  } catch (error) {
    showToast(error.message || '최근 문서를 삭제할 수 없습니다.', true);
  }
}

async function uploadAndOpenPdf(file) {
  resetPdfHistory();
  setOperationStatus('업로드 중');
  const form = new FormData();
  form.append('file', file);
  try {
    const doc = await requestJson('/api/upload', { method: 'POST', body: form });
    state.document = doc;
    state.currentBlob = file;
    state.currentFilename = doc.originalName || file.name;
    await loadPdfFromUrl(doc.url, state.currentFilename);
    syncStudioNavigationContext();
    setOperationStatus('열기 완료');
    showToast('PDF를 열었습니다.');
  } catch (error) {
    showToast(error.message, true);
    setOperationStatus('열기 실패');
  }
}

async function closeCurrentPdf() {
  if (!state.document && !state.currentBlob) {
    showToast('현재 열려 있는 문서가 없습니다.');
    return;
  }

  // 1. 디바이스 용량 정리를 위해 백엔드에 파일 삭제 요청
  if (REMOVE_DOCUMENT_ON_CLOSE && state.document && state.document.id) {
    setOperationStatus('문서 정리 중');
    try {
      await requestJson(`/api/documents/${state.document.id}`, {
        method: 'DELETE'
      });
      showToast('문서를 닫고 디스크 용량을 확보했습니다.');
    } catch (error) {
      console.error('Failed to clean up files on server:', error);
      showToast('문서를 닫았으나 서버 임시 파일 제거에 실패했습니다.', true);
    }
  } else {
    showToast('임시 문서를 닫았습니다.');
  }

  // 2. 프론트엔드 상태 초기화
  state.pdf = null;
  state.document = null;
  state.currentBlob = null;
  state.currentFilename = '문서 없음';
  state.page = 1;
  state.pageCount = 0;
  state.pageText = '';
  state.lastPdfUrl = '';
  state.extractedJson = null;
  state.extractedMarkdown = '';
  syncStudioNavigationContext();
  state.annotations = [];
  state.activeAnnotationId = null;
  state.selectedPages.clear();
  resetPdfHistory();

  // 3. UI 컴포넌트 초기화
  els.pdfCanvas.style.display = 'none';
  const viewer = document.querySelector('.viewer');
  if (viewer) {
    viewer.classList.remove('has-document');
  }
  
  els.thumbnailList.innerHTML = '';
  els.thumbCount.textContent = '0';
  updatePageSelectionUi();
  els.documentName.textContent = '문서 없음';
  els.pageCountLabel.textContent = '/ 0';
  els.pageNumberInput.value = '1';
  els.currentTextOutput.value = '';
  els.markdownOutput.value = '';
  els.jsonOutput.value = '';
  
  setOperationStatus('문서 닫힘');
  updateStatus();
  updateOcrOverlayBoxes();
  
  els.openPdfInput.value = '';
  showToast('문서를 닫았습니다. 최근 문서에서 다시 열 수 있습니다.');
}

function readDocumentViewStates() {
  try {
    const value = JSON.parse(localStorage.getItem(DOCUMENT_VIEW_PREF_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function getDocumentViewState(documentId) {
  if (!documentId) return null;
  return readDocumentViewStates()[documentId] || null;
}

function saveDocumentViewState() {
  const documentId = state.document?.id;
  if (!documentId) return;
  try {
    const states = readDocumentViewStates();
    states[documentId] = {
      page: state.page,
      scale: state.scale,
      updatedAt: new Date().toISOString(),
    };
    const entries = Object.entries(states)
      .sort((left, right) => String(right[1]?.updatedAt || '').localeCompare(String(left[1]?.updatedAt || '')))
      .slice(0, 80);
    localStorage.setItem(DOCUMENT_VIEW_PREF_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // localStorage may be unavailable in a restricted browser context.
  }
}

async function loadPdfFromUrl(url, filename) {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js를 불러오지 못했습니다.');
  }
  state.lastPdfUrl = url;
  state.extractedJson = null; // 분석 결과 초기화
  const loadingTask = window.pdfjsLib.getDocument(url);
  state.pdf = await loadingTask.promise;
  const viewState = getDocumentViewState(state.document?.id);
  state.page = Math.max(1, Math.min(state.pdf.numPages, Number(viewState?.page) || 1));
  if (Number.isFinite(Number(viewState?.scale))) {
    state.scale = Math.max(0.35, Math.min(3.5, Number(viewState.scale)));
  }
  state.pageCount = state.pdf.numPages;
  state.selectedPages.clear();
  state.currentFilename = filename || state.currentFilename || 'document.pdf';
  els.documentName.textContent = state.currentFilename;
  els.pageCountLabel.textContent = `/ ${state.pageCount}`;
  els.thumbCount.textContent = state.pageCount;
  document.querySelector('.viewer').classList.add('has-document');
  await renderPage(state.page);
  renderThumbnails();
  updatePageSelectionUi();
  updateStatus();

  // 백그라운드 자동 분석 실행
  if (state.document && state.document.id) {
    runBackgroundExtraction(state.document.id);
  }
}

async function loadPdfFromBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  state.currentBlob = blob;
  state.currentFilename = filename || 'output.pdf';
  state.document = null;
  await loadPdfFromUrl(url, state.currentFilename);

  // 백그라운드 업로드 및 자동 분석
  try {
    const form = new FormData();
    form.append('file', new File([blob], state.currentFilename, { type: 'application/pdf' }));
    const doc = await requestJson('/api/upload', { method: 'POST', body: form });
    state.document = doc;
    els.documentName.textContent = state.currentFilename;
    syncStudioNavigationContext();
    runBackgroundExtraction(doc.id);
  } catch (err) {
    console.error('Failed to background upload blob:', err);
  }
  if (state.lastObjectUrl) URL.revokeObjectURL(state.lastObjectUrl);
  state.lastObjectUrl = url;
}

async function renderPage(pageNumber) {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: state.scale });
  state.pdfPageViewport = viewport;
  const canvas = els.pdfCanvas;
  const context = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;

  const text = await page.getTextContent();
  state.pageText = normalizeExtractedTextV2(text.items.map((item) => item.str).join(' '));
  els.currentTextOutput.value = state.pageText;
  els.editPage.value = pageNumber;
  els.pageNumberInput.value = pageNumber;
  updateSearchStatus();
  updateStatus();
  highlightActiveThumbnail();

  if (state.editModeActive) {
    updateEditOverlayGeometry();
  }
  updateOcrOverlayBoxes();
}

async function renderThumbnails() {
  els.thumbnailList.innerHTML = '';
  if (!state.pdf) return;

  for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
    const item = document.createElement('button');
    item.className = 'thumb-item';
    item.type = 'button';
    item.dataset.page = String(pageNumber);
    const canvas = document.createElement('canvas');
    const label = document.createElement('span');
    label.textContent = String(pageNumber);
    item.append(canvas, label);
    els.thumbnailList.appendChild(item);

    item.setAttribute('aria-pressed', 'false');
    item.title = '드래그하여 페이지 순서 변경';
    item.draggable = true;
    item.addEventListener('click', (event) => {
      if (state.suppressThumbnailClick) {
        state.suppressThumbnailClick = false;
        return;
      }
      handleThumbnailSelection(pageNumber, event);
    });
    item.addEventListener('dragstart', (event) => handleThumbnailDragStart(event, pageNumber, item));
    item.addEventListener('dragover', (event) => handleThumbnailDragOver(event, pageNumber, item));
    item.addEventListener('dragleave', () => handleThumbnailDragLeave(item));
    item.addEventListener('drop', (event) => handleThumbnailDrop(event, pageNumber, item));
    item.addEventListener('dragend', () => handleThumbnailDragEnd(item));

    try {
      const page = await state.pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 0.16 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    } catch {
      // Keep the page selector even if a thumbnail cannot render.
    }
  }
  highlightActiveThumbnail();
}

function highlightActiveThumbnail() {
  els.thumbnailList.querySelectorAll('.thumb-item').forEach((item) => {
    const pageNumber = Number(item.dataset.page);
    const isActive = pageNumber === state.page;
    const isSelected = state.selectedPages.has(pageNumber);
    item.classList.toggle('is-active', isActive);
    item.classList.toggle('is-selected', isSelected);
    item.setAttribute('aria-pressed', String(isSelected));
  });
}

async function goToPage(pageNumber) {
  if (!state.pdf) return;
  const target = Math.max(1, Math.min(state.pageCount, Number(pageNumber) || 1));
  state.page = target;
  saveDocumentViewState();
  syncStudioNavigationContext();
  await renderPage(target);
}

async function setZoom(scale) {
  state.scale = Math.max(0.35, Math.min(3.5, Number(scale) || 1));
  saveDocumentViewState();
  if (state.pdf) await renderPage(state.page);
}

async function fitWidth() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const viewport = page.getViewport({ scale: 1 });
  const hostWidth = Math.max(320, els.canvasHost.clientWidth - 70);
  state.scale = Math.max(0.35, Math.min(3.5, hostWidth / viewport.width));
  saveDocumentViewState();
  await renderPage(state.page);
}

function handleThumbnailSelection(pageNumber, event) {
  if (!state.pdf) return;

  if (event.shiftKey && state.selectedPages.size > 0) {
    const anchor = state.page || pageNumber;
    const start = Math.min(anchor, pageNumber);
    const end = Math.max(anchor, pageNumber);
    state.selectedPages = new Set();
    for (let current = start; current <= end; current += 1) state.selectedPages.add(current);
  } else if (event.ctrlKey || event.metaKey) {
    const next = new Set(state.selectedPages);
    if (next.has(pageNumber)) next.delete(pageNumber);
    else next.add(pageNumber);
    state.selectedPages = next;
  } else {
    state.selectedPages = new Set([pageNumber]);
  }

  updatePageSelectionUi();
  goToPage(pageNumber);
}

function updatePageSelectionUi() {
  const hasDocument = Boolean(state.pdf && state.pageCount > 0);
  const selectedCount = state.selectedPages.size;
  const allSelected = hasDocument && selectedCount === state.pageCount;

  if (els.selectedPageCount) {
    els.selectedPageCount.textContent = `${selectedCount} 선택`;
  }
  if (els.selectAllPagesBtn) {
    els.selectAllPagesBtn.disabled = !hasDocument;
    els.selectAllPagesBtn.setAttribute('aria-pressed', String(allSelected));
    els.selectAllPagesBtn.setAttribute('title', allSelected ? '전체 페이지 선택 해제' : '전체 페이지 선택');
    els.selectAllPagesBtn.setAttribute('aria-label', allSelected ? '전체 페이지 선택 해제' : '전체 페이지 선택');
    const label = els.selectAllPagesBtn.querySelector('span');
    if (label) label.textContent = allSelected ? '해제' : '전체';
  }

  const hasSelection = hasDocument && selectedCount > 0;
  if (els.deleteSelectedPagesBtn) {
    els.deleteSelectedPagesBtn.disabled = !hasSelection || selectedCount >= state.pageCount;
  }
  if (els.duplicateSelectedPagesBtn) els.duplicateSelectedPagesBtn.disabled = !hasSelection;
  if (els.movePageUpBtn) els.movePageUpBtn.disabled = !hasSelection;
  if (els.movePageDownBtn) els.movePageDownBtn.disabled = !hasSelection;
  highlightActiveThumbnail();
}

function clearThumbnailDropIndicators() {
  els.thumbnailList.querySelectorAll('.thumb-item').forEach((item) => {
    item.classList.remove('drop-before', 'drop-after', 'is-drop-target');
  });
}

function handleThumbnailDragStart(event, pageNumber, item) {
  const selectedPages = state.selectedPages.has(pageNumber)
    ? new Set(state.selectedPages)
    : new Set([pageNumber]);
  if (!state.selectedPages.has(pageNumber)) {
    state.selectedPages = selectedPages;
    updatePageSelectionUi();
  }

  state.thumbnailDrag = {
    sourcePages: Array.from(selectedPages).sort((left, right) => left - right),
    targetPage: pageNumber,
    position: 'before',
  };
  item.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(pageNumber));
  }
}

function handleThumbnailDragOver(event, pageNumber, item) {
  const drag = state.thumbnailDrag;
  if (!drag || drag.sourcePages.includes(pageNumber)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  const rect = item.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  clearThumbnailDropIndicators();
  item.classList.add(position === 'before' ? 'drop-before' : 'drop-after', 'is-drop-target');
  drag.targetPage = pageNumber;
  drag.position = position;
}

function handleThumbnailDragLeave(item) {
  item.classList.remove('drop-before', 'drop-after', 'is-drop-target');
}

function handleThumbnailDrop(event, pageNumber, item) {
  const drag = state.thumbnailDrag;
  if (!drag || drag.sourcePages.includes(pageNumber)) return;
  event.preventDefault();
  const position = drag.targetPage === pageNumber ? drag.position : 'before';
  state.suppressThumbnailClick = true;
  window.setTimeout(() => {
    state.suppressThumbnailClick = false;
  }, 0);
  void moveDraggedPages(drag.sourcePages, pageNumber, position);
  clearThumbnailDropIndicators();
}

function handleThumbnailDragEnd(item) {
  item.classList.remove('is-dragging');
  clearThumbnailDropIndicators();
  state.thumbnailDrag = null;
}

async function moveDraggedPages(sourcePages, targetPage, position) {
  const sourceSet = new Set(sourcePages);
  const currentOrder = currentPageOrder();
  const movingPages = currentOrder.filter((pageNumber) => sourceSet.has(pageNumber));
  if (!movingPages.length || sourceSet.has(targetPage)) return;

  const remainingPages = currentOrder.filter((pageNumber) => !sourceSet.has(pageNumber));
  const targetIndex = remainingPages.indexOf(targetPage);
  if (targetIndex < 0) return;
  const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  const nextOrder = remainingPages.slice();
  nextOrder.splice(insertIndex, 0, ...movingPages);
  if (nextOrder.every((pageNumber, index) => pageNumber === currentOrder[index])) return;

  const activePageIdentity = currentOrder[state.page - 1];
  const moved = await applyPageOrder(nextOrder, movingPages.length > 1 ? `${movingPages.length}개 페이지 이동` : '페이지 이동', {
    pageIdentity: activePageIdentity,
  });
  if (!moved) return;

  state.selectedPages = new Set(movingPages.map((pageNumber) => nextOrder.indexOf(pageNumber) + 1));
  updatePageSelectionUi();
}

function toggleSelectAllPages() {
  if (!state.pdf) return;
  if (state.selectedPages.size === state.pageCount) {
    state.selectedPages.clear();
  } else {
    state.selectedPages = new Set(Array.from({ length: state.pageCount }, (_, index) => index + 1));
  }
  updatePageSelectionUi();
}

function currentPageOrder() {
  return Array.from({ length: state.pageCount }, (_, index) => index + 1);
}

function stablePdfFilename(filename) {
  const value = String(filename || 'document.pdf').trim() || 'document.pdf';
  const normalized = value.replace(/(?:-organized)+(?=\.pdf$)/gi, '');
  return normalized || 'document.pdf';
}

async function applyPageOrder(order, label, options = {}) {
  if (!state.pdf || !Array.isArray(order) || order.length === 0) return;
  if (state.pdfOperationAbortController) {
    showToast('현재 작업이 끝난 뒤 페이지 구성을 변경할 수 있습니다.', true);
    return;
  }

  try {
    const file = await currentPdfFile();
    const form = new FormData();
    form.append('file', file);
    form.append('order', JSON.stringify(order.map((pageNumber) => pageNumber - 1)));
    const completed = await runPdfOperation('/api/pdf/organize-pages', form, label, {
      recordHistory: true,
      markDirty: true,
      downloadResult: false,
      previewFilename: stablePdfFilename(state.currentFilename),
    });
    if (completed && Number.isInteger(options.pageIdentity)) {
      const nextPage = order.indexOf(options.pageIdentity) + 1;
      if (nextPage > 0) await goToPage(nextPage);
    }
    return completed;
  } catch (error) {
    setOperationStatus(label + ' 실패');
    showToast(error.message || label + ' 작업을 시작하지 못했습니다.', true);
    return false;
  }
}

async function deleteSelectedPages() {
  if (!state.pdf || state.selectedPages.size === 0) return;
  if (state.selectedPages.size >= state.pageCount) {
    showToast('PDF에는 한 페이지 이상 남아 있어야 합니다.', true);
    return;
  }

  const selectedCount = state.selectedPages.size;
  const proceed = window.confirm(`선택한 ${selectedCount}개 페이지를 삭제할까요?`);
  if (!proceed) return;
  const order = currentPageOrder().filter((pageNumber) => !state.selectedPages.has(pageNumber));
  await applyPageOrder(order, `${selectedCount}페이지 삭제`);
}

async function duplicateSelectedPages() {
  if (!state.pdf || state.selectedPages.size === 0) return;
  const order = [];
  currentPageOrder().forEach((pageNumber) => {
    order.push(pageNumber);
    if (state.selectedPages.has(pageNumber)) order.push(pageNumber);
  });
  await applyPageOrder(order, `${state.selectedPages.size}페이지 복제`);
}

async function moveSelectedPages(direction) {
  if (!state.pdf || state.selectedPages.size === 0) return;
  const order = currentPageOrder();

  if (direction === 'up') {
    for (let index = 1; index < order.length; index += 1) {
      if (state.selectedPages.has(index + 1) && !state.selectedPages.has(index)) {
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
      }
    }
  } else {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (state.selectedPages.has(index + 1) && !state.selectedPages.has(index + 2)) {
        [order[index], order[index + 1]] = [order[index + 1], order[index]];
      }
    }
  }

  if (order.every((pageNumber, index) => pageNumber === index + 1)) {
    showToast(direction === 'up' ? '선택한 페이지가 이미 맨 위입니다.' : '선택한 페이지가 이미 맨 아래입니다.');
    return;
  }
  await applyPageOrder(order, direction === 'up' ? '페이지 위로 이동' : '페이지 아래로 이동');
}

function updateHistoryButtons() {
  const disabled = state.historyBusy || Boolean(state.pdfOperationAbortController);
  if (els.undoBtn) els.undoBtn.disabled = disabled || state.undoStack.length === 0;
  if (els.redoBtn) els.redoBtn.disabled = disabled || state.redoStack.length === 0;
}

function setDocumentDirty(dirty) {
  state.documentDirty = Boolean(dirty);
  const label = state.documentDirty ? '변경 있음' : '저장됨';
  if (els.documentDirtyState) {
    els.documentDirtyState.textContent = label;
    els.documentDirtyState.classList.toggle('is-dirty', state.documentDirty);
    els.documentDirtyState.classList.toggle('is-clean', !state.documentDirty);
  }
  if (els.viewerDocumentState) {
    els.viewerDocumentState.textContent = label;
    els.viewerDocumentState.classList.toggle('is-dirty', state.documentDirty);
    els.viewerDocumentState.classList.toggle('is-clean', !state.documentDirty);
  }
}

function resetPdfHistory() {
  state.undoStack = [];
  state.redoStack = [];
  state.historyBusy = false;
  setDocumentDirty(false);
  updateHistoryButtons();
}

async function captureCurrentPdfSnapshot() {
  const file = await currentPdfFile();
  return {
    blob: new Blob([await file.arrayBuffer()], { type: 'application/pdf' }),
    filename: stablePdfFilename(file.name || state.currentFilename || 'document.pdf'),
  };
}

function pushUndoSnapshot(snapshot) {
  if (!snapshot?.blob) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 12) state.undoStack.shift();
  state.redoStack = [];
  updateHistoryButtons();
}

async function undoPdfEdit() {
  if (state.historyBusy || state.undoStack.length === 0) return;
  state.historyBusy = true;
  updateHistoryButtons();
  let target = null;
  let current = null;
  try {
    current = await captureCurrentPdfSnapshot();
    target = state.undoStack.pop();
    state.redoStack.push(current);
    await loadPdfFromBlob(target.blob, target.filename);
    setDocumentDirty(true);
    setOperationStatus('실행 취소 완료');
    showToast('이전 페이지 구성을 복원했습니다.');
  } catch (error) {
    if (target) state.undoStack.push(target);
    if (current) state.redoStack.pop();
    showToast(error.message || '실행 취소에 실패했습니다.', true);
  } finally {
    state.historyBusy = false;
    updateHistoryButtons();
  }
}

async function redoPdfEdit() {
  if (state.historyBusy || state.redoStack.length === 0) return;
  state.historyBusy = true;
  updateHistoryButtons();
  let target = null;
  let current = null;
  try {
    current = await captureCurrentPdfSnapshot();
    target = state.redoStack.pop();
    state.undoStack.push(current);
    await loadPdfFromBlob(target.blob, target.filename);
    setDocumentDirty(true);
    setOperationStatus('다시 실행 완료');
    showToast('페이지 구성을 다시 적용했습니다.');
  } catch (error) {
    if (target) state.redoStack.push(target);
    if (current) state.undoStack.pop();
    showToast(error.message || '다시 실행에 실패했습니다.', true);
  } finally {
    state.historyBusy = false;
    updateHistoryButtons();
  }
}

async function runExtraction() {
  if (!state.document?.id) {
    showToast('먼저 PDF를 업로드해 열어야 추출할 수 있습니다.', true);
    return;
  }

  // 1. 빠른 분석 모드이면서 페이지 범위가 없고, 이미 자동 분석 캐시 데이터가 있다면 즉시 반환
  if (els.extractMode.value === 'fast' && !els.extractPages.value.trim() && state.extractedJson) {
    els.markdownOutput.value = state.extractedMarkdown || '';
    els.jsonOutput.value = JSON.stringify(state.extractedJson || {}, null, 2);
    setOperationStatus('추출 완료');
    showToast('자동 분석된 Markdown/JSON 결과를 즉시 표시했습니다.');
    return;
  }

  // 2. 분석 중인 상태를 UI 텍스트 상자에 노출하여 멈춤 오해 방지
  els.markdownOutput.value = '[문서를 분석하고 마크다운을 생성하고 있습니다. 잠시만 기다려 주세요...]';
  els.jsonOutput.value = '{\n  "status": "processing",\n  "message": "JSON 데이터를 추출하고 있습니다. 잠시만 기다려 주세요..."\n}';

  setOperationStatus(els.extractMode.value === 'fast' ? '내용 추출 중' : 'Hybrid OCR/Formula 서버 준비 중');
  showSidePanel('extractPanel');
  try {
    const result = await requestJson(`/api/extract/${state.document.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisMode: els.extractMode.value,
        pages: els.extractPages.value.trim(),
        markdownWithHtml: true,
        imageOutput: els.extractMode.value === 'fast' ? 'off' : 'external',
      }),
    });

    els.markdownOutput.value = result.markdown || '';
    els.jsonOutput.value = JSON.stringify(result.json || {}, null, 2);
    setOperationStatus(`${result.mode === 'hybrid-ocr-formula' ? 'Hybrid OCR/Formula ' : ''}추출 완료: ${Number(result.summary?.elements || 0)}개 요소`);
    showToast('Markdown/JSON 추출이 완료되었습니다.');
  } catch (error) {
    els.markdownOutput.value = '';
    els.jsonOutput.value = '';
    showToast(error.message, true);
    setOperationStatus('추출 실패');
  }
}

async function currentPdfFile() {
  if (state.currentBlob) {
    return new File([state.currentBlob], state.currentFilename || 'document.pdf', { type: 'application/pdf' });
  }
  if (!state.document?.url) {
    throw new Error('작업할 PDF가 없습니다.');
  }
  const response = await fetch(state.document.url);
  if (!response.ok) throw new Error('현재 PDF를 준비하지 못했습니다.');
  const blob = await response.blob();
  return new File([blob], state.currentFilename || 'document.pdf', { type: 'application/pdf' });
}

function updatePrintScope() {
  const scope = els.printScope?.value || 'all';
  if (!els.printPages) return;
  els.printPages.disabled = scope !== 'range';
  els.printPages.placeholder = scope === 'current' ? `현재 ${state.page || 1}쪽` : '예: 1-3, 5';
  if (scope !== 'range') els.printPages.value = '';
}

function openPrintDialog(focusId) {
  if (!state.pdf && !state.document?.url && !state.currentBlob) {
    showToast('먼저 PDF를 열어야 인쇄할 수 있습니다.', true);
    return;
  }
  updatePrintScope();
  els.printDialog.classList.remove('hidden');
  els.printDialog.classList.add('is-open');
  document.body.classList.add('modal-open');
  refreshIcons();
  focusPanelControl(focusId || 'runPrintBtn');
}

function closePrintDialog() {
  els.printDialog.classList.add('hidden');
  els.printDialog.classList.remove('is-open');
  if (els.saveDialog.classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
}

function printFormPages() {
  const scope = els.printScope.value;
  if (scope === 'current') return String(state.page || 1);
  if (scope === 'range') {
    const pages = els.printPages.value.trim();
    if (!pages) throw new Error('인쇄할 페이지 범위를 입력하세요.');
    return pages;
  }
  return '';
}

async function createPrintLayoutBlob() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('pages', printFormPages());
  form.append('pagesPerSheet', els.printPagesPerSheet.value);
  form.append('orientation', els.printOrientation.value);
  form.append('paper', els.printPaper.value);
  form.append('marginMm', els.printMargin.value);
  form.append('duplex', els.printDuplex.value);
  form.append('copies', els.printCopies.value);
  form.append('fitMode', els.printFitMode.value);
  form.append('reverse', String(els.printReverse.checked));
  form.append('border', String(els.printBorder.checked));

  const response = await fetch('/api/pdf/print-layout', { method: 'POST', body: form });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const error = await response.json();
      message = error.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    filename: filenameFromResponse(response) || `${safeClientBaseName(state.currentFilename || file.name)}-print.pdf`,
  };
}

function safeClientBaseName(filename) {
  return String(filename || 'document.pdf').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document';
}

function printCssPageSize() {
  const paper = els.printPaper.value === 'letter' ? 'Letter' : (els.printPaper.value === 'legal' ? 'Legal' : 'A4');
  const orientation = els.printOrientation.value === 'landscape' ? 'landscape' : 'portrait';
  return `${paper} ${orientation}`;
}

function clientPrintSheetPoints() {
  const sizes = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
  };
  let [width, height] = sizes[els.printPaper.value] || sizes.a4;
  if (els.printOrientation.value === 'landscape') [width, height] = [height, width];
  return { width, height };
}

function printSheetCssSize() {
  const orientation = els.printOrientation.value === 'landscape' ? 'landscape' : 'portrait';
  const sizes = {
    a4: ['210mm', '297mm'],
    letter: ['8.5in', '11in'],
    legal: ['8.5in', '14in'],
  };
  let [width, height] = sizes[els.printPaper.value] || sizes.a4;
  if (orientation === 'landscape') [width, height] = [height, width];
  return { width, height };
}

function setPrintPageStyle() {
  let style = document.getElementById('dynamicPrintPageStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dynamicPrintPageStyle';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${printCssPageSize()}; margin: 0; }`;
}

function cleanupBrowserPrint() {
  document.body.classList.remove('is-printing-document');
  els.printRenderHost.innerHTML = '';
  els.printRenderHost.style.removeProperty('--print-sheet-width');
  els.printRenderHost.style.removeProperty('--print-sheet-height');
}

function parseClientPagesSpec(spec, pageCount) {
  const text = String(spec || '').trim();
  if (!text) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const selected = new Set();
  text.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, Math.min(pageCount, Number(range[1])));
      const end = Math.max(1, Math.min(pageCount, Number(range[2])));
      const step = start <= end ? 1 : -1;
      for (let page = start; step > 0 ? page <= end : page >= end; page += step) selected.add(page);
      return;
    }
    const single = Number(part);
    if (Number.isInteger(single) && single >= 1 && single <= pageCount) selected.add(single);
  });

  return Array.from(selected).sort((a, b) => a - b);
}

function clientPrintGrid() {
  const count = [1, 2, 4, 6, 9].includes(Number(els.printPagesPerSheet.value)) ? Number(els.printPagesPerSheet.value) : 1;
  const landscape = els.printOrientation.value === 'landscape';
  if (count === 1) return { cols: 1, rows: 1, count };
  if (count === 2) return landscape ? { cols: 2, rows: 1, count } : { cols: 1, rows: 2, count };
  if (count === 4) return { cols: 2, rows: 2, count };
  if (count === 6) return landscape ? { cols: 3, rows: 2, count } : { cols: 2, rows: 3, count };
  return { cols: 3, rows: 3, count };
}

function mmToPoints(mm) {
  return (Number(mm) || 0) * 72 / 25.4;
}

function findContentBounds(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const threshold = 246;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const index = row + x * 4;
      const alpha = data[index + 3];
      if (alpha > 8 && (data[index] < threshold || data[index + 1] < threshold || data[index + 2] < threshold)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width, height };
  const pad = Math.max(8, Math.round(Math.min(width, height) * 0.018));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function renderPageForPrint(pageNumber) {
  const page = await state.pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2.4 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const bounds = els.printFitMode.value === 'actual'
    ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
    : findContentBounds(canvas);
  return { canvas, bounds };
}

async function printCurrentDocument() {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js를 불러오지 못해 인쇄 화면을 만들 수 없습니다.');
  }
  if (!state.pdf) {
    throw new Error('먼저 PDF를 열어야 인쇄할 수 있습니다.');
  }

  const { width, height } = printSheetCssSize();
  els.printRenderHost.innerHTML = '';
  els.printRenderHost.style.setProperty('--print-sheet-width', width);
  els.printRenderHost.style.setProperty('--print-sheet-height', height);
  setPrintPageStyle();

  const pageNumbers = parseClientPagesSpec(printFormPages(), state.pageCount || state.pdf.numPages);
  if (!pageNumbers.length) throw new Error('인쇄할 페이지 범위가 올바르지 않습니다.');
  const orderedPages = els.printReverse.checked ? pageNumbers.slice().reverse() : pageNumbers;
  const copies = Math.max(1, Math.min(20, Number(els.printCopies.value || 1)));
  const pagesToPrint = [];
  for (let copy = 0; copy < copies; copy += 1) pagesToPrint.push(...orderedPages);

  const { width: sheetPtWidth, height: sheetPtHeight } = clientPrintSheetPoints();
  const { cols, rows, count } = clientPrintGrid();
  const sheetScale = 2.35;
  const margin = Math.max(0, Math.min(36, mmToPoints(els.printMargin.value || 8)));
  const gap = Math.max(0, Math.min(18, mmToPoints(3)));
  const usableWidth = sheetPtWidth - margin * 2 - gap * (cols - 1);
  const usableHeight = sheetPtHeight - margin * 2 - gap * (rows - 1);
  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;

  for (let start = 0; start < pagesToPrint.length; start += count) {
    const sheet = document.createElement('section');
    sheet.className = 'print-sheet';
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = Math.round(sheetPtWidth * sheetScale);
    sheetCanvas.height = Math.round(sheetPtHeight * sheetScale);
    sheetCanvas.setAttribute('aria-label', `${state.currentFilename || 'document.pdf'} ${Math.floor(start / count) + 1}`);
    const sheetContext = sheetCanvas.getContext('2d', { alpha: false });
    sheetContext.fillStyle = '#ffffff';
    sheetContext.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    sheet.appendChild(sheetCanvas);
    els.printRenderHost.appendChild(sheet);

    const chunk = pagesToPrint.slice(start, start + count);
    for (let slot = 0; slot < chunk.length; slot += 1) {
      const { canvas: pageCanvas, bounds } = await renderPageForPrint(chunk[slot]);
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const cellX = margin + col * (cellWidth + gap);
      const cellY = margin + row * (cellHeight + gap);
      const scale = Math.min(cellWidth / bounds.width, cellHeight / bounds.height);
      const drawWidth = bounds.width * scale;
      const drawHeight = bounds.height * scale;
      const x = (cellX + (cellWidth - drawWidth) / 2) * sheetScale;
      const y = (cellY + (cellHeight - drawHeight) / 2) * sheetScale;

      if (els.printBorder.checked) {
        sheetContext.strokeStyle = '#cbd5e1';
        sheetContext.lineWidth = Math.max(1, sheetScale * 0.5);
        sheetContext.strokeRect(cellX * sheetScale, cellY * sheetScale, cellWidth * sheetScale, cellHeight * sheetScale);
      }

      sheetContext.drawImage(
        pageCanvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        x,
        y,
        drawWidth * sheetScale,
        drawHeight * sheetScale,
      );
    }
  }

  document.body.classList.add('is-printing-document');
  window.addEventListener('afterprint', cleanupBrowserPrint, { once: true });
  window.setTimeout(cleanupBrowserPrint, 300000);
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  window.print();
}

async function runPrintJob({ downloadOnly = false } = {}) {
  setOperationStatus(downloadOnly ? '인쇄용 PDF 생성 중' : '인쇄 준비 중');
  try {
    if (downloadOnly) {
      const { blob, filename } = await createPrintLayoutBlob();
      const saved = await saveBlobAs(blob, filename, { rememberDocumentHandle: false });
      if (saved) {
        setOperationStatus('인쇄용 PDF 저장 완료');
        showToast('인쇄용 PDF를 저장했습니다.');
        closePrintDialog();
      } else {
        setOperationStatus('인쇄용 PDF 저장 취소');
      }
      return;
    }

    closePrintDialog();
    await printCurrentDocument();
    const duplexText = els.printDuplex.value === 'simplex' ? '단면' : '양면';
    setOperationStatus('인쇄창 열기');
    showToast(`${duplexText} 설정은 열린 인쇄창에서 최종 확인하세요.`);
  } catch (error) {
    setOperationStatus('인쇄 준비 실패');
    showToast(error.message, true);
  }
}

async function applyTextAnnotation() {
  const textVal = els.editText.value.trim();
  if (!textVal) {
    showToast('삽입할 텍스트 내용을 입력해주세요.', true);
    return;
  }

  const pageNum = Number(els.editPage.value) || state.page;
  const x = Number(els.editX.value) || 72;
  const y = Number(els.editY.value) || 720;
  const fontSize = Number(els.editFontSize.value) || 14;
  const color = els.editColor.value || '#111827';

  const textId = 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_text';
  const textAnn = {
    id: textId,
    type: 'text',
    page: pageNum,
    x: x,
    y: y,
    width: 150,
    height: fontSize * 1.2,
    text: textVal,
    fontSize: fontSize,
    fontFamily: (els.editFontFamily && els.editFontFamily.value) || 'malgun',
    color: color,
    italic: false,
    underline: false,
    strikethrough: false
  };

  state.annotations.push(textAnn);
  
  state.editModeActive = true;
  els.editOverlay.classList.remove('hidden');
  renderAnnotationsOnOverlay();
  
  els.editText.value = '';
  showToast('텍스트가 삽입되었습니다. 마우스로 드래그하여 이동할 수 있습니다.');
}

async function applyWatermark() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('text', els.watermarkText.value);
  form.append('fontSize', els.watermarkSize.value);
  form.append('opacity', els.watermarkOpacity.value);
  form.append('angle', els.watermarkAngle.value);
  form.append('pages', els.watermarkPages.value);
  await runPdfOperation('/api/pdf/watermark', form, '워터마크');
}

async function extractPages() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('pages', els.pageRangeInput.value);
  await runPdfOperation('/api/pdf/extract-pages', form, '페이지 추출');
}

async function splitPdf() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('ranges', els.pageRangeInput.value.replace(/\s*,\s*/g, ';') || '');
  await runPdfOperation('/api/pdf/split', form, 'PDF 분할', { previewPdf: false });
}

async function rotatePdf() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('pages', els.pageRangeInput.value);
  form.append('degrees', els.rotateDegrees.value);
  await runPdfOperation('/api/pdf/rotate', form, '페이지 회전');
}

async function mergePdfs() {
  const files = Array.from(els.mergeFilesInput.files || []);
  if (files.length < 2) {
    showToast('병합할 PDF를 2개 이상 선택하세요.', true);
    return;
  }
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  await runPdfOperation('/api/pdf/merge', form, 'PDF 병합');
}

async function imagesToPdf() {
  const files = Array.from(els.imageFilesInput.files || []);
  if (!files.length) {
    showToast('변환할 이미지를 선택하세요.', true);
    return;
  }
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  await runPdfOperation('/api/pdf/images-to-pdf', form, '이미지 PDF 변환');
}

async function compressPdf() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('level', els.compressLevel.value);
  await runPdfOperation('/api/pdf/compress', form, 'PDF 압축');
}

async function encryptPdf() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('userPassword', els.encryptUserPassword.value);
  form.append('ownerPassword', els.encryptOwnerPassword.value);
  await runPdfOperation('/api/pdf/encrypt', form, '암호 설정', { previewPdf: false });
}

async function decryptPdf() {
  const file = await currentPdfFile();
  const form = new FormData();
  form.append('file', file);
  form.append('password', els.decryptPassword.value);
  await runPdfOperation('/api/pdf/decrypt', form, '암호 해제');
}

async function runPdfOperationLegacy(url, form, label, options = {}) {
  const previewPdf = options.previewPdf !== false;
  const downloadResult = options.downloadResult !== false;
  setOperationStatus(`${label} 실행 중`);
  try {
    const response = await fetch(url, { method: 'POST', body: form });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const error = await response.json();
        message = error.error || message;
      } catch {
        message = await response.text();
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const filename = filenameFromResponse(response) || `${label}.pdf`;
    if (downloadResult) downloadBlob(blob, filename);
    if (previewPdf && blob.type.includes('pdf')) {
      await loadPdfFromBlob(blob, options.previewFilename || filename);
    }
    setOperationStatus(`${label} 완료`);
    showToast(`${label} 완료`);
  } catch (error) {
    setOperationStatus(`${label} 실패`);
    showToast(error.message, true);
  }
}

function operationStageIconName(stage) {
  if (stage === 'success') return 'circle-check';
  if (stage === 'error') return 'triangle-alert';
  if (stage === 'warning') return 'circle-x';
  return 'loader-circle';
}

function clearOperationStageTimer() {
  if (state.operationStageTimer) {
    window.clearTimeout(state.operationStageTimer);
    state.operationStageTimer = null;
  }
}

function showOperationStage(stage, title, detail, progress = 0, action = '') {
  if (!els.operationStateCard) return;
  clearOperationStageTimer();
  state.operationStageState = stage;
  els.operationStateCard.classList.remove('hidden');
  els.operationStateCard.dataset.state = stage;
  els.operationStateCard.setAttribute('aria-busy', String(stage === 'progress'));
  els.operationStateTitle.textContent = title || '작업 상태';
  els.operationStateDetail.textContent = detail || '';
  if (els.operationStateProgress) {
    const value = Number(progress);
    els.operationStateProgress.value = Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : 0;
    els.operationStateProgress.setAttribute('aria-valuetext', `${Math.round(els.operationStateProgress.value)}%`);
  }
  if (els.operationStateAction) {
    const hasAction = Boolean(action);
    els.operationStateAction.classList.toggle('hidden', !hasAction);
    els.operationStateAction.textContent = action === 'retry' ? '다시 시도' : '작업 취소';
    els.operationStateAction.setAttribute('aria-label', action === 'retry' ? '작업 다시 시도' : '작업 취소');
    els.operationStateAction.dataset.action = action || '';
    els.operationStateAction.disabled = false;
  }
  const icon = els.operationStateIcon?.querySelector('[data-lucide]');
  if (icon) icon.setAttribute('data-lucide', operationStageIconName(stage));
  refreshIcons();
}

function hideOperationStage() {
  clearOperationStageTimer();
  state.operationStageState = 'idle';
  if (!els.operationStateCard) return;
  els.operationStateCard.classList.add('hidden');
  els.operationStateCard.dataset.state = 'neutral';
  els.operationStateCard.setAttribute('aria-busy', 'false');
  if (els.operationStateAction) {
    els.operationStateAction.classList.add('hidden');
    els.operationStateAction.dataset.action = '';
    els.operationStateAction.setAttribute('aria-label', '작업 취소');
  }
}

function scheduleOperationStageHide(delay = 2800) {
  clearOperationStageTimer();
  state.operationStageTimer = window.setTimeout(() => {
    state.operationStageTimer = null;
    hideOperationStage();
  }, delay);
}

function showPdfOperationFailure(label, error) {
  const canceled = error?.name === 'AbortError' || error?.canceled;
  const canRetry = Boolean(state.lastFailedPdfOperation);
  const progress = error?.progress ?? els.operationStateProgress?.value ?? els.operationProgress?.value ?? 0;
  const detail = canceled
    ? (canRetry ? '작업을 다시 시도할 수 있습니다.' : '작업을 취소했습니다.')
    : (canRetry ? '작업을 다시 시도할 수 있습니다.' : (error?.message || '작업 중 오류가 발생했습니다.'));
  showOperationStage(
    canceled ? 'warning' : 'error',
    `${label} ${canceled ? '취소됨' : '실패'}`,
    detail,
    progress,
    canRetry ? 'retry' : '',
  );
  if (!canRetry) scheduleOperationStageHide(canceled ? 2600 : 4200);
}

function setPdfOperationControl(mode) {
  if (els.cancelOperationBtn) {
    const visible = mode === 'cancel' || mode === 'retry';
    els.cancelOperationBtn.classList.toggle('hidden', !visible);
    els.cancelOperationBtn.disabled = !visible;
    els.cancelOperationBtn.textContent = mode === 'retry' ? '다시 시도' : '작업 취소';
  }
  if (els.operationProgress) {
    els.operationProgress.classList.toggle('hidden', mode === 'hidden');
    if (mode === 'hidden') els.operationProgress.value = 0;
  }
  if (mode === 'cancel') {
    showOperationStage(
      'progress',
      state.pdfOperationLabel || 'PDF 작업',
      '서버 작업 큐에서 처리 중입니다.',
      els.operationProgress?.value || 0,
      'cancel',
    );
  } else if (mode === 'retry') {
    if (state.operationStageState !== 'error' && state.operationStageState !== 'warning') {
      showOperationStage(
        'error',
        state.pdfOperationLabel || 'PDF 작업',
        '작업을 다시 시도할 수 있습니다.',
        els.operationProgress?.value || 0,
        'retry',
      );
    } else if (els.operationStateAction) {
      els.operationStateAction.classList.remove('hidden');
      els.operationStateAction.textContent = '다시 시도';
      els.operationStateAction.setAttribute('aria-label', '작업 다시 시도');
      els.operationStateAction.dataset.action = 'retry';
    }
  } else if (mode === 'hidden' && state.operationStageState === 'progress') {
    hideOperationStage();
  }
}

function setPdfOperationActive(active) {
  setPdfOperationControl(active ? 'cancel' : 'hidden');
}

function setPdfOperationProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return;
  const normalized = Math.max(0, Math.min(100, value));
  if (els.operationProgress) els.operationProgress.value = normalized;
  if (els.operationStateProgress) {
    els.operationStateProgress.value = normalized;
    els.operationStateProgress.setAttribute('aria-valuetext', `${Math.round(normalized)}%`);
  }
}

async function cancelPdfOperation() {
  const jobId = state.pdfOperationJobId;
  const controller = state.pdfOperationAbortController;
  if (!jobId && !controller && state.lastFailedPdfOperation) {
    await retryPdfOperation();
    return;
  }

  if (jobId) {
    try {
      const job = await requestJson('/api/jobs/' + encodeURIComponent(jobId) + '/cancel', {
        method: 'POST',
      });
      if (job?.status === 'completed') return;
      setOperationStatus('작업 취소 요청 중');
    } catch (error) {
      showToast(error.message || '작업 취소 요청에 실패했습니다.', true);
      return;
    }
  }
  if (controller) controller.abort();
}

async function runPdfOperationHttp(url, form, label, options = {}) {
  const previewPdf = options.previewPdf !== false;
  const downloadResult = options.downloadResult !== false;
  const controller = new AbortController();
  state.pdfOperationAbortController = controller;
  state.pdfOperationLabel = label;
  setPdfOperationActive(true);
  setOperationStatus(label + ' 실행 중');

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const error = await response.json();
        message = error.error || message;
        if (error.requestId) message += ' (요청 ID: ' + error.requestId + ')';
      } catch {
        message = await response.text();
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const filename = filenameFromResponse(response) || label + '.pdf';
    if (downloadResult) downloadBlob(blob, filename);
    if (previewPdf && blob.type.includes('pdf')) {
      await loadPdfFromBlob(blob, options.previewFilename || filename);
    }
    setOperationStatus(label + ' 완료');
    showOperationStage('success', `${label} 완료`, '문서 캔버스에 결과를 반영했습니다.', 100);
    scheduleOperationStageHide();
    showToast(label + ' 완료');
  } catch (error) {
    if (error.name === 'AbortError') {
      setOperationStatus(label + ' 취소됨');
      showOperationStage('warning', `${label} 취소됨`, '작업을 취소했습니다.', els.operationProgress?.value || 0);
      scheduleOperationStageHide(2600);
      showToast(label + ' 작업을 취소했습니다.');
    } else {
      setOperationStatus(label + ' 실패');
      showOperationStage('error', `${label} 실패`, error.message || '작업 중 오류가 발생했습니다.', els.operationProgress?.value || 0);
      scheduleOperationStageHide(4200);
      showToast(error.message || label + ' 작업에 실패했습니다.', true);
    }
  } finally {
    if (state.pdfOperationAbortController === controller) {
      state.pdfOperationAbortController = null;
      setPdfOperationActive(false);
    }
  }
}

async function readPdfOperationError(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const error = new Error(data?.error || text || response.statusText || '작업 결과를 가져오지 못했습니다.');
  error.status = response.status;
  error.requestId = data?.requestId || '';
  return error;
}

function waitForPdfOperationPoll(signal) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      const error = new Error('작업 상태 확인이 취소되었습니다.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 500);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function monitorPdfJob(jobId, label, previewPdf, signal, options = {}) {
  const downloadResult = options.downloadResult !== false;
  const previewFilename = options.previewFilename || '';
  while (true) {
    const job = await requestJson('/api/jobs/' + encodeURIComponent(jobId), { signal });
    setPdfOperationProgress(job.progress || 0);
    setOperationStatus(label + ' ' + Math.round(Number(job.progress || 0)) + '% · ' + (job.message || '처리 중'));

    if (job.status === 'completed') {
      const resultUrl = job.resultUrl || '/api/jobs/' + encodeURIComponent(jobId) + '/result';
      const response = await fetch(resultUrl, { signal });
      if (!response.ok) throw await readPdfOperationError(response);
      const blob = await response.blob();
      const filename = filenameFromResponse(response) || label + '.pdf';
      if (downloadResult) downloadBlob(blob, filename);
      if (previewPdf && blob.type.includes('pdf')) {
        await loadPdfFromBlob(blob, previewFilename || filename);
      }
      setOperationStatus(label + ' 완료');
      showOperationStage('success', `${label} 완료`, '문서 캔버스에 결과를 반영했습니다.', 100);
      scheduleOperationStageHide();
      showToast(label + ' 완료');
      return job;
    }

    if (job.status === 'failed' || job.status === 'canceled') {
      const error = new Error(job.error?.message || job.message || label + ' 작업에 실패했습니다.');
      error.jobId = jobId;
      error.code = job.status === 'canceled' ? 'JOB_CANCELED' : 'JOB_FAILED';
      error.retryable = Boolean(job.canRetry);
      error.progress = Number(job.progress || 0);
      error.canceled = job.status === 'canceled';
      throw error;
    }

    await waitForPdfOperationPoll(signal);
  }
}

async function runPdfOperation(url, form, label, options = {}) {
  const previewPdf = options.previewPdf !== false;
  const operationOptions = {
    downloadResult: options.downloadResult !== false,
    previewFilename: options.previewFilename || '',
  };
  const controller = new AbortController();
  state.pdfOperationAbortController = controller;
  state.pdfOperationLabel = label;
  state.pdfOperationJobId = '';
  state.lastFailedPdfOperation = null;
  updateHistoryButtons();
  setPdfOperationControl('cancel');
  setPdfOperationProgress(0);
  setOperationStatus(label + ' 대기 중');

  let jobId = '';
  let historySnapshot = null;
  try {
    if (options.recordHistory) historySnapshot = await captureCurrentPdfSnapshot();
    const job = await requestJson(url, {
      method: 'POST',
      body: form,
      headers: { 'X-JamePDF-Async': '1' },
      signal: controller.signal,
    });
    jobId = String(job?.jobId || '');
    if (!jobId) throw new Error('작업 ID를 받지 못했습니다.');
    state.pdfOperationJobId = jobId;
    setPdfOperationProgress(job.progress || 0);
    await monitorPdfJob(jobId, label, previewPdf, controller.signal, operationOptions);
    if (historySnapshot) pushUndoSnapshot(historySnapshot);
    if (options.markDirty) setDocumentDirty(true);
    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (jobId) {
        state.lastFailedPdfOperation = { jobId, label, previewPdf, ...operationOptions };
      }
      setOperationStatus(label + ' 취소됨');
      showToast(label + ' 작업이 취소되었습니다.');
    } else if (error.canceled) {
      if (error.jobId && error.retryable) {
        state.lastFailedPdfOperation = {
          jobId: error.jobId,
          label,
          previewPdf,
          ...operationOptions,
        };
      }
      setOperationStatus(label + ' 취소됨');
      showToast(label + ' 작업이 취소되었습니다.');
    } else {
      if (error.jobId && error.retryable) {
        state.lastFailedPdfOperation = {
          jobId: error.jobId,
          label,
          previewPdf,
          ...operationOptions,
          progress: error.progress || 0,
        };
        setPdfOperationProgress(error.progress || 0);
      }
      setOperationStatus(label + ' 실패');
      showToast(error.message || label + ' 작업에 실패했습니다.', true);
    }
    showPdfOperationFailure(label, error);
    return false;
  } finally {
    if (state.pdfOperationAbortController === controller) {
      state.pdfOperationAbortController = null;
      state.pdfOperationJobId = '';
      setPdfOperationControl(state.lastFailedPdfOperation ? 'retry' : 'hidden');
      updateHistoryButtons();
    }
  }
}

async function retryPdfOperation() {
  const previous = state.lastFailedPdfOperation;
  if (!previous?.jobId) return;

  const controller = new AbortController();
  state.pdfOperationAbortController = controller;
  state.pdfOperationJobId = previous.jobId;
  state.pdfOperationLabel = previous.label;
  state.lastFailedPdfOperation = null;
  updateHistoryButtons();
  setPdfOperationControl('cancel');
  setOperationStatus(previous.label + ' 재시도 대기 중');

  let jobId = previous.jobId;
  try {
    const job = await requestJson('/api/jobs/' + encodeURIComponent(previous.jobId) + '/retry', {
      method: 'POST',
      signal: controller.signal,
    });
    jobId = String(job?.jobId || previous.jobId);
    state.pdfOperationJobId = jobId;
    setPdfOperationProgress(job.progress || 0);
    await monitorPdfJob(jobId, previous.label, previous.previewPdf, controller.signal, {
      downloadResult: previous.downloadResult !== false,
      previewFilename: previous.previewFilename || '',
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      state.lastFailedPdfOperation = { ...previous, jobId };
      setOperationStatus(previous.label + ' 취소됨');
      showToast(previous.label + ' 작업이 취소되었습니다.');
    } else if (error.canceled) {
      if (error.jobId && error.retryable) {
        state.lastFailedPdfOperation = { ...previous, jobId: error.jobId };
      }
      setOperationStatus(previous.label + ' 취소됨');
      showToast(previous.label + ' 작업이 취소되었습니다.');
    } else {
      if (error.jobId && error.retryable) {
        state.lastFailedPdfOperation = {
          ...previous,
          jobId: error.jobId,
          progress: error.progress || 0,
        };
      } else if (!error.jobId) {
        state.lastFailedPdfOperation = previous;
      }
      setOperationStatus(previous.label + ' 실패');
      showToast(error.message || previous.label + ' 재시도에 실패했습니다.', true);
    }
    showPdfOperationFailure(previous.label, error);
  } finally {
    if (state.pdfOperationAbortController === controller) {
      state.pdfOperationAbortController = null;
      state.pdfOperationJobId = '';
      setPdfOperationControl(state.lastFailedPdfOperation ? 'retry' : 'hidden');
    }
  }
}

async function writeBlobToHandle(handle, blob) {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

async function saveBlobThroughServer(blob, suggestedName, options = {}) {
  const form = new FormData();
  form.append('file', new File([blob], suggestedName || 'document.pdf', { type: 'application/pdf' }));
  form.append('suggestedName', suggestedName || 'document.pdf');
  if (options.targetToken) form.append('targetToken', options.targetToken);

  const response = await fetch('/api/system/save-file', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (result.fallback === 'download') return { saved: false, fallback: true };
    throw new Error(result.error || response.statusText);
  }
  return result;
}

async function saveBlobAs(blob, suggestedName, options = {}) {
  const filename = suggestedName || 'document.pdf';
  try {
    const result = await saveBlobThroughServer(blob, filename);
    if (result.saved) {
      if (options.rememberDocumentHandle) {
        state.saveToken = result.targetToken || '';
        state.currentFilename = result.filename || filename;
        els.documentName.textContent = state.currentFilename;
      }
      return true;
    }
    if (result.canceled) return false;
    if (!result.fallback) return false;
  } catch (error) {
    if (!window.showSaveFilePicker) throw error;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'PDF 문서',
          accept: { 'application/pdf': ['.pdf'] },
        }],
      });
      await writeBlobToHandle(handle, blob);
      if (options.rememberDocumentHandle) {
        state.saveHandle = handle;
        state.saveToken = '';
        state.currentFilename = handle.name || filename;
        els.documentName.textContent = state.currentFilename;
      }
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      throw error;
    }
  }

  downloadBlob(blob, filename);
  return true;
}

async function editedPdfFile() {
  const originalFile = await currentPdfFile();
  if (state.annotations.length === 0) {
    return originalFile;
  }

  setOperationStatus('편집 내용 반영 중');
  const form = new FormData();
  form.append('file', originalFile);
  form.append('annotations', JSON.stringify(state.annotations));

  const response = await fetch('/api/pdf/edit', {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const error = await response.json();
      message = error.error || message;
    } catch {}
    throw new Error('편집 내용 반영 실패: ' + message);
  }

  const blob = await response.blob();
  return new File([blob], state.currentFilename || 'document.pdf', { type: 'application/pdf' });
}

async function saveCurrentPdf(mode = 'current') {
  try {
    const file = await editedPdfFile();
    const filename = state.currentFilename || file.name || 'document.pdf';

    if (mode === 'saveAs') {
      const saved = await saveBlobAs(file, filename, { rememberDocumentHandle: true });
      if (saved) {
        state.currentBlob = file;
        setDocumentDirty(false);
        setOperationStatus('다른 이름으로 저장 완료');
        showToast('파일을 저장했습니다.');
        closeSaveDialog();
        // 편집 적용 후 리로드
        state.annotations = [];
        deselectActiveAnnotation();
        await loadPdfFromBlob(file, filename);
      } else {
        setOperationStatus('저장 취소');
      }
      return;
    }

    if (state.saveToken) {
      const result = await saveBlobThroughServer(file, filename, { targetToken: state.saveToken });
      if (result.saved) {
        state.currentFilename = result.filename || filename;
        els.documentName.textContent = state.currentFilename;
        state.currentBlob = file;
        setDocumentDirty(false);
        setOperationStatus('현재 위치에 저장 완료');
        showToast('현재 위치에 저장했습니다.');
        closeSaveDialog();
        // 편집 적용 후 리로드
        state.annotations = [];
        deselectActiveAnnotation();
        await loadPdfFromBlob(file, filename);
        return;
      }
      if (result.canceled) {
        setOperationStatus('저장 취소');
        return;
      }
    }

    if (state.saveHandle) {
      await writeBlobToHandle(state.saveHandle, file);
      state.currentBlob = file;
      setDocumentDirty(false);
      setOperationStatus('현재 위치에 저장 완료');
      showToast('현재 위치에 저장했습니다.');
      closeSaveDialog();
      // 편집 적용 후 리로드
      state.annotations = [];
      deselectActiveAnnotation();
      await loadPdfFromBlob(file, filename);
      return;
    }

    const saved = await saveBlobAs(file, filename, { rememberDocumentHandle: true });
    if (saved) {
      state.currentBlob = file;
      setDocumentDirty(false);
      setOperationStatus('현재 위치에 저장 완료');
      showToast('파일을 저장했습니다.');
      closeSaveDialog();
      // 편집 적용 후 리로드
      state.annotations = [];
      deselectActiveAnnotation();
      await loadPdfFromBlob(file, filename);
    } else {
      setOperationStatus('저장 취소');
    }
  } catch (error) {
    setOperationStatus('저장 실패');
    showToast(error.message, true);
  }
}

function updateCommandbarContext(tabName) {
  const meta = COMMAND_CONTEXT_META[tabName] || COMMAND_CONTEXT_META.file;
  document.querySelectorAll('[data-command-context]').forEach((group) => {
    group.classList.toggle('is-active', group.dataset.commandContext === tabName);
  });
  if (els.commandbarContextTitle) els.commandbarContextTitle.textContent = meta.title;
  if (els.commandbarContextNote) els.commandbarContextNote.textContent = meta.note;
  if (els.commandbarContext) els.commandbarContext.dataset.context = tabName;
}

function initRibbonDensity() {
  let compact = false;
  try {
    compact = window.localStorage.getItem(RIBBON_DENSITY_PREF_KEY) === 'true';
  } catch {
    compact = false;
  }
  setRibbonCompact(compact, { persist: false });
}

function setRibbonCompact(compact, options = {}) {
  state.ribbonCompact = Boolean(compact);
  const app = document.querySelector('.app');
  if (app) app.classList.toggle('ribbon-compact', state.ribbonCompact);

  if (els.ribbonDensityBtn) {
    const label = state.ribbonCompact ? '\ud45c\uc900' : '\uac04\uacb0';
    const title = state.ribbonCompact ? '\ub9ac\ubcf8 \uba54\ub274\ub97c \uae30\ubcf8 \ud06c\uae30\ub85c \ud45c\uc2dc' : '\ub9ac\ubcf8 \uba54\ub274\ub97c \uac04\uacb0\ud558\uac8c \ud45c\uc2dc';
    els.ribbonDensityBtn.setAttribute('aria-pressed', String(state.ribbonCompact));
    els.ribbonDensityBtn.setAttribute('title', title);
    const labelElement = els.ribbonDensityBtn.querySelector('span');
    if (labelElement) labelElement.textContent = label;
  }

  if (options.persist !== false) {
    try {
      window.localStorage.setItem(RIBBON_DENSITY_PREF_KEY, String(state.ribbonCompact));
    } catch {
      // Ignore storage failures; density still applies for this session.
    }
  }
}

function showRibbonTab(tabName, options = {}) {
  if (!tabName) return;

  document.querySelectorAll('[data-ribbon-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.ribbonTab === tabName);
  });
  document.querySelectorAll('[data-ribbon-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.ribbonPanel === tabName);
  });

  if (options.syncPanel && RIBBON_TAB_TO_PANEL[tabName]) {
    showSidePanel(RIBBON_TAB_TO_PANEL[tabName], { syncRibbon: false });
  }
  updateCommandbarContext(tabName);
  refreshIcons();
}

function focusPanelControl(controlId) {
  if (!controlId) return;
  window.requestAnimationFrame(() => {
    const control = document.getElementById(controlId);
    if (control && typeof control.focus === 'function') control.focus();
  });
}

function openSaveDialog() {
  if (!state.pdf && !state.document?.url && !state.currentBlob) {
    showToast('먼저 PDF를 열어야 저장할 수 있습니다.', true);
    return;
  }
  els.saveDialog.classList.remove('hidden');
  els.saveDialog.classList.add('is-open');
  document.body.classList.add('modal-open');
  refreshIcons();
  focusPanelControl(state.saveHandle ? 'saveCurrentLocationBtn' : 'saveAsBtn');
}

function closeSaveDialog() {
  els.saveDialog.classList.add('hidden');
  els.saveDialog.classList.remove('is-open');
  if (els.printDialog.classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
}

function showSidePanel(panelId, options = {}) {
  document.querySelectorAll('.panel-tabs button').forEach((button) => {
    const isActive = button.dataset.sideTab === panelId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.side-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === panelId);
  });

  if (options.syncRibbon !== false && PANEL_TO_RIBBON_TAB[panelId]) {
    showRibbonTab(PANEL_TO_RIBBON_TAB[panelId], { syncPanel: false });
  }
  refreshIcons();
}

function initRightbarToggle() {
  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(RIGHTBAR_PREF_KEY) === 'true';
  } catch {
    collapsed = false;
  }
  setRightbarCollapsed(collapsed, { persist: false });
}

function rightbarWidthLimit() {
  const workspace = document.querySelector('.workspace');
  const workspaceWidth = workspace?.clientWidth || window.innerWidth;
  const maxAvailable = workspaceWidth - 154 - 700 - 16;
  return Math.max(RIGHTBAR_MIN_WIDTH, Math.min(RIGHTBAR_MAX_WIDTH, maxAvailable));
}

function setRightbarWidth(width, options = {}) {
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;
  const maxWidth = rightbarWidthLimit();
  const requested = Number(width);
  const nextWidth = Math.round(Math.max(
    RIGHTBAR_MIN_WIDTH,
    Math.min(maxWidth, Number.isFinite(requested) ? requested : RIGHTBAR_DEFAULT_WIDTH),
  ));
  state.rightbarWidth = nextWidth;
  workspace.style.setProperty('--rightbar-width', `${nextWidth}px`);

  if (els.rightbarResizeHandle) {
    els.rightbarResizeHandle.setAttribute('aria-valuenow', String(nextWidth));
    els.rightbarResizeHandle.setAttribute('aria-valuetext', `${nextWidth}px`);
  }
  if (options.persist !== false) {
    try {
      window.localStorage.setItem(RIGHTBAR_WIDTH_PREF_KEY, String(nextWidth));
    } catch {
      // Ignore storage failures; resizing should still work for this session.
    }
  }
}

function initRightbarResize() {
  if (!els.rightbarResizeHandle) return;
  let storedWidth = RIGHTBAR_DEFAULT_WIDTH;
  try {
    const storedValue = window.localStorage.getItem(RIGHTBAR_WIDTH_PREF_KEY);
    const parsed = storedValue === null ? Number.NaN : Number(storedValue);
    if (Number.isFinite(parsed)) storedWidth = parsed;
  } catch {
    storedWidth = RIGHTBAR_DEFAULT_WIDTH;
  }
  setRightbarWidth(storedWidth, { persist: false });

  els.rightbarResizeHandle.addEventListener('pointerdown', startRightbarResize);
  els.rightbarResizeHandle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setRightbarWidth(state.rightbarWidth + step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setRightbarWidth(state.rightbarWidth - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setRightbarWidth(RIGHTBAR_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setRightbarWidth(RIGHTBAR_MAX_WIDTH);
    }
  });
  window.addEventListener('resize', () => {
    setRightbarWidth(state.rightbarWidth, { persist: false });
  });
}

function startRightbarResize(event) {
  if (state.rightbarCollapsed || !els.rightbarResizeHandle) return;
  event.preventDefault();
  const handle = els.rightbarResizeHandle;
  const pointerId = event.pointerId;
  let finished = false;

  const onMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    setRightbarWidth(window.innerWidth - moveEvent.clientX, { persist: false });
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    handle.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-rightbar');
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    setRightbarWidth(state.rightbarWidth);
  };

  handle.classList.add('is-dragging');
  document.body.classList.add('is-resizing-rightbar');
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.setPointerCapture?.(pointerId);
}

function setRightbarCollapsed(collapsed, options = {}) {
  state.rightbarCollapsed = Boolean(collapsed);
  const workspace = document.querySelector('.workspace');
  if (workspace) {
    workspace.classList.toggle('rightbar-collapsed', state.rightbarCollapsed);
  }
  document.body.classList.toggle('rightbar-collapsed', state.rightbarCollapsed);

  if (els.rightbarToggleBtn) {
    const label = state.rightbarCollapsed ? RIGHTBAR_LABEL_SHOW : RIGHTBAR_LABEL_HIDE;
    const iconName = state.rightbarCollapsed ? 'panel-right-open' : 'panel-right-close';
    els.rightbarToggleBtn.setAttribute('aria-label', label);
    els.rightbarToggleBtn.setAttribute('aria-pressed', String(state.rightbarCollapsed));
    els.rightbarToggleBtn.setAttribute('title', label);
    const icon = els.rightbarToggleBtn.querySelector('i');
    if (icon) icon.setAttribute('data-lucide', iconName);
  }
  if (els.rightbarResizeHandle) {
    els.rightbarResizeHandle.setAttribute('aria-hidden', String(state.rightbarCollapsed));
    els.rightbarResizeHandle.tabIndex = state.rightbarCollapsed ? -1 : 0;
  }

  if (options.persist !== false) {
    try {
      window.localStorage.setItem(RIGHTBAR_PREF_KEY, String(state.rightbarCollapsed));
    } catch {
      // Ignore storage failures; the toggle should still work for this session.
    }
  }

  refreshIcons();
  window.requestAnimationFrame(() => {
    if (state.editModeActive) updateEditOverlayGeometry();
    updateOcrOverlayBoxes();
  });
}

function showResultTab(tabName) {
  document.querySelectorAll('[data-result-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.resultTab === tabName);
  });
  els.markdownOutput.classList.toggle('hidden', tabName !== 'markdown');
  els.jsonOutput.classList.toggle('hidden', tabName !== 'json');
}

function updateStatus() {
  const pageLabel = `${state.page || 0} / ${state.pageCount || 0}`;
  const zoomLabel = `${Math.round(state.scale * 100)}%`;
  els.pageStatus.textContent = pageLabel;
  els.zoomStatus.textContent = zoomLabel;
  if (els.viewerDocumentName) {
    els.viewerDocumentName.textContent = state.currentFilename || '문서 없음';
  }
  if (els.viewerPageBadge) {
    els.viewerPageBadge.textContent = `페이지 ${pageLabel}`;
  }
  if (els.viewerZoomBadge) {
    els.viewerZoomBadge.textContent = zoomLabel;
  }
}

function setOperationStatus(text) {
  const value = String(text || '');
  els.operationStatus.textContent = value;
  let tone = 'neutral';
  if (/(실패|오류|error|failed)/i.test(value)) tone = 'error';
  else if (/(취소|cancel)/i.test(value)) tone = 'warning';
  else if (/(완료|저장됨|열림|success|ready)/i.test(value)) tone = 'success';
  else if (/(대기|중|처리|확인|준비|loading|progress)/i.test(value)) tone = 'progress';
  els.operationStatus.dataset.state = tone;
  if (state.operationStageState === 'progress' && els.operationStateDetail) {
    els.operationStateDetail.textContent = value;
  }
}

function aiDocumentContext() {
  const markdown = state.extractedMarkdown || els.markdownOutput?.value || '';
  const jsonText = els.jsonOutput?.value || '';
  const pageText = state.pageText || els.currentTextOutput?.value || '';
  return {
    documentName: state.currentFilename || els.documentName?.textContent || '',
    page: state.page || 0,
    pageCount: state.pageCount || 0,
    pageText: trimForPanelContext(pageText, 5000),
    markdown: trimForPanelContext(markdown, 12000),
    json: trimForPanelContext(jsonText, 6000),
  };
}

function trimForPanelContext(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[...trimmed ${text.length - maxChars} chars...]`;
}

function aiPresetPrompt(preset) {
  const hasDocument = Boolean(state.pdf || state.document || state.currentBlob);
  const target = hasDocument ? '현재 PDF' : '열린 PDF가 없으므로 사용 가능한 앱 상태';
  const prompts = {
    summarize: `${target}의 핵심 내용을 한국어로 간결하게 요약해줘. 중요한 표, 수식, 이미지 설명이 있으면 따로 표시해줘.`,
    organize: `${target}에서 제목, 주요 주장, 근거, 표/수식/이미지, 실행 항목을 구조화해서 정리해줘.`,
    question: '',
    suggest: `${target}를 바탕으로 다음에 하면 좋은 작업 5가지를 제안해줘. PDF 편집, 추출, 검토, 학습 활용 관점으로 나눠줘.`,
  };
  return prompts[preset] || '';
}

async function runAiPreset(preset) {
  showSidePanel('aiPanel');
  if (preset === 'question') {
    if (els.aiPrompt.value.trim()) {
      await runAiChat();
      return;
    }
    focusPanelControl('aiPrompt');
    showToast('질문을 입력한 뒤 질문 버튼이나 보내기를 누르세요.');
    return;
  }
  const prompt = aiPresetPrompt(preset);
  if (!prompt) return;
  els.aiPrompt.value = prompt;
  await runAiChat(prompt);
}

async function runAiChat(promptOverride) {
  if (state.aiAbortController) return;
  const prompt = String(promptOverride || els.aiPrompt.value || '').trim();
  if (!prompt) {
    showToast('AI에게 보낼 질문을 입력하세요.', true);
    focusPanelControl('aiPrompt');
    return;
  }

  const provider = els.aiProvider.value || 'codex';
  const model = els.aiModel.value.trim() || (provider === 'gemma' ? 'gemma4:e4b' : '');
  const modelLabel = els.aiModel.selectedOptions?.[0]?.textContent?.trim() || model || 'Auto';
  const promptForAi = `${prompt}\n\n[선택된 에이전트]\n${provider} / ${modelLabel}\n\n[응답 형식]\n- 답변은 한국어로 보기 좋게 정리하세요.\n- 비교, 점수, 항목별 정리, 추천 목록처럼 표가 더 읽기 좋은 내용은 Markdown 표로 작성하세요.\n- 굵게 표시가 필요한 제목은 **제목** 형식을 사용하세요.`;
  const abortController = new AbortController();
  state.aiAbortController = abortController;
  setAiSending(true);
  appendAiMessage('user', prompt);
  const pendingMessage = appendAiMessage('assistant', 'AI Agent가 PDF 컨텍스트를 읽고 답변을 준비하고 있습니다...', { pending: true });
  els.aiPrompt.value = '';
  setOperationStatus('AI Agent 실행 중');

  try {
    const result = await requestJson('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        model,
        prompt: promptForAi,
        context: aiDocumentContext(),
      }),
      signal: abortController.signal,
    });
    updateAiMessage(pendingMessage, result.output || '(응답 없음)');
    setOperationStatus(`AI 응답 완료: ${result.provider || provider}`);
    showToast('AI Agent 응답이 도착했습니다.');
  } catch (error) {
    if (abortController.signal.aborted) {
      updateAiMessage(pendingMessage, '요청이 중지되었습니다.', true);
      setOperationStatus('AI 요청 중지');
      showToast('AI 요청을 중지했습니다.');
    } else {
      updateAiMessage(pendingMessage, `AI Agent 오류\n\n${error.message}`, true);
      setOperationStatus('AI 응답 실패');
      showToast(error.message, true);
    }
  } finally {
    if (state.aiAbortController === abortController) {
      state.aiAbortController = null;
      setAiSending(false);
    }
    loadAiStatus();
  }
}

function setAiSending(isSending) {
  if (!els.aiSendBtn) return;
  els.aiSendBtn.classList.toggle('is-stopping', Boolean(isSending));
  els.aiSendBtn.title = isSending ? '중지' : '보내기';
  els.aiSendBtn.innerHTML = isSending ? '<i data-lucide="square"></i>' : '<i data-lucide="arrow-up"></i>';
  refreshIcons();
}

function appendAiMessage(role, text, options = {}) {
  if (!els.aiOutput) return null;
  const row = document.createElement('div');
  row.className = `ai-message ${role === 'user' ? 'is-user' : 'is-agent'}${options.pending ? ' is-pending' : ''}`;

  const meta = document.createElement('div');
  meta.className = 'ai-message-meta';
  meta.textContent = role === 'user' ? 'You' : 'AI Agent';

  const body = document.createElement('div');
  body.className = 'ai-message-body';
  setAiMessageBody(body, text, { rich: role !== 'user' && !options.pending });

  row.append(meta, body);
  els.aiOutput.appendChild(row);
  els.aiOutput.scrollTop = els.aiOutput.scrollHeight;
  return row;
}

function updateAiMessage(messageEl, text, isError = false) {
  if (!messageEl) return;
  messageEl.classList.remove('is-pending');
  messageEl.classList.toggle('is-error', Boolean(isError));
  const body = messageEl.querySelector('.ai-message-body');
  if (body) setAiMessageBody(body, text, { rich: messageEl.classList.contains('is-agent') && !isError });
  els.aiOutput.scrollTop = els.aiOutput.scrollHeight;
}

function clearAiConversation() {
  if (els.aiOutput) els.aiOutput.innerHTML = '';
}

function setAiMessageBody(body, text, options = {}) {
  body.classList.toggle('is-rich', Boolean(options.rich));
  if (!options.rich) {
    body.textContent = text;
    return;
  }
  body.innerHTML = renderAiMarkdown(text);
}

function renderAiMarkdown(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listType = null;

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      closeList();
      const tableRows = [parseMarkdownTableRow(lines[index])];
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        tableRows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push(renderAiTable(tableRows));
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${renderAiInlineMarkdown(numbered[1])}</li>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${renderAiInlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderAiInlineMarkdown(trimmed)}</p>`);
  }

  closeList();
  return html.join('');
}

function isMarkdownTableStart(lines, index) {
  const header = lines[index]?.trim() || '';
  const divider = lines[index + 1]?.trim() || '';
  return /^\|.+\|$/.test(header) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(divider);
}

function parseMarkdownTableRow(line = '') {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderAiTable(rows) {
  if (!rows.length) return '';
  const header = rows[0];
  const body = rows.slice(1);
  const headHtml = header.map((cell) => `<th>${renderAiInlineMarkdown(cell)}</th>`).join('');
  const bodyHtml = body.map((row) => `<tr>${row.map((cell) => `<td>${renderAiInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="ai-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderAiInlineMarkdown(text = '') {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<strong>$2</strong>');
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateSearchStatus() {
  const keyword = els.searchInput.value.trim();
  
  if (!keyword) {
    hideSearchWidget();
    return;
  }
  
  const widget = els.searchWidget;
  if (widget && widget.classList.contains('hidden')) {
    widget.classList.remove('hidden');
    refreshIcons();
  }

  els.widgetSearchInput.value = els.searchInput.value; // 공백 포함 원본 전송
  runWidgetSearch();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const error = new Error(data?.error || response.statusText);
    error.status = response.status;
    error.requestId = data?.requestId || '';
    error.data = data;
    throw error;
  }
  return data;
}

async function copyText(text, message) {
  if (!text) {
    showToast('복사할 내용이 없습니다.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showToast(message || '복사했습니다.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600);
}

function filenameFromResponse(response) {
  const disposition = response.headers.get('Content-Disposition') || '';
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : '';
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', Boolean(isError));
  els.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
  }, 2800);
}

/* -------------------------------------------------------------
 * PDF rich editor & drag-OCR core logic
 * ------------------------------------------------------------- */
function setupEditOverlay() {
  
  // 에디팅 툴바 연동
  const tools = ['select', 'text', 'redact'];
  tools.forEach(tool => {
    const btn = els[`tool${tool.charAt(0).toUpperCase() + tool.slice(1)}Btn`];
    if (btn) {
      btn.addEventListener('click', () => {
        setEditTool(tool);
      });
    }
  });

  // 서식 툴바 조작 리스너
  els.toolbarFontFamily.addEventListener('change', () => applyFormatToActiveText('fontFamily', els.toolbarFontFamily.value));
  els.toolbarFontSize.addEventListener('change', () => applyFormatToActiveText('fontSize', Number(els.toolbarFontSize.value)));
  els.toolbarColor.addEventListener('input', () => applyFormatToActiveText('color', els.toolbarColor.value));
  
  els.toolbarBtnItalic.addEventListener('click', () => {
    const italic = !els.toolbarBtnItalic.classList.contains('is-active');
    els.toolbarBtnItalic.classList.toggle('is-active', italic);
    applyFormatToActiveText('italic', italic);
  });
  
  els.toolbarBtnUnderline.addEventListener('click', () => {
    const underline = !els.toolbarBtnUnderline.classList.contains('is-active');
    els.toolbarBtnUnderline.classList.toggle('is-active', underline);
    applyFormatToActiveText('underline', underline);
  });
  
  els.toolbarBtnStrikethrough.addEventListener('click', () => {
    const strikethrough = !els.toolbarBtnStrikethrough.classList.contains('is-active');
    els.toolbarBtnStrikethrough.classList.toggle('is-active', strikethrough);
    applyFormatToActiveText('strikethrough', strikethrough);
  });

  els.toolbarBtnDelete.addEventListener('click', () => {
    if (state.activeAnnotationId) {
      deleteAnnotation(state.activeAnnotationId);
    }
  });

  // 오버레이 마우스 이벤트 바인딩
  const overlay = els.editOverlay;
  let dragBox = null;
  let isDown = false;
  let startX = 0, startY = 0;

  overlay.addEventListener('mousedown', (e) => {
    // 빈 여백을 클릭한 경우 선택 해제 처리
    if (state.activeAnnotationId && !e.target.closest('.edit-text-node, .floating-toolbar')) {
      deselectActiveAnnotation();
    }
    // 텍스트/가림막 추가 기능 전면 비활성화 (싱글클릭 복사 모드로 단일화)
    return;
  });
}

function setEditTool(tool) {
  state.editTool = tool;
  const tools = ['select', 'text', 'redact'];
  tools.forEach(t => {
    const btn = els[`tool${t.charAt(0).toUpperCase() + t.slice(1)}Btn`];
    if (btn) btn.classList.toggle('is-active', t === tool);
  });

  const overlay = els.editOverlay;
  overlay.className = `edit-overlay tool-${tool}`;
}

function updateEditOverlayGeometry() {
  const overlay = els.editOverlay;
  const canvas = els.pdfCanvas;
  if (!canvas || !overlay) return;

  overlay.style.width = `${canvas.clientWidth}px`;
  overlay.style.height = `${canvas.clientHeight}px`;
  
  renderAnnotationsOnOverlay();
}

function renderAnnotationsOnOverlay() {
  const overlay = els.editOverlay;
  if (!overlay) return;

  // 1. 더 이상 존재하지 않는(삭제된) 어노테이션 노드들과 redact-box 등을 DOM에서 삭제
  overlay.querySelectorAll('.redact-box, .edit-text-input-wrapper').forEach(el => el.remove());
  
  const pageAnns = state.annotations.filter(ann => ann.page === state.page);
  const pageAnnIds = pageAnns.map(ann => ann.id);

  overlay.querySelectorAll('.edit-text-node').forEach(el => {
    const id = el.dataset.id;
    if (!pageAnnIds.includes(id)) {
      el.remove();
    }
  });

  // 2. 각 어노테이션에 대해 렌더링 또는 업데이트 수행
  pageAnns.forEach(ann => {
    if (ann.type === 'text') {
      let div = overlay.querySelector(`.edit-text-node[data-id="${ann.id}"]`);
      const isNew = !div;

      if (isNew) {
        div = document.createElement('div');
        div.className = 'edit-text-node';
        div.id = ann.id;
        div.dataset.id = ann.id;
        overlay.appendChild(div);

        // 드래그 앤 드롭 이벤트 바인딩 (최초 1회만 등록)
        let isDragging = false;
        let startX, startY;
        let startLeft, startTop;

        div.addEventListener('mousedown', (e) => {
          if (div.getAttribute('contenteditable') === 'true') {
            return;
          }

          selectAnnotation(ann.id);

          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          startLeft = parseFloat(div.style.left) || 0;
          startTop = parseFloat(div.style.top) || 0;

          e.preventDefault();
          e.stopPropagation();

          const onMouseMove = (moveEvt) => {
            if (!isDragging) return;
            const dx = moveEvt.clientX - startX;
            const dy = moveEvt.clientY - startY;
            div.style.left = `${startLeft + dx}px`;
            div.style.top = `${startTop + dy}px`;

            updateFloatingToolbarPosition(div);
          };

          const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const finalLeft = parseFloat(div.style.left) || 0;
            const finalTop = parseFloat(div.style.top) || 0;
            const rectW = div.offsetWidth;
            const rectH = div.offsetHeight;

            const newPdf = pxToPdfPoints(finalLeft, finalTop, rectW, rectH);
            ann.x = newPdf.x;
            ann.y = newPdf.y;
            ann.width = newPdf.w;
            ann.height = newPdf.h;

            updateFloatingToolbarPosition(div);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });

        // 더블클릭 이벤트 바인딩 (최초 1회만 등록)
        div.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          state.activeAnnotationId = ann.id;
          state.isEditingText = true;
          
          // 상태 변경 후 즉시 로컬 DOM을 수정 모드로 전환
          div.setAttribute('contenteditable', 'true');
          div.classList.add('is-active');
          div.focus();
          
          // 커서를 텍스트 끝으로 이동
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(div);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        });

        // 인라인 편집 종료(blur) 및 키 입력 제어 (최초 1회만 등록)
        div.addEventListener('blur', () => {
          const newText = div.innerText.trim();
          if (!newText) {
            deleteAnnotation(ann.id);
          } else {
            ann.text = newText;
            const rectW = div.offsetWidth;
            const rectH = div.offsetHeight;
            const newPdf = pxToPdfPoints(parseFloat(div.style.left) || 0, parseFloat(div.style.top) || 0, rectW, rectH);
            ann.width = newPdf.w;
            ann.height = newPdf.h;

            state.isEditingText = false;
            // blur 후 contenteditable 해제 및 렌더링 갱신
            div.removeAttribute('contenteditable');
            renderAnnotationsOnOverlay();
          }
        });

        div.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            div.blur();
          }
          if (evt.key === 'Escape') {
            evt.preventDefault();
            div.innerText = ann.text;
            div.blur();
          }
        });
      }

      // --- 매번(업데이트 시) 적용할 스타일 및 속성 갱신 ---
      
      // 사용자가 contenteditable 편집 중이 아닐 때만 innerText 및 스타일 위치 동기화
      if (document.activeElement !== div) {
        div.innerText = ann.text;
        
        // 좌표 계산
        const scale = getViewportScale();
        const fontSize = ann.fontSize || 14;
        const annW = ann.width || 150;
        const annH = ann.height || (fontSize * 1.2);
        const px = pdfPointsToPx(ann.x, ann.y, annW, annH);
        div.style.left = `${px.x}px`;
        div.style.top = `${px.y}px`;
      }

      // 서식 갱신 (폰트, 크기, 색상 등)
      if (ann.fontFamily) {
        div.style.fontFamily = fontFamilyToCss(ann.fontFamily);
      }
      
      const scale = getViewportScale();
      const fontSize = ann.fontSize || 14;
      div.style.fontSize = `${fontSize * scale}px`;
      div.style.color = ann.color || '#111827';
      div.style.fontStyle = ann.italic ? 'italic' : 'normal';

      const dec = [];
      if (ann.underline) dec.push('underline');
      if (ann.strikethrough) dec.push('line-through');
      div.style.textDecoration = dec.join(' ') || 'none';
      div.style.minWidth = '30px';

      // 활성화 및 contenteditable 상태 제어
      if (state.activeAnnotationId === ann.id) {
        div.classList.add('is-active');
        if (state.isEditingText) {
          div.setAttribute('contenteditable', 'true');
        } else {
          div.removeAttribute('contenteditable');
        }
      } else {
        div.classList.remove('is-active');
        div.removeAttribute('contenteditable');
      }
    }
  });

  // 툴바 노출 관리
  const activeNode = overlay.querySelector('.edit-text-node.is-active');
  if (activeNode) {
    requestAnimationFrame(() => {
      updateFloatingToolbarPosition(activeNode);
    });
  } else {
    hideFloatingToolbar();
  }
}

function saveActiveTextInputValue() {
  const overlay = els.editOverlay;
  const activeEl = overlay.querySelector('.edit-text-node.is-active[contenteditable="true"]');
  if (activeEl) {
    activeEl.blur();
  }
}

function selectAnnotation(id) {
  state.activeAnnotationId = id;
  const ann = state.annotations.find(a => a.id === id);
  if (!ann) return;

  renderAnnotationsOnOverlay();
  
  if (ann.type === 'text') {
    showFloatingToolbar(ann);
  } else {
    showFloatingToolbar(ann);
  }
}

function deselectActiveAnnotation() {
  state.activeAnnotationId = null;
  state.isEditingText = false;
  hideFloatingToolbar();
  renderAnnotationsOnOverlay();
}

function deleteAnnotation(id) {
  const targetAnn = state.annotations.find(a => a.id === id);
  if (targetAnn) {
    let idsToRemove = [id];
    if (targetAnn.type === 'text' && targetAnn.redactAnnId) {
      idsToRemove.push(targetAnn.redactAnnId);
    }
    state.annotations = state.annotations.filter(a => !idsToRemove.includes(a.id));
  }
  deselectActiveAnnotation();
}

function applyFormatToActiveText(key, value) {
  if (!state.activeAnnotationId) return;
  const ann = state.annotations.find(a => a.id === state.activeAnnotationId);
  if (ann && ann.type === 'text') {
    ann[key] = value;
    
    const overlay = els.editOverlay;
    const input = overlay.querySelector('.edit-text-node.is-active');
    if (input) {
      if (key === 'fontFamily') {
        input.style.fontFamily = fontFamilyToCss(value);
      } else if (key === 'fontSize') {
        input.style.fontSize = `${value * getViewportScale()}px`;
      } else if (key === 'color') {
        input.style.color = value;
      } else if (key === 'italic') {
        input.style.fontStyle = value ? 'italic' : 'normal';
      } else if (key === 'underline' || key === 'strikethrough') {
        const dec = [];
        if (ann.underline) dec.push('underline');
        if (ann.strikethrough) dec.push('line-through');
        input.style.textDecoration = dec.join(' ') || 'none';
      }
    } else {
      renderAnnotationsOnOverlay();
    }
  }
}

function createRedactAnnotation(x, y, w, h) {
  const pdfPt = pxToPdfPoints(x, y, w, h);
  const ann = {
    id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    page: state.page,
    type: 'redact',
    x: pdfPt.x,
    y: pdfPt.y,
    width: pdfPt.w,
    height: pdfPt.h
  };
  state.annotations.push(ann);
  selectAnnotation(ann.id);
}

function addTextInput(x, y) {
  const pdfPt = pxToPdfPoints(x, y + 18, 0, 0);
  const ann = {
    id: 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    page: state.page,
    type: 'text',
    text: '텍스트 입력',
    x: pdfPt.x,
    y: pdfPt.y,
    fontSize: Number(els.toolbarFontSize.value) || 14,
    fontFamily: els.toolbarFontFamily.value || 'malgun',
    color: els.toolbarColor.value || '#111827',
    italic: els.toolbarBtnItalic.classList.contains('is-active'),
    underline: els.toolbarBtnUnderline.classList.contains('is-active'),
    strikethrough: els.toolbarBtnStrikethrough.classList.contains('is-active')
  };
  
  state.annotations.push(ann);
  state.isEditingText = true;
  selectAnnotation(ann.id);
}

function getViewportScale() {
  return state.scale || 1.2;
}

function pdfPointsToPx(pdfX, pdfY, pdfW, pdfH) {
  if (!state.pdfPageViewport) return { x: pdfX, y: pdfY, w: pdfW, h: pdfH };
  
  const viewport = state.pdfPageViewport;
  const [x, y] = viewport.convertToViewportPoint(pdfX, pdfY);
  
  const w = pdfW * viewport.scale;
  const h = pdfH * viewport.scale;
  
  return { x, y: y - h, w, h };
}

function pxToPdfPoints(pxX, pxY, pxW, pxH) {
  if (!state.pdfPageViewport) return { x: pxX, y: pxY, w: pxW, h: pxH };
  const viewport = state.pdfPageViewport;
  
  const [pdfX, pdfY] = viewport.convertToPdfPoint(pxX, pxY + pxH);
  const w = pxW / viewport.scale;
  const h = pxH / viewport.scale;
  
  return { x: pdfX, y: pdfY, w, h };
}

function showFloatingToolbar(ann) {
  const toolbar = els.floatingFormatToolbar;
  toolbar.classList.remove('hidden');

  if (ann.type === 'text') {
    els.toolbarFontFamily.disabled = false;
    els.toolbarFontSize.disabled = false;
    els.toolbarBtnItalic.disabled = false;
    els.toolbarBtnUnderline.disabled = false;
    els.toolbarBtnStrikethrough.disabled = false;
    els.toolbarColor.disabled = false;

    els.toolbarFontFamily.value = ann.fontFamily || 'malgun';
    els.toolbarFontSize.value = String(ann.fontSize || 14);
    els.toolbarColor.value = ann.color || '#111827';
    els.toolbarBtnItalic.classList.toggle('is-active', Boolean(ann.italic));
    els.toolbarBtnUnderline.classList.toggle('is-active', Boolean(ann.underline));
    els.toolbarBtnStrikethrough.classList.toggle('is-active', Boolean(ann.strikethrough));
  } else {
    els.toolbarFontFamily.disabled = true;
    els.toolbarFontSize.disabled = true;
    els.toolbarBtnItalic.disabled = true;
    els.toolbarBtnUnderline.disabled = true;
    els.toolbarBtnStrikethrough.disabled = true;
    els.toolbarColor.disabled = true;
  }

  // 툴바가 노출될 때 타겟 노드 위치에 정확히 맞추기 위해 강제 갱신
  const activeNode = els.editOverlay.querySelector(`.edit-text-node[data-id="${ann.id}"]`);
  if (activeNode) {
    requestAnimationFrame(() => {
      updateFloatingToolbarPosition(activeNode);
    });
  }
}

function updateFloatingToolbarPosition(targetEl) {
  const toolbar = els.floatingFormatToolbar;
  if (toolbar.classList.contains('hidden')) return;

  const rect = targetEl.getBoundingClientRect();
  const toolbarWidth = toolbar.offsetWidth || 340;
  const toolbarHeight = toolbar.offsetHeight || 44;

  let top = rect.top - toolbarHeight - 12;
  let left = rect.left + (rect.width - toolbarWidth) / 2;

  if (top < 50) top = rect.bottom + 12;
  if (left < 10) left = 10;
  if (left + toolbarWidth > window.innerWidth - 10) left = window.innerWidth - toolbarWidth - 10;

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function hideFloatingToolbar() {
  els.floatingFormatToolbar.classList.add('hidden');
}

async function performOcrOnRegion(x, y, w, h) {
  if (!state.pdf || !window.Tesseract) {
    showToast('OCR 엔진(Tesseract.js)이 준비되지 않았습니다.', true);
    return;
  }

  showToast('선택한 영역의 글자를 읽는 중입니다 (OCR)...');
  setOperationStatus('OCR 분석 중');

  try {
    const pdfCanvas = els.pdfCanvas;
    const ratio = window.devicePixelRatio || 1;
    const rx = x * ratio;
    const ry = y * ratio;
    const rw = w * ratio;
    const rh = h * ratio;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = rw;
    tempCanvas.height = rh;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(pdfCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

    const worker = await Tesseract.createWorker('ko+en');
    const result = await worker.recognize(tempCanvas);
    await worker.terminate();

    const ocrText = String(result.data.text || '').trim();
    if (!ocrText) {
      showToast('인식된 텍스트가 없습니다.', true);
      setOperationStatus('OCR 완료 (텍스트 없음)');
      return;
    }

    await navigator.clipboard.writeText(ocrText);
    showToast('선택 영역의 텍스트가 클립보드에 복사되었습니다.');
    setOperationStatus('OCR 완료');

    els.currentTextOutput.value = ocrText;
  } catch (error) {
    console.error(error);
    showToast('OCR 판독 중 실패했습니다: ' + error.message, true);
    setOperationStatus('OCR 실패');
  }
}

async function runBackgroundExtraction(documentId) {
  if (!documentId) return;
  state.isExtracting = true;
  state.extractedJson = null;
  state.extractedMarkdown = '';
  setOperationStatus('백그라운드 자동 분석 중...');
  try {
    const result = await requestJson(`/api/extract/${documentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysisMode: 'fast',
        pages: '',
        markdownWithHtml: true,
        imageOutput: 'off',
      }),
    });
    state.extractedJson = result.json;
    state.extractedMarkdown = result.markdown || '';

    // 만약 텍스트 에어리어가 비어있거나 안내 문구(대괄호 시작) 상태라면 결과를 채워줍니다.
    if (!els.markdownOutput.value || els.markdownOutput.value.startsWith('[')) {
      els.markdownOutput.value = result.markdown || '';
    }
    if (!els.jsonOutput.value || els.jsonOutput.value === '{}' || els.jsonOutput.value.includes('"processing"')) {
      els.jsonOutput.value = JSON.stringify(result.json || {}, null, 2);
    }

    setOperationStatus('자동 분석 완료');
    showToast('문서 분석이 완료되어 영역 복사를 사용할 수 있습니다.');
    updateOcrOverlayBoxes();
  } catch (error) {
    console.error('Background extraction failed:', error);
    setOperationStatus('자동 분석 실패');
  } finally {
    state.isExtracting = false;
  }
}

function collectOcrElements(node, pageNumber, results = []) {
  if (!node || typeof node !== 'object') return results;
  
  if (Array.isArray(node)) {
    node.forEach(item => collectOcrElements(item, pageNumber, results));
    return results;
  }

  const nodePage = node['page number'] || node.pageNumber;
  const bbox = node['bounding box'] || node.boundingBox || node.bbox;
  const type = String(node.type || '').toLowerCase();

  if (nodePage === pageNumber && Array.isArray(bbox) && bbox.length === 4) {
    if (type !== 'table cell' && type !== 'text block' && type !== 'table row') {
      const content = node.content || node.text || node.value || '';
      
      const isText = ['paragraph', 'heading', 'caption', 'list item', 'header', 'footer'].includes(type) || 
                     (content && !['table', 'image', 'picture', 'formula'].includes(type));
      
      const isImage = ['image', 'picture', 'table', 'formula'].includes(type);

      if (isText || isImage) {
        results.push({
          type: isText ? 'text' : 'image',
          bbox: bbox,
          content: content,
          rawType: type
        });
      }
    }
  }

  if (node.kids && Array.isArray(node.kids)) {
    collectOcrElements(node.kids, pageNumber, results);
  }
  if (node.rows && Array.isArray(node.rows)) {
    collectOcrElements(node.rows, pageNumber, results);
  }
  if (node.cells && Array.isArray(node.cells)) {
    collectOcrElements(node.cells, pageNumber, results);
  }

  Object.keys(node).forEach(key => {
    if (!['kids', 'rows', 'cells'].includes(key) && node[key] && typeof node[key] === 'object') {
      collectOcrElements(node[key], pageNumber, results);
    }
  });

  return results;
}

function updateOcrOverlayBoxes() {
  const ocrOverlay = document.getElementById('ocrOverlay');
  if (!ocrOverlay) return;

  if (!state.editModeActive) {
    ocrOverlay.classList.add('hidden');
    ocrOverlay.innerHTML = '';
    return;
  }

  ocrOverlay.classList.remove('hidden');
  ocrOverlay.innerHTML = '';

  const canvas = els.pdfCanvas;
  if (!canvas || !state.pdf) return;

  ocrOverlay.style.width = `${canvas.clientWidth}px`;
  ocrOverlay.style.height = `${canvas.clientHeight}px`;

  if (!state.extractedJson) return;

  const pageElements = collectOcrElements(state.extractedJson.kids || state.extractedJson, state.page);
  const existingTextAnns = state.annotations.filter(a => a.page === state.page && a.type === 'text');

  pageElements.forEach(item => {
    const [xMin, yMin, xMax, yMax] = item.bbox;
    const isAlreadyConverted = existingTextAnns.some(ann => Math.abs(ann.x - xMin) < 3 && Math.abs(ann.y - yMin) < 3);
    if (isAlreadyConverted) return;

    const pdfW = xMax - xMin;
    const pdfH = yMax - yMin;

    const px = pdfPointsToPx(xMin, yMin, pdfW, pdfH);

    const box = document.createElement('div');
    box.className = `ocr-dashed-box ${item.type}-type`;
    box.dataset.bbox = JSON.stringify(item.bbox);
    
    box.style.left = `${px.x}px`;
    box.style.top = `${px.y}px`;
    box.style.width = `${px.w}px`;
    box.style.height = `${px.h}px`;

    if (item.type === 'text') {
      box.textContent = item.content || '';
      box.style.fontSize = `${px.h * 0.85}px`;
      box.style.lineHeight = `${px.h}px`;
      box.title = '클릭하여 텍스트 복사';
    } else {
      box.title = '클릭하여 이미지 복사';
    }

    box.addEventListener('click', async (e) => {
      const selection = window.getSelection().toString();
      if (selection) return;

      e.stopPropagation();
      e.preventDefault();

      if (item.type === 'text') {
        if (item.content) {
          try {
            await navigator.clipboard.writeText(item.content);
            showToast('텍스트 전체를 클립보드에 복사했습니다.');
          } catch (err) {
            showToast('텍스트 복사 실패: ' + err.message, true);
          }
        }
      } else {
        await copyRegionAsImage(px.x, px.y, px.w, px.h);
      }
    });

    ocrOverlay.appendChild(box);
  });
}

async function copyRegionAsImage(x, y, w, h) {
  const pdfCanvas = els.pdfCanvas;
  if (!pdfCanvas) return;

  const ratioX = pdfCanvas.width / pdfCanvas.clientWidth;
  const ratioY = pdfCanvas.height / pdfCanvas.clientHeight;

  const srcX = x * ratioX;
  const srcY = y * ratioY;
  const srcW = w * ratioX;
  const srcH = h * ratioY;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = srcW;
  tempCanvas.height = srcH;
  const ctx = tempCanvas.getContext('2d');
  
  if (!ctx) {
    showToast('이미지 크롭에 실패했습니다.', true);
    return;
  }

  ctx.drawImage(pdfCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  try {
    const clipboardPromise = new Promise((resolve, reject) => {
      tempCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Image blob conversion failed'));
        }
      }, 'image/png');
    });

    const item = new ClipboardItem({ 'image/png': clipboardPromise });
    await navigator.clipboard.write([item]);
    showToast('선택 영역을 이미지로 클립보드에 복사했습니다. (Ctrl+V로 문서에 붙여넣기 가능)');
  } catch (err) {
    console.error('Clipboard write image failed:', err);
    showToast('클립보드 이미지 복사 실패: ' + err.message, true);
  }
}

function toggleSearchWidget() {
  const widget = els.searchWidget;
  if (!widget) return;
  const isHidden = widget.classList.contains('hidden');
  if (isHidden) {
    widget.classList.remove('hidden');
    els.widgetSearchInput.focus();
    els.widgetSearchInput.select();
    refreshIcons();
  } else {
    hideSearchWidget();
  }
}

function hideSearchWidget() {
  const widget = els.searchWidget;
  if (widget) widget.classList.add('hidden');
  state.searchKeyword = '';
  state.searchResults = [];
  state.searchActiveIndex = -1;
  if (els.searchWidgetResults) els.searchWidgetResults.classList.add('hidden');
  if (els.resultsList) els.resultsList.innerHTML = '';
}

let searchDebounceTimeout = null;
async function runWidgetSearch() {
  const keyword = els.widgetSearchInput.value.trim();
  
  // 플로팅 검색어 입력값을 상단 검색창에 역동기화
  if (els.searchInput.value !== els.widgetSearchInput.value) {
    els.searchInput.value = els.widgetSearchInput.value;
  }
  
  if (!keyword) {
    els.searchWidgetResults.classList.add('hidden');
    els.resultsList.innerHTML = '';
    state.searchResults = [];
    return;
  }

  state.searchKeyword = keyword;

  if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(async () => {
    setOperationStatus('검색 중...');
    const results = [];
    const lowerKeyword = keyword.toLowerCase();

    try {
      if (state.extractedJson) {
        // OCR JSON 데이터가 존재하면 이를 기반으로 검색 수행 (스캔본 포함 완벽 매칭)
        for (let pageNum = 1; pageNum <= state.pageCount; pageNum++) {
          if (state.searchKeyword !== keyword) return;

          const pageElements = collectOcrElements(state.extractedJson.kids || state.extractedJson, pageNum);
          pageElements.forEach((item) => {
            if (item.type === 'text' && item.content) {
              if (item.content.toLowerCase().includes(lowerKeyword)) {
                results.push({
                  page: pageNum,
                  text: item.content,
                  bbox: item.bbox,
                  content: item.content
                });
              }
            }
          });
        }
      } else if (state.pdf) {
        // OCR 데이터가 없는 경우 PDF.js 텍스트로 폴백
        for (let pageNum = 1; pageNum <= state.pageCount; pageNum++) {
          if (state.searchKeyword !== keyword) return;

          const page = await state.pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          textContent.items.forEach((item) => {
            const str = item.str || '';
            if (str.toLowerCase().includes(lowerKeyword)) {
              const xMin = item.transform[4];
              const yMin = item.transform[5];
              const pdfW = item.width;
              const pdfH = item.height;

              results.push({
                page: pageNum,
                text: str,
                bbox: [xMin, yMin, xMin + pdfW, yMin + pdfH],
                content: str
              });
            }
          });
        }
      }

      state.searchResults = results;
      state.searchActiveIndex = -1;

      renderSearchWidgetResults(results);
      setOperationStatus(`검색 완료: ${results.length}건`);
    } catch (err) {
      console.error('Search failed:', err);
      setOperationStatus('검색 실패');
    }
  }, 300);
}

function renderSearchWidgetResults(results) {
  const resultsPanel = els.searchWidgetResults;
  const resultsCount = els.resultsCount;
  const resultsList = els.resultsList;

  resultsList.innerHTML = '';

  if (results.length === 0) {
    resultsCount.textContent = '0';
    resultsPanel.classList.remove('hidden');
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '8px';
    emptyMsg.style.color = '#64748b';
    emptyMsg.style.fontSize = '12px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.textContent = '일치하는 항목이 없습니다.';
    resultsList.appendChild(emptyMsg);
    return;
  }

  resultsCount.textContent = String(results.length);
  resultsPanel.classList.remove('hidden');

  const group = document.createElement('button');
  group.type = 'button';
  group.className = 'search-result-item is-active';
  
  const textSpan = document.createElement('span');
  textSpan.textContent = state.searchKeyword;
  
  const countSpan = document.createElement('span');
  countSpan.className = 'search-result-count';
  countSpan.textContent = String(results.length);

  group.appendChild(textSpan);
  group.appendChild(countSpan);
  resultsList.appendChild(group);

  group.addEventListener('click', () => {
    if (results.length > 0) {
      navigateSearchNext();
    }
  });

  const detailContainer = document.createElement('div');
  detailContainer.style.display = 'flex';
  detailContainer.style.flexDirection = 'column';
  detailContainer.style.gap = '2px';
  detailContainer.style.paddingLeft = '8px';
  detailContainer.style.marginTop = '4px';

  results.forEach((res, idx) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.style.fontSize = '11px';
    item.style.padding = '4px 6px';
    item.style.background = '#f8fafc';
    item.style.border = '1px solid #e2e8f0';
    
    const pageBadge = document.createElement('span');
    pageBadge.style.fontWeight = 'bold';
    pageBadge.style.color = '#2563eb';
    pageBadge.textContent = `${res.page}쪽: `;

    const textPart = document.createElement('span');
    textPart.style.overflow = 'hidden';
    textPart.style.textOverflow = 'ellipsis';
    textPart.style.whiteSpace = 'nowrap';
    textPart.textContent = res.text;

    item.appendChild(pageBadge);
    item.appendChild(textPart);
    detailContainer.appendChild(item);

    item.addEventListener('click', () => {
      state.searchActiveIndex = idx;
      selectSearchResult(idx);
    });
  });

  resultsList.appendChild(detailContainer);
}

async function selectSearchResult(index) {
  const result = state.searchResults[index];
  if (!result) return;

  if (state.page !== result.page) {
    await goToPage(result.page);
  }

  state.editModeActive = true;
  els.editOverlay.classList.remove('hidden');
  showRibbonTab('edit', { syncPanel: true });
  setEditTool('text');
  updateEditOverlayGeometry();
  updateOcrOverlayBoxes();

  setTimeout(async () => {
    const [xMin, yMin, xMax, yMax] = result.bbox;

    // ocr-dashed-box 중 일치하는 bbox를 찾음
    const boxes = document.querySelectorAll('.ocr-dashed-box.text-type');
    let targetBox = null;
    for (const box of boxes) {
      if (box.dataset.bbox) {
        try {
          const bbox = JSON.parse(box.dataset.bbox);
          if (Math.abs(bbox[0] - xMin) < 1 && Math.abs(bbox[1] - yMin) < 1) {
            targetBox = box;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    if (targetBox) {
      // 복사 피드백 애니메이션 적용
      targetBox.classList.add('pulse-highlight');
      setTimeout(() => targetBox.classList.remove('pulse-highlight'), 1000);
    }

    try {
      await navigator.clipboard.writeText(result.content || '');
      showToast(`검색 단어 '${result.content}' 전체를 클립보드에 복사했습니다.`);
    } catch (err) {
      showToast('텍스트 복사 실패: ' + err.message, true);
    }
  }, 150);
}

function navigateSearchPrev() {
  if (state.searchResults.length === 0) return;
  let idx = state.searchActiveIndex - 1;
  if (idx < 0) idx = state.searchResults.length - 1;
  state.searchActiveIndex = idx;
  selectSearchResult(idx);
}

function navigateSearchNext() {
  if (state.searchResults.length === 0) return;
  let idx = state.searchActiveIndex + 1;
  if (idx >= state.searchResults.length) idx = 0;
  state.searchActiveIndex = idx;
  selectSearchResult(idx);
}

function startInlineEditing(box, item) {
  if (state.isEditingText) return;

  const [xMin, yMin, xMax, yMax] = item.bbox;
  const pdfW = xMax - xMin;
  const pdfH = yMax - yMin;

  const redactId = 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_redact';
  const redactAnn = {
    id: redactId,
    type: 'redact',
    page: state.page,
    x: xMin,
    y: yMin,
    width: pdfW,
    height: pdfH,
    whiteout: true
  };
  state.annotations.push(redactAnn);

  renderAnnotationsOnOverlay();

  state.isEditingText = true;
  box.contentEditable = "true";
  box.style.color = "#111827";
  box.style.background = "#ffffff";
  box.style.zIndex = "100";
  box.style.border = "1px solid #2563eb";
  box.focus();

  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(box);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  const onBlur = () => {
    box.contentEditable = "false";
    box.style.color = "transparent";
    box.style.background = "transparent";
    box.style.zIndex = "";
    box.style.border = "";
    box.removeEventListener('blur', onBlur);
    box.removeEventListener('keydown', onKeyDown);

    state.isEditingText = false;
    const finalVal = box.textContent.trim();

    if (finalVal === '') {
      renderAnnotationsOnOverlay();
      updateOcrOverlayBoxes();
      showToast('텍스트가 삭제되었습니다.');
    } else {
      const textId = 'ann_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '_text';
      const textAnn = {
        id: textId,
        type: 'text',
        redactAnnId: redactId,
        page: state.page,
        x: xMin,
        y: yMin,
        width: pdfW,
        height: pdfH,
        text: finalVal,
        fontSize: Math.max(9, Math.round(pdfH * 0.85)),
        fontFamily: 'malgun',
        color: '#111827',
        italic: false,
        underline: false,
        strikethrough: false
      };
      state.annotations.push(textAnn);
      
      renderAnnotationsOnOverlay();
      updateOcrOverlayBoxes();
      showToast('텍스트가 수정되었습니다.');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      box.blur();
    }
  };

  box.addEventListener('blur', onBlur);
  box.addEventListener('keydown', onKeyDown);
}
