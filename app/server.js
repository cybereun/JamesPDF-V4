const path = require('path');
const userHome = process.env.USERPROFILE || process.env.HOME || '';
const LOCAL_DEP_NODE_MODULES = path.join(userHome, '.jamepdf-v4-deps', 'node_modules');
const LEGACY_LOCAL_DEP_NODE_MODULES = path.join(userHome, '.jamepdf-v3-deps', 'node_modules');
const SHARED_NODE_MODULES = path.join(__dirname, '..', 'james-app', 'node_modules');

[LOCAL_DEP_NODE_MODULES, LEGACY_LOCAL_DEP_NODE_MODULES, SHARED_NODE_MODULES].forEach((dir) => {
  if (dir && !module.paths.includes(dir)) {
    module.paths.push(dir);
  }
});

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const APP_PACKAGE = require('./package.json');
const { createUpdateService } = require('./update-service');

const app = express();
const PORT = Number(process.env.PORT || 5200);
const APP_VERSION = APP_PACKAGE.version;
const APP_NAME = `JamePDF V${APP_VERSION}`;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
const PUBLIC_DIR = path.join(__dirname, 'public');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const KORDOC_DATA_DIR = path.join(DATA_DIR, 'kordoc');
const USER_DOWNLOADS_DIR = path.join(userHome || os.homedir() || '', 'Downloads');
const HYBRID_PORT = Number(process.env.JAMEPDF_HYBRID_PORT || 5002);
const HYBRID_HOST = process.env.JAMEPDF_HYBRID_HOST || '127.0.0.1';
const DEFAULT_HYBRID_URL = process.env.JAMEPDF_HYBRID_URL || `http://${HYBRID_HOST}:${HYBRID_PORT}`;
const DEFAULT_OLLAMA_URL = process.env.JAMEPDF_OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_GEMMA_MODEL = process.env.JAMEPDF_GEMMA_MODEL || 'gemma:e4b';
const AI_TIMEOUT_MS = Number(process.env.JAMEPDF_AI_TIMEOUT_MS || 180000);
const HYBRID_LOG_FILE = path.join(DATA_DIR, 'hybrid-server.log');
const PYTHON_HYBRID_SRC = path.join(__dirname, '..', 'python', 'opendataloader-pdf', 'src');

[UPLOADS_DIR, DATA_DIR, OUTPUTS_DIR, PUBLIC_DIR, KORDOC_DATA_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
let hybridProcess = null;
const SAVE_TARGETS = new Map();
let kordocStudioModulePromise = null;
let updateInstallInProgress = false;
const updateService = createUpdateService({
  currentVersion: APP_VERSION,
  appRoot: path.resolve(__dirname, '..'),
});

function commandPath(command) {
  if (command && path.isAbsolute(command) && fs.existsSync(command)) {
    return command;
  }
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true });
  if (result.status === 0) {
    return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
  }
  return '';
}

function commandExists(command) {
  return Boolean(commandPath(command));
}

function findJavaBinUnder(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;

  const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
  const direct = path.join(rootDir, 'bin', javaName);
  if (fs.existsSync(direct)) return path.dirname(direct);

  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > 7) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === javaName) return path.dirname(fullPath);
      if (entry.isDirectory()) stack.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }
  return null;
}

function ensureJavaOnPath() {
  if (commandExists('java')) return null;

  const candidates = [
    process.env.JAVA_HOME,
    path.join(userHome, '.antigravity', 'extensions'),
    path.join(userHome, '.antigravity-ide', 'extensions'),
  ];

  for (const candidate of candidates) {
    const javaBin = findJavaBinUnder(candidate);
    if (javaBin) {
      process.env.PATH = `${javaBin}${path.delimiter}${process.env.PATH || ''}`;
      return javaBin;
    }
  }
  return null;
}

const DETECTED_JAVA_BIN = ensureJavaOnPath();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));
app.get('/kordoc', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'kordoc.html'));
});

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '.pdf').toLowerCase() || '.pdf'}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 100 },
});

function safeOriginalName(name) {
  const raw = path.basename(name || 'document.pdf').replace(/[\r\n]/g, ' ').trim() || 'document.pdf';
  if (/[ÃÂ챠챙챘챗][\u0080-\u00FF]/.test(raw) || /[\u0080-\u009F]/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'latin1').toString('utf8');
      if (decoded && decoded !== raw && !decoded.includes('\uFFFD')) return decoded;
    } catch {
      return raw;
    }
  }
  return raw;
}

function safeResultId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function safeDownloadBase(name) {
  const normalizedName = safeOriginalName(name || 'jamepdf-output.pdf');
  return path.basename(normalizedName, path.extname(normalizedName))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 130) || 'jamepdf-output';
}

function uniqueDownloadPath(filename) {
  const safeName = path.basename(String(filename || 'filled.hwpx')).replace(/[\\/:*?"<>|]+/g, '-');
  const ext = path.extname(safeName);
  const base = path.basename(safeName, ext) || 'filled';
  let candidate = path.join(USER_DOWNLOADS_DIR, `${base}${ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(USER_DOWNLOADS_DIR, `${base} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

function saveCopyToUserDownloads(filename, buffer) {
  if (!USER_DOWNLOADS_DIR || !path.isAbsolute(USER_DOWNLOADS_DIR)) return '';
  fs.mkdirSync(USER_DOWNLOADS_DIR, { recursive: true });
  const targetPath = uniqueDownloadPath(filename);
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getHistory() {
  return readJson(HISTORY_FILE, []);
}

function saveHistoryItem(item) {
  const history = getHistory().filter((entry) => entry.id !== item.id);
  history.unshift(item);
  writeJson(HISTORY_FILE, history.slice(0, 80));
}

function fileStatSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function uploadedPdfPath(id) {
  const safeId = safeResultId(id);
  const candidates = [
    path.join(UPLOADS_DIR, `${safeId}.pdf`),
    path.join(UPLOADS_DIR, `${safeId}.PDF`),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function converterJarPath() {
  const local = path.join(__dirname, 'node_modules', '@opendataloader', 'pdf', 'lib', 'opendataloader-pdf-cli.jar');
  if (fs.existsSync(local)) return local;
  return path.join(SHARED_NODE_MODULES, '@opendataloader', 'pdf', 'lib', 'opendataloader-pdf-cli.jar');
}

function findOutputFile(outputDir, ext) {
  if (!fs.existsSync(outputDir)) return '';
  const suffix = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  const files = fs.readdirSync(outputDir)
    .filter((file) => file.toLowerCase().endsWith(suffix))
    .map((file) => path.join(outputDir, file));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || '';
}

function summarizeJson(data) {
  const summary = {
    pages: 0,
    elements: 0,
    paragraphs: 0,
    tables: 0,
    images: 0,
    headings: 0,
  };

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const type = String(node.type || node.role || '').toLowerCase();
    if (node['page number']) summary.pages = Math.max(summary.pages, Number(node['page number']) || 0);
    if (node.pageNumber) summary.pages = Math.max(summary.pages, Number(node.pageNumber) || 0);
    if (type) {
      summary.elements += 1;
      if (type.includes('paragraph')) summary.paragraphs += 1;
      if (type.includes('table')) summary.tables += 1;
      if (type.includes('image') || type.includes('picture')) summary.images += 1;
      if (type.includes('heading')) summary.headings += 1;
    }
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    });
  }

  visit(data);
  return summary;
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
  const wrappedDen = /^[A-Za-z0-9₀-₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓᵧ]+$/.test(den) ? den : `(${den})`;
  const wrappedNum = /^[A-Za-z0-9₀-₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜₓᵧ]+$/.test(num) ? num : `(${num})`;
  return `${wrappedNum}/${wrappedDen}`;
}

function normalizeExtractedText(text) {
  let value = String(text || '')
    .replace(/[\uE000-\uF8FF]/g, (char) => {
      const mapped = HWP_EQUATION_CHAR_MAP.get(char.codePointAt(0));
      return mapped || char;
    })
    .replace(/\uFFFD/g, '□');

  value = value
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

  return value;
}

function normalizeDocumentText(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => normalizeDocumentText(item));

  const next = { ...node };
  Object.keys(next).forEach((key) => {
    if (typeof next[key] === 'string' && ['content', 'text', 'value', 'caption', 'description'].includes(key)) {
      next[key] = normalizeExtractedText(next[key]);
    } else if (next[key] && typeof next[key] === 'object') {
      next[key] = normalizeDocumentText(next[key]);
    }
  });
  return next;
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
  let value = String(text || '')
    .replace(/[\uE000-\uF8FF]/g, (char) => HWP_EQUATION_CHAR_MAP_V2.get(char.codePointAt(0)) || char)
    .replace(/\uFFFD/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ');

  value = value
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

  return value;
}

function normalizeDocumentTextV2(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => normalizeDocumentTextV2(item));

  const next = { ...node };
  Object.keys(next).forEach((key) => {
    if (typeof next[key] === 'string' && ['content', 'text', 'value', 'caption', 'description'].includes(key)) {
      next[key] = normalizeExtractedTextV2(next[key]);
    } else if (next[key] && typeof next[key] === 'object') {
      next[key] = normalizeDocumentTextV2(next[key]);
    }
  });
  return next;
}

function convertLatexScienceScripts(raw) {
  let value = String(raw || '');
  for (let i = 0; i < 4; i += 1) {
    const next = value
      .replace(/_\{\s*([^{}]+?)\s*\}/g, (_, sub) => toScienceSubscriptV2(String(sub).replace(/\s+/g, '')))
      .replace(/\^\{\s*([^{}]+?)\s*\}/g, (_, sup) => toScienceSuperscriptV2(String(sup).replace(/\s+/g, '')))
      .replace(/_([0-9a-z])/g, (_, sub) => toScienceSubscriptV2(sub))
      .replace(/\^([0-9+\-\u2212])/g, (_, sup) => toScienceSuperscriptV2(sup));
    if (next === value) break;
    value = next;
  }
  return value;
}

function latexScienceToReadable(raw) {
  let value = String(raw || '')
    .replace(/\\(?:mathrm|text|operatorname|mathit|mathbf|mathsf|mathtt)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, numerator, denominator) => linearFractionV2(denominator, numerator))
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\pm/g, '±')
    .replace(/\\rightarrow|\\to/g, '→')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, ' ');

  for (let i = 0; i < 3; i += 1) {
    const next = convertLatexScienceScripts(value).replace(/\{([^{}]+)\}/g, '$1');
    if (next === value) break;
    value = next;
  }

  return value
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReadableScienceText(text) {
  const mathReadable = String(text || '')
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, body) => latexScienceToReadable(body))
    .replace(/\$([^$\n]+)\$/g, (_, body) => latexScienceToReadable(body))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => latexScienceToReadable(body))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => latexScienceToReadable(body));
  return normalizeExtractedTextV2(convertLatexScienceScripts(mathReadable));
}

function normalizeReadableScienceMarkdown(markdown) {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) {
        return line;
      }
      return normalizeReadableScienceText(line);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeReadableScienceObject(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => normalizeReadableScienceObject(item));
  const next = { ...node };
  Object.keys(next).forEach((key) => {
    if (typeof next[key] === 'string' && ['content', 'text', 'value', 'caption', 'description', 'markdown'].includes(key)) {
      next[key] = normalizeReadableScienceMarkdown(next[key]);
    } else if (next[key] && typeof next[key] === 'object') {
      next[key] = normalizeReadableScienceObject(next[key]);
    }
  });
  return next;
}

function parsePagesSpec(spec, pageCount) {
  const text = String(spec || '').trim();
  if (!text) return Array.from({ length: pageCount }, (_, index) => index);

  const selected = new Set();
  text.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, Number(range[1]));
      const end = Math.min(pageCount, Number(range[2]));
      const step = start <= end ? 1 : -1;
      for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
        selected.add(page - 1);
      }
      return;
    }
    const single = Number(part);
    if (Number.isInteger(single) && single >= 1 && single <= pageCount) {
      selected.add(single - 1);
    }
  });

  return Array.from(selected).sort((a, b) => a - b);
}

function parseRangeList(spec, pageCount) {
  const text = String(spec || '').trim();
  if (!text) {
    return Array.from({ length: pageCount }, (_, index) => [index]);
  }

  return text.split(';')
    .map((range) => parsePagesSpec(range, pageCount))
    .filter((pages) => pages.length > 0);
}

async function loadPdf(buffer) {
  return PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
}

async function savePdf(pdfDoc) {
  return Buffer.from(await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
  }));
}

async function copyPagesToNewPdf(sourceDoc, pageIndices) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(sourceDoc, pageIndices);
  pages.forEach((page) => out.addPage(page));
  return out;
}

function pointFromMm(mm) {
  return (Number(mm) || 0) * 72 / 25.4;
}

function printSheetSize(paper = 'a4', orientation = 'portrait') {
  const normalizedPaper = String(paper || 'a4').toLowerCase();
  const sizes = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
  };
  let [width, height] = sizes[normalizedPaper] || sizes.a4;
  if (String(orientation || 'portrait').toLowerCase() === 'landscape') {
    [width, height] = [height, width];
  }
  return { width, height };
}

function printGrid(pagesPerSheet, orientation = 'portrait') {
  const count = [1, 2, 4, 6, 9].includes(Number(pagesPerSheet)) ? Number(pagesPerSheet) : 1;
  const landscape = String(orientation || '').toLowerCase() === 'landscape';
  if (count === 1) return { cols: 1, rows: 1, count };
  if (count === 2) return landscape ? { cols: 2, rows: 1, count } : { cols: 1, rows: 2, count };
  if (count === 4) return { cols: 2, rows: 2, count };
  if (count === 6) return landscape ? { cols: 3, rows: 2, count } : { cols: 2, rows: 3, count };
  return { cols: 3, rows: 3, count };
}

async function buildPrintLayoutPdf(source, options = {}) {
  const orientation = String(options.orientation || 'portrait').toLowerCase();
  const paper = String(options.paper || 'a4').toLowerCase();
  const pagesPerSheet = Number(options.pagesPerSheet || 1);
  const { width: sheetWidth, height: sheetHeight } = printSheetSize(paper, orientation);
  const { cols, rows, count } = printGrid(pagesPerSheet, orientation);
  const margin = Math.max(0, Math.min(36, pointFromMm(options.marginMm || 8)));
  const gap = Math.max(0, Math.min(18, pointFromMm(options.gapMm || 3)));
  const copies = Math.max(1, Math.min(20, Number(options.copies || 1)));
  const drawBorder = String(options.border || 'false') === 'true';
  const fitMode = String(options.fitMode || 'fit');
  const reverse = String(options.reverse || 'false') === 'true';

  let pages = parsePagesSpec(options.pages, source.getPageCount());
  if (!pages.length) pages = source.getPageIndices();
  if (reverse) pages = pages.slice().reverse();

  const orderedPages = [];
  for (let copy = 0; copy < copies; copy += 1) orderedPages.push(...pages);

  const out = await PDFDocument.create();
  out.setTitle('JamePDF print layout');
  out.setProducer(APP_NAME);

  const usableWidth = sheetWidth - margin * 2 - gap * (cols - 1);
  const usableHeight = sheetHeight - margin * 2 - gap * (rows - 1);
  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;

  for (let start = 0; start < orderedPages.length; start += count) {
    const sheet = out.addPage([sheetWidth, sheetHeight]);
    const chunk = orderedPages.slice(start, start + count);

    for (let slot = 0; slot < chunk.length; slot += 1) {
      const sourcePage = source.getPage(chunk[slot]);
      const embeddedPage = await out.embedPage(sourcePage);
      const { width: pageWidth, height: pageHeight } = sourcePage.getSize();
      const scale = fitMode === 'actual'
        ? Math.min(1, cellWidth / pageWidth, cellHeight / pageHeight)
        : Math.min(cellWidth / pageWidth, cellHeight / pageHeight);
      const drawnWidth = pageWidth * scale;
      const drawnHeight = pageHeight * scale;
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const cellX = margin + col * (cellWidth + gap);
      const cellY = sheetHeight - margin - (row + 1) * cellHeight - row * gap;

      if (drawBorder) {
        sheet.drawRectangle({
          x: cellX,
          y: cellY,
          width: cellWidth,
          height: cellHeight,
          borderColor: rgb(0.82, 0.85, 0.89),
          borderWidth: 0.5,
        });
      }

      sheet.drawPage(embeddedPage, {
        x: cellX + (cellWidth - drawnWidth) / 2,
        y: cellY + (cellHeight - drawnHeight) / 2,
        width: drawnWidth,
        height: drawnHeight,
      });
    }
  }

  return out;
}

function hexToRgb(hex) {
  const cleaned = String(hex || '#374151').replace('#', '').trim();
  const value = /^[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned : '374151';
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  );
}

function systemKoreanFontPath() {
  const candidates = [
    'C:\\Windows\\Fonts\\malgun.ttf',
    'C:\\Windows\\Fonts\\malgunbd.ttf',
    '/System/Library/Fonts/AppleSDGothicNeo.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function embedReadableFont(pdfDoc) {
  const fontPath = systemKoreanFontPath();
  if (fontPath) {
    try {
      pdfDoc.registerFontkit(fontkit);
      return pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: true });
    } catch {
      return pdfDoc.embedFont(StandardFonts.Helvetica);
    }
  }
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

function sendBuffer(res, filename, contentType, buffer, extraHeaders = {}) {
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, String(value)));
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

function sendPdf(res, filename, buffer, extraHeaders) {
  sendBuffer(res, filename, 'application/pdf', buffer, extraHeaders);
}

function safePdfFilename(name, fallback = 'document.pdf') {
  const base = safeDownloadBase(name || fallback) || 'document';
  return `${base}.pdf`;
}

function imageExtensionFromMime(mimeType, fallback = 'png') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  if (mime.includes('tiff')) return 'tif';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('webp')) return 'webp';
  return fallback;
}

function imageMimeFromExtension(filename, fallback = 'image/png') {
  const ext = path.extname(String(filename || '')).replace('.', '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'webp') return 'image/webp';
  return fallback;
}

function safeImageFilename(name, mimeType, fallbackBase = 'image') {
  const ext = imageExtensionFromMime(mimeType, path.extname(String(name || '')).replace('.', '') || 'png');
  const sourceBase = path.basename(String(name || ''), path.extname(String(name || '')));
  const base = safeDownloadBase(sourceBase || fallbackBase) || fallbackBase;
  return `${base}.${ext}`;
}

function powershellCommand() {
  return commandExists('powershell.exe') ? 'powershell.exe'
    : (commandExists('powershell') ? 'powershell'
      : (commandExists('pwsh') ? 'pwsh' : ''));
}

function openNativeSaveDialog(suggestedName) {
  if (process.platform !== 'win32') return { available: false };
  const powershell = powershellCommand();
  if (!powershell) return { available: false };

  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'PDF 저장'
$dialog.Filter = 'PDF 파일 (*.pdf)|*.pdf|모든 파일 (*.*)|*.*'
$dialog.DefaultExt = 'pdf'
$dialog.AddExtension = $true
$dialog.OverwritePrompt = $true
$dialog.FileName = $env:JAMEPDF_SUGGESTED_NAME
if ($env:JAMEPDF_INITIAL_DIR -and [System.IO.Directory]::Exists($env:JAMEPDF_INITIAL_DIR)) {
  $dialog.InitialDirectory = $env:JAMEPDF_INITIAL_DIR
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($dialog.FileName)
  exit 0
}
exit 2
`;

  const result = spawnSync(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: false,
    timeout: 10 * 60 * 1000,
    env: {
      ...process.env,
      JAMEPDF_SUGGESTED_NAME: safePdfFilename(suggestedName),
      JAMEPDF_INITIAL_DIR: path.join(os.homedir(), 'Downloads'),
    },
  });

  if (result.status === 0) {
    const selectedPath = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();
    return selectedPath ? { available: true, selectedPath } : { available: true, error: '저장 경로를 받지 못했습니다.' };
  }
  if (result.status === 2) return { available: true, canceled: true };
  return {
    available: true,
    error: String(result.stderr || result.stdout || '저장 대화상자를 열지 못했습니다.').trim(),
  };
}

function crc32(buffer) {
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));

  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    ((date.getHours() & 0x1F) << 11) |
    ((date.getMinutes() & 0x3F) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1F);
  const year = Math.max(date.getFullYear() - 1980, 0);
  const day =
    ((year & 0x7F) << 9) |
    (((date.getMonth() + 1) & 0x0F) << 5) |
    (date.getDate() & 0x1F);
  return { time, day };
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  files.forEach((file) => {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jamepdf-v4-'));
}

function cleanupTemp(dir) {
  if (dir && fs.existsSync(dir) && dir.startsWith(os.tmpdir())) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function findGhostscriptInDirectory(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return '';

  const exeNames = process.platform === 'win32' ? ['gswin64c.exe', 'gswin32c.exe'] : ['gs'];
  for (const exeName of exeNames) {
    const direct = path.join(rootDir, 'bin', exeName);
    if (fs.existsSync(direct)) return direct;
  }

  try {
    const stack = [{ dir: rootDir, depth: 0 }];
    const matches = [];
    while (stack.length) {
      const current = stack.pop();
      if (!current || current.depth > 4) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          stack.push({ dir: fullPath, depth: current.depth + 1 });
          for (const exeName of exeNames) {
            const candidate = path.join(fullPath, 'bin', exeName);
            if (fs.existsSync(candidate)) matches.push(candidate);
          }
        }
      }
    }
    matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return matches[0] || '';
  } catch {
    return '';
  }
}

function ghostscriptCommand() {
  const configured = process.env.JAMEPDF_GHOSTSCRIPT_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;
  const pathCommand = ['gswin64c', 'gswin32c', 'gs'].find(commandExists);
  if (pathCommand) return pathCommand;

  if (process.platform === 'win32') {
    return [
      findGhostscriptInDirectory(path.join(process.env.LOCALAPPDATA || '', 'Programs')),
      findGhostscriptInDirectory(process.env.ProgramFiles),
      findGhostscriptInDirectory(process.env['ProgramFiles(x86)']),
    ].find(Boolean) || '';
  }

  return '';
}

function findQpdfInDirectory(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return '';

  const exeName = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
  const direct = path.join(rootDir, 'bin', exeName);
  if (fs.existsSync(direct)) return direct;

  try {
    const matches = fs.readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^qpdf/i.test(entry.name))
      .map((entry) => path.join(rootDir, entry.name, 'bin', exeName))
      .filter((candidate) => fs.existsSync(candidate))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return matches[0] || '';
  } catch {
    return '';
  }
}

function qpdfCommand() {
  const configured = process.env.JAMEPDF_QPDF_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;
  if (commandExists('qpdf')) return 'qpdf';

  if (process.platform === 'win32') {
    return [
      findQpdfInDirectory(process.env.ProgramFiles),
      findQpdfInDirectory(process.env['ProgramFiles(x86)']),
      findQpdfInDirectory(path.join(process.env.LOCALAPPDATA || '', 'Programs')),
    ].find(Boolean) || '';
  }

  return '';
}

function pythonCommand() {
  const venvCandidates = process.platform === 'win32'
    ? [
        path.join(userHome, '.jamepdf-v4-hybrid', 'Scripts', 'python.exe'),
        path.join(userHome, '.jamepdf-v3-hybrid', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(userHome, '.jamepdf-v4-hybrid', 'bin', 'python'),
        path.join(userHome, '.jamepdf-v3-hybrid', 'bin', 'python'),
      ];
  const venvPython = venvCandidates.find((candidate) => fs.existsSync(candidate));
  if (venvPython) return venvPython;
  return commandExists('python') ? 'python' : (commandExists('py') ? 'py' : '');
}

function logTail(filePath, maxChars = 4000) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    return content.slice(Math.max(0, content.length - maxChars));
  } catch {
    return '';
  }
}

function requestJsonWithTimeout(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          resolve({});
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function postJsonWithTimeout(url, payload, timeoutMs = AI_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload || {});
    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(responseBody || `HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody || '{}'));
        } catch {
          resolve({ raw: responseBody });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function isFile(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

function expandHome(input) {
  const value = String(input || '').trim();
  if (value === '~') return userHome;
  if (value.startsWith(`~${path.sep}`)) return path.join(userHome, value.slice(2));
  return value;
}

function pathEntries(pathValue = process.env.PATH || '') {
  return String(pathValue || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function findCliCommand(customPath, names, commonPaths = []) {
  const configured = expandHome(customPath);
  if (isFile(configured)) return configured;

  for (const entry of pathEntries()) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (isFile(candidate)) return candidate;
    }
  }

  return commonPaths.find(isFile) || '';
}

function antigravityCommand() {
  const names = process.platform === 'win32'
    ? ['agy.exe', 'agy.cmd', 'agy.bat', 'agy.ps1', 'agy', 'antigravity.exe', 'antigravity.cmd', 'antigravity.bat', 'antigravity.ps1', 'antigravity']
    : ['agy', 'antigravity'];
  const common = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'agy', 'bin', 'agy.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'antigravity-cli', 'agy.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Programs', 'agy', 'agy.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity', 'agy.exe'),
        path.join(process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'), 'npm', 'agy.cmd'),
      ]
    : [
        path.join(userHome, '.local', 'bin', 'agy'),
        path.join(userHome, '.gemini', 'antigravity-cli', 'bin', 'agy'),
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
        '/opt/homebrew/bin/antigravity',
        '/usr/local/bin/antigravity',
      ];
  return findCliCommand(process.env.JAMEPDF_AGY_PATH, names, common);
}

function codexCommand() {
  const names = process.platform === 'win32'
    ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex.ps1', 'codex']
    : ['codex'];
  const common = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'), 'npm', 'codex.cmd'),
        path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Programs', 'Codex', 'codex.exe'),
      ]
    : ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(userHome, '.local', 'bin', 'codex')];
  return findCliCommand(process.env.JAMEPDF_CODEX_PATH, names, common);
}

function claudeCommand() {
  const names = process.platform === 'win32'
    ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude.ps1', 'claude']
    : ['claude'];
  const common = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
        path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Programs', 'Claude', 'claude.exe'),
      ]
    : [path.join(userHome, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return findCliCommand(process.env.JAMEPDF_CLAUDE_PATH, names, common);
}

function findConhost() {
  return [
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'conhost.exe') : '',
    'C:\\Windows\\System32\\conhost.exe',
    'C:\\WINDOWS\\System32\\conhost.exe',
  ].filter(Boolean).find(isFile) || '';
}

function normalizeSpawnTarget(command, args) {
  if (process.platform !== 'win32') {
    return { command, args, shell: false };
  }

  if (/\.(cmd|bat)$/i.test(command)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args], shell: false };
  }

  if (/\.ps1$/i.test(command)) {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
      shell: false,
    };
  }

  return { command, args, shell: false };
}

function runCliCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs || AI_TIMEOUT_MS;
    const env = { ...process.env, ...(options.env || {}) };
    const cwd = options.cwd || userHome || __dirname;
    let target = normalizeSpawnTarget(command, args);
    const pipeStdin = Boolean(options.stdin || options.useConhost);
    let settled = false;

    if (options.useConhost && process.platform === 'win32') {
      const conhost = findConhost();
      if (conhost) {
        target = { command: conhost, args: ['--headless', '--', target.command, ...target.args], shell: false };
      }
    }

    const child = spawn(target.command, target.args, {
      cwd,
      env,
      stdio: pipeStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell: target.shell,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${path.basename(command)} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code && code !== 0) {
        reject(new Error(formatCliFailure(command, code, stderr, stdout)));
        return;
      }
      resolve(cleanAiOutput(stdout || stderr).trim());
    });

    if (options.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}

function cleanAiOutput(text) {
  return String(text || '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[A-PR-Z_]/g, '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (/^(SUCCESS|INFO|성공|정보):?\s*PID\s+\d+/i.test(trimmed)) return false;
      if (/PID\s+\d+.*(process|프로세스|���μ���|���μ���)/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}

function formatCliFailure(command, code, stderr, stdout) {
  const baseName = path.basename(command);
  const detail = cleanAiOutput(stderr || stdout).trim();
  if (/usage limit/i.test(detail)) {
    const resetLine = detail.split(/\r?\n/).find((line) => /usage limit/i.test(line) || /reset/i.test(line));
    return `${baseName} is currently unavailable because the account usage limit was reached.${resetLine ? ` ${resetLine.trim()}` : ''}`;
  }
  if (/invalid_grant|grant not found|sign in|login|authentication/i.test(detail)) {
    return `${baseName} authentication is not ready. Sign in to the CLI again, then retry from JamePDF.`;
  }

  const summary = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^exec\s+/i.test(line))
    .filter((line) => !/JamePDF V4 AI agent panel/i.test(line))
    .slice(0, 12)
    .join('\n');
  return `${baseName} exited with code ${code}${summary ? `\n${summary}` : ''}`;
}

function trimForAi(value, maxChars) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '', null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted]`;
}

function buildAiPrompt(input) {
  const context = input.context || {};
  const parts = [
    'You are the JamePDF V4 AI agent panel.',
    'Help the user analyze PDFs using only the document context included below unless they explicitly ask for broader general knowledge.',
    'Be concise, practical, and honest about missing context. Answer in Korean by default.',
  ];

  if (context.documentName) parts.push(`Document: ${context.documentName}`);
  if (context.page) parts.push(`Current page: ${context.page}`);
  if (context.currentPageText) {
    parts.push(`\n<current_page_text>\n${trimForAi(context.currentPageText, 12000)}\n</current_page_text>`);
  }
  if (context.markdown) {
    parts.push(`\n<extracted_markdown>\n${trimForAi(context.markdown, 22000)}\n</extracted_markdown>`);
  }
  if (context.json) {
    parts.push(`\n<extracted_json>\n${trimForAi(context.json, 18000)}\n</extracted_json>`);
  }

  parts.push(`\n<user_request>\n${String(input.prompt || '').trim()}\n</user_request>`);
  return parts.join('\n\n');
}

async function getOllamaStatus(baseUrl = DEFAULT_OLLAMA_URL) {
  const cleanUrl = String(baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  try {
    const tags = await requestJsonWithTimeout(`${cleanUrl}/api/tags`, 1200);
    const models = Array.isArray(tags.models) ? tags.models.map((model) => model.name).filter(Boolean) : [];
    return {
      available: true,
      url: cleanUrl,
      defaultModel: DEFAULT_GEMMA_MODEL,
      models,
      hasDefaultModel: models.includes(DEFAULT_GEMMA_MODEL),
    };
  } catch (error) {
    return {
      available: false,
      url: cleanUrl,
      defaultModel: DEFAULT_GEMMA_MODEL,
      models: [],
      hasDefaultModel: false,
      error: error.message,
    };
  }
}

async function runOllamaAi(prompt, model, baseUrl = DEFAULT_OLLAMA_URL) {
  const cleanUrl = String(baseUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const response = await postJsonWithTimeout(`${cleanUrl}/api/chat`, {
    model: String(model || DEFAULT_GEMMA_MODEL).trim() || DEFAULT_GEMMA_MODEL,
    stream: false,
    messages: [
      {
        role: 'system',
        content: 'You are a document analysis assistant inside JamePDF. Answer in Korean unless the user asks otherwise.',
      },
      { role: 'user', content: prompt },
    ],
  }, AI_TIMEOUT_MS);
  return response?.message?.content || response?.response || response?.raw || '';
}

async function runCodexAi(prompt) {
  const command = codexCommand();
  if (!command) throw new Error('Codex CLI was not detected. Install Codex CLI or set JAMEPDF_CODEX_PATH.');
  return runCliCommand(command, ['exec', '-C', userHome || __dirname, '--skip-git-repo-check', '--color', 'never', '-s', 'read-only', '-'], {
    cwd: userHome || __dirname,
    stdin: prompt,
    timeoutMs: AI_TIMEOUT_MS,
  });
}

async function runClaudeAi(prompt) {
  const command = claudeCommand();
  if (!command) throw new Error('Claude CLI was not detected. Install Claude Code or set JAMEPDF_CLAUDE_PATH.');
  return runCliCommand(command, ['--print', '--output-format', 'text', '--permission-mode', 'default'], {
    cwd: userHome || __dirname,
    stdin: prompt,
    timeoutMs: AI_TIMEOUT_MS,
  });
}

async function runAntigravityAi(prompt) {
  const command = antigravityCommand();
  if (!command) throw new Error('Antigravity CLI was not detected. Install Antigravity CLI or set JAMEPDF_AGY_PATH.');
  const limitedPrompt = trimForAi(prompt, 26000);
  const args = ['--sandbox', '--print-timeout', '5m', '--print', limitedPrompt];
  return runCliCommand(command, args, {
    cwd: userHome || __dirname,
    timeoutMs: AI_TIMEOUT_MS,
    useConhost: true,
  });
}

async function getHybridStatus(hybridUrl = DEFAULT_HYBRID_URL) {
  const baseUrl = String(hybridUrl || DEFAULT_HYBRID_URL).replace(/\/+$/, '');
  try {
    const health = await requestJsonWithTimeout(`${baseUrl}/health`, 1500);
    return {
      available: true,
      url: baseUrl,
      status: health.status || 'ok',
      pid: hybridProcess && !hybridProcess.killed ? hybridProcess.pid : null,
      log: logTail(HYBRID_LOG_FILE, 1200),
    };
  } catch (error) {
    return {
      available: false,
      url: baseUrl,
      error: error.message,
      pid: hybridProcess && !hybridProcess.killed ? hybridProcess.pid : null,
      log: logTail(HYBRID_LOG_FILE, 1200),
    };
  }
}

function startHybridServerProcess() {
  if (hybridProcess && !hybridProcess.killed && hybridProcess.exitCode === null) {
    return hybridProcess;
  }

  const python = pythonCommand();
  if (!python) {
    throw new Error('Python 실행 파일을 찾지 못했습니다.');
  }
  if (!fs.existsSync(PYTHON_HYBRID_SRC)) {
    throw new Error('Hybrid Python 소스 폴더를 찾지 못했습니다.');
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(
    HYBRID_LOG_FILE,
    `\n\n[${new Date().toISOString()}] starting hybrid OCR/formula server on ${DEFAULT_HYBRID_URL}\n`,
    'utf8',
  );
  const out = fs.openSync(HYBRID_LOG_FILE, 'a');
  const env = {
    ...process.env,
    PYTHONPATH: [PYTHON_HYBRID_SRC, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONUTF8: '1',
  };
  const args = [
    '-m',
    'opendataloader_pdf.hybrid_server',
    '--host',
    HYBRID_HOST,
    '--port',
    String(HYBRID_PORT),
    '--force-ocr',
    '--ocr-lang',
    'ko,en',
    '--enrich-formula',
    '--device',
    'cpu',
  ];

  hybridProcess = spawn(python, args, {
    cwd: path.join(__dirname, '..'),
    env,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  hybridProcess.unref();
  hybridProcess.on('exit', (code, signal) => {
    fs.appendFileSync(
      HYBRID_LOG_FILE,
      `\n[${new Date().toISOString()}] hybrid server exited code=${code} signal=${signal}\n`,
      'utf8',
    );
  });
  return hybridProcess;
}

async function ensureHybridServer(hybridUrl = DEFAULT_HYBRID_URL) {
  let status = await getHybridStatus(hybridUrl);
  if (status.available) return status;

  startHybridServerProcess();
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    status = await getHybridStatus(hybridUrl);
    if (status.available) return status;
    if (hybridProcess && hybridProcess.exitCode !== null) break;
  }

  status = await getHybridStatus(hybridUrl);
  if (!status.available) {
    const tail = logTail(HYBRID_LOG_FILE, 2500);
    throw new Error(
      [
        'Hybrid OCR/Formula 서버를 시작하지 못했습니다.',
        '필요 패키지: pip install "opendataloader-pdf[hybrid]" 또는 V3 hybrid 의존성 설치',
        tail ? `최근 로그:\n${tail}` : '',
      ].filter(Boolean).join('\n'),
    );
  }
  return status;
}

async function extractPdfDocument(id, body = {}) {
  const safeId = safeResultId(id);
  const inputPath = uploadedPdfPath(safeId);
  if (!inputPath) {
    const error = new Error('분석할 PDF 파일을 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const {
    pages = '',
    analysisMode = 'hybrid-ocr-formula',
    markdownWithHtml = true,
    imageOutput = 'off',
    hybridUrl = DEFAULT_HYBRID_URL,
  } = body || {};
  const outputDir = path.join(DATA_DIR, safeId, 'extract');
  fs.mkdirSync(outputDir, { recursive: true });

  const { convert } = require('@opendataloader/pdf');
  const options = {
    outputDir,
    format: ['json', 'markdown'],
    quiet: true,
    markdownWithHtml: Boolean(markdownWithHtml),
    imageOutput: ['off', 'embedded', 'external'].includes(imageOutput) ? imageOutput : 'off',
  };

  const usesHybrid = ['precision', 'hybrid', 'hybrid-ocr-formula'].includes(String(analysisMode));
  let hybrid = null;
  if (usesHybrid) {
    hybrid = await ensureHybridServer(hybridUrl);
    options.keepLineBreaks = true;
    options.tableMethod = 'cluster';
    options.hybrid = 'docling-fast';
    options.hybridMode = 'full';
    options.hybridUrl = hybrid.url;
    options.hybridTimeout = '0';
    options.hybridFallback = false;
  }

  if (typeof pages === 'string' && /^[0-9,\-\s]+$/.test(pages.trim())) {
    options.pages = pages.trim();
  }

  if (options.imageOutput === 'external') {
    options.imageDir = path.join(outputDir, 'images');
    fs.mkdirSync(options.imageDir, { recursive: true });
  }

  await convert([inputPath], options);

  const jsonPath = findOutputFile(outputDir, 'json');
  const mdPath = findOutputFile(outputDir, 'md');
  const json = jsonPath ? normalizeDocumentTextV2(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))) : null;
  const markdown = mdPath ? normalizeExtractedTextV2(fs.readFileSync(mdPath, 'utf8')) : '';
  if (jsonPath && json) {
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  }
  if (mdPath) {
    fs.writeFileSync(mdPath, markdown, 'utf8');
  }
  const summary = json ? summarizeJson(json) : {};

  const history = getHistory();
  const current = history.find((entry) => entry.id === safeId);
  if (current) {
    saveHistoryItem({
      ...current,
      extractedAt: new Date().toISOString(),
      extractSummary: summary,
      hasJson: Boolean(json),
      hasMarkdown: Boolean(markdown),
    });
  }

  return {
    id: safeId,
    inputPath,
    mode: usesHybrid ? 'hybrid-ocr-formula' : 'fast',
    hybrid,
    summary,
    json,
    markdown,
    outputDir,
    downloads: {
      json: `/api/extract/${safeId}/json`,
      markdown: `/api/extract/${safeId}/markdown`,
    },
  };
}

function requiredFile(req, name = 'file') {
  const file = req.file || (req.files && req.files[name] && req.files[name][0]);
  if (!file) {
    const error = new Error('파일이 필요합니다.');
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function toArrayBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) return buffer;
  if (!Buffer.isBuffer(buffer)) return Buffer.from(buffer || '').buffer;
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadKordoc() {
  if (!kordocStudioModulePromise) {
    const entry = path.join(__dirname, 'vendor', 'kordoc', 'dist', 'index.js');
    kordocStudioModulePromise = import(pathToFileURL(entry).href);
  }
  return kordocStudioModulePromise;
}

function kordocResultDir(id) {
  const safeId = safeResultId(id);
  if (!safeId) throw new Error('유효하지 않은 결과 ID입니다.');
  return path.join(KORDOC_DATA_DIR, safeId);
}

function sanitizeKordocValue(value) {
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (Array.isArray(value)) return value.map((item) => sanitizeKordocValue(item));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (key === 'data' && (entry instanceof Uint8Array || Buffer.isBuffer(entry))) {
        out[key] = `[${entry.byteLength || entry.length} bytes]`;
      } else {
        out[key] = sanitizeKordocValue(entry);
      }
    });
    return out;
  }
  return value;
}

function summarizeKordocBlocks(blocks = []) {
  const counts = { total: 0, paragraph: 0, heading: 0, table: 0, image: 0, list: 0, separator: 0 };
  const visit = (items) => {
    (items || []).forEach((block) => {
      if (!block || typeof block !== 'object') return;
      counts.total += 1;
      if (counts[block.type] !== undefined) counts[block.type] += 1;
      if (Array.isArray(block.children)) visit(block.children);
    });
  };
  visit(blocks);
  return counts;
}

function isPdfUpload(file, inputPath = '') {
  const name = String(file?.originalname || inputPath || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : null;
  return mime.includes('pdf')
    || name.endsWith('.pdf')
    || (buffer && buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-');
}

function markdownTableToKordocBlock(lines, pageNumber = 1) {
  const rows = lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => normalizeReadableScienceText(cell.trim())))
    .filter((row) => row.length > 0);
  const cols = Math.max(1, ...rows.map((row) => row.length), 1);
  const cells = rows.map((row) => Array.from({ length: cols }, (_, index) => ({
    text: row[index] || '',
    colSpan: 1,
    rowSpan: 1,
  })));
  return {
    type: 'table',
    text: rows.map((row) => row.join(' | ')).join('\n'),
    table: {
      rows: cells.length,
      cols,
      cells,
      hasHeader: cells.length > 1,
    },
    pageNumber,
  };
}

function markdownToKordocBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let paragraph = [];
  const flushParagraph = () => {
    const text = normalizeReadableScienceText(paragraph.join(' ').trim());
    paragraph = [];
    if (text) blocks.push({ type: 'paragraph', text, pageNumber: 1 });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: normalizeReadableScienceText(heading[2]),
        pageNumber: 1,
      });
      continue;
    }
    if (trimmed.startsWith('|')) {
      flushParagraph();
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      blocks.push(markdownTableToKordocBlock(tableLines));
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph();
      blocks.push({
        type: 'list',
        listType: /^\d/.test(trimmed) ? 'ordered' : 'unordered',
        text: normalizeReadableScienceText(trimmed.replace(/^([-*+]|\d+[.)])\s+/, '')),
        pageNumber: 1,
      });
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

async function extractClassicPdfForKordoc(inputPath, resultDir, body = {}) {
  const outputDir = path.join(resultDir, 'classic-extract');
  fs.mkdirSync(outputDir, { recursive: true });

  const { convert } = require('@opendataloader/pdf');
  const options = {
    outputDir,
    format: ['json', 'markdown'],
    quiet: true,
    markdownWithHtml: true,
    imageOutput: 'off',
  };

  const useHybrid = String(body.formulaOcr ?? 'true') !== 'false';
  let hybrid = null;
  if (useHybrid) {
    hybrid = await ensureHybridServer(DEFAULT_HYBRID_URL);
    options.keepLineBreaks = true;
    options.tableMethod = 'cluster';
    options.hybrid = 'docling-fast';
    options.hybridMode = 'full';
    options.hybridUrl = hybrid.url;
    options.hybridTimeout = '0';
    options.hybridFallback = false;
  }

  if (typeof body.pages === 'string' && /^[0-9,\-\s]+$/.test(body.pages.trim())) {
    options.pages = body.pages.trim();
  }

  await convert([inputPath], options);
  const jsonPath = findOutputFile(outputDir, 'json');
  const mdPath = findOutputFile(outputDir, 'md');
  const json = jsonPath ? normalizeReadableScienceObject(normalizeDocumentTextV2(JSON.parse(fs.readFileSync(jsonPath, 'utf8')))) : null;
  const markdown = mdPath ? normalizeReadableScienceMarkdown(fs.readFileSync(mdPath, 'utf8')) : '';
  if (!markdown.trim()) throw new Error('Classic PDF 분석 결과 Markdown이 비어 있습니다.');

  if (jsonPath && json) fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
  if (mdPath) fs.writeFileSync(mdPath, markdown, 'utf8');

  const summary = json ? summarizeJson(json) : {};
  const blocks = markdownToKordocBlocks(markdown);
  const outline = blocks
    .filter((block) => block.type === 'heading')
    .map((block) => ({ level: block.level || 1, text: block.text || '', pageNumber: block.pageNumber || 1 }));
  const warnings = [];
  if (useHybrid && !hybrid?.available) {
    warnings.push({ message: 'Hybrid OCR/Formula 상태를 확인하지 못했습니다.', code: 'PARTIAL_PARSE' });
  }

  return {
    success: true,
    fileType: 'pdf',
    markdown,
    blocks,
    metadata: { pageCount: summary.pages || undefined },
    outline,
    warnings,
    classicPdfMode: useHybrid ? 'hybrid-ocr-formula' : 'fast',
  };
}

function normalizeKordocTextResult(result) {
  if (!result || !result.success) return;
  result.markdown = normalizeReadableScienceMarkdown(result.markdown || '');
  result.blocks = Array.isArray(result.blocks)
    ? normalizeReadableScienceObject(result.blocks)
    : [];
  result.outline = Array.isArray(result.outline) ? normalizeReadableScienceObject(result.outline) : result.outline;
  result.metadata = result.metadata || {};
}

function saveKordocImages(result, resultDir) {
  const images = Array.isArray(result?.images) ? result.images : [];
  if (!images.length) return [];
  const imageDir = path.join(resultDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  return images.map((image, index) => {
    const filename = safeImageFilename(image.filename || '', image.mimeType || '', `image-${index + 1}`);
    const filePath = path.join(imageDir, filename);
    fs.writeFileSync(filePath, Buffer.from(image.data || []));
    return {
      filename,
      mimeType: image.mimeType || 'application/octet-stream',
      bytes: Buffer.from(image.data || []).length,
      url: `/api/kordoc/results/${path.basename(resultDir)}/images/${encodeURIComponent(filename)}`,
    };
  });
}

function pageSetFromSpec(spec, total) {
  const text = String(spec || '').trim();
  if (!text) return null;
  const selected = new Set();
  text.split(',').forEach((part) => {
    const token = part.trim();
    if (!token) return;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Math.max(1, Number.parseInt(range[1], 10));
      const end = Math.min(total, Number.parseInt(range[2], 10));
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
        if (page >= 1 && page <= total) selected.add(page);
      }
      return;
    }
    const page = Number.parseInt(token, 10);
    if (Number.isFinite(page) && page >= 1 && page <= total) selected.add(page);
  });
  return selected.size ? selected : null;
}

function bgraToRgba(bgra) {
  const out = Buffer.allocUnsafe(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2];
    out[i + 1] = bgra[i + 1];
    out[i + 2] = bgra[i];
    out[i + 3] = bgra[i + 3];
  }
  return out;
}

async function renderPdfPageFallbackImages(inputPath, resultDir, body = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) return [];
  if (String(body.pdfPageImageFallback || 'false') !== 'true') return [];

  const pdfium = require(path.join(__dirname, 'vendor', 'kordoc', 'node_modules', '@hyzyla', 'pdfium', 'dist', 'index.cjs'));
  const sharp = require(path.join(__dirname, 'vendor', 'kordoc', 'node_modules', 'sharp'));
  const lib = await pdfium.PDFiumLibrary.init();
  const doc = await lib.loadDocument(fs.readFileSync(inputPath));
  const imageDir = path.join(resultDir, 'images');
  fs.mkdirSync(imageDir, { recursive: true });

  try {
    const pageCount = doc.getPageCount();
    const selectedPages = pageSetFromSpec(body.pages, pageCount);
    const maxPages = Math.max(1, Math.min(Number.parseInt(body.pdfPageImageMax || '30', 10) || 30, 100));
    const images = [];

    for (const page of doc.pages()) {
      const pageNumber = Number(page.number || images.length + 1);
      if (selectedPages && !selectedPages.has(pageNumber)) continue;
      if (images.length >= maxPages) break;

      const rendered = await page.render({
        scale: 1.35,
        render: async ({ data }) => data,
      });
      const rgba = bgraToRgba(rendered.data);
      const png = await sharp(rgba, {
        raw: { width: rendered.width, height: rendered.height, channels: 4 },
      }).png({ compressionLevel: 8 }).toBuffer();
      const filename = safeImageFilename(`pdf-page-${String(pageNumber).padStart(3, '0')}.png`, 'image/png', `pdf-page-${pageNumber}`);
      const filePath = path.join(imageDir, filename);
      fs.writeFileSync(filePath, png);
      images.push({
        filename,
        mimeType: 'image/png',
        bytes: png.length,
        pageNumber,
        source: 'pdf-page-render',
        url: `/api/kordoc/results/${path.basename(resultDir)}/images/${encodeURIComponent(filename)}`,
      });
    }
    return images;
  } finally {
    doc.destroy();
    lib.destroy();
  }
}

function appendImageRefsToMarkdown(markdown, images, title = 'PDF 페이지 이미지') {
  const refs = (images || [])
    .filter((image) => image?.filename)
    .map((image) => `![${image.pageNumber ? `page ${image.pageNumber}` : 'image'}](${image.filename})`);
  if (!refs.length) return String(markdown || '');
  const body = String(markdown || '').trim();
  return `${body ? `${body}\n\n` : ''}## ${title}\n\n${refs.join('\n\n')}\n`;
}

function stripMarkdownImages(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/(?:^|\n)#{1,6}\s*PDF 페이지 이미지\s*(?=\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function forceKordocTextOnly(result) {
  if (!result || !result.success) return;
  result.markdown = stripMarkdownImages(result.markdown || '');
  if (Array.isArray(result.blocks)) {
    result.blocks = result.blocks.filter((block) => block?.type !== 'image');
  }
  result.images = [];
}

function buildKordocOptions(body = {}, filePath = '') {
  const options = {};
  if (body.pages) options.pages = String(body.pages);
  if (body.removeHeaderFooter === 'true' || body.removeHeaderFooter === true) options.removeHeaderFooter = true;
  if (body.formulaOcr === 'true' || body.formulaOcr === true) options.formulaOcr = true;
  if (filePath) options.filePath = filePath;
  return options;
}

function parseKordocFormValues(body = {}) {
  const raw = body.valuesJson ?? body.values ?? body.formValues ?? '';
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return {};
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        parsed = JSON.parse(`[${text.replace(/}\s*{/g, '},{')}]`);
      } catch {
        const values = {};
        text.split(/\r?\n|,/).forEach((line) => {
          const match = String(line).match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
          if (match && match[1].trim()) {
            const key = match[1].trim().replace(/^["']|["']$/g, '');
            const value = match[2].trim().replace(/^["']|["']?[,]?$/g, '');
            values[key] = value;
          }
        });
        parsed = values;
      }
    }
  }
  if (!parsed || typeof parsed !== 'object') return {};
  return normalizeKordocFormValues(parsed);
}

function repeatedValueKey(label, occurrence) {
  const base = String(label || '').trim();
  return occurrence > 1 ? `${base} ${occurrence}` : base;
}

function normalizeKordocFormValues(parsed) {
  const entries = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((row, rowIndex) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return;
      Object.entries(row).forEach(([key, value]) => {
        entries.push([repeatedValueKey(key, rowIndex + 1), value]);
      });
    });
  } else {
    Object.entries(parsed).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => entries.push([repeatedValueKey(key, index + 1), item]));
      } else {
        entries.push([key, value]);
      }
    });
  }
  return Object.fromEntries(
    entries
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value),
  );
}

function decodeXmlText(value) {
  return decodeBasicHtmlEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function stripHwpxCellText(cellXml) {
  const parts = [];
  const tRegex = /<[^:>]*:?t\b[^>]*>([\s\S]*?)<\/[^:>]*:?t>/gi;
  let match;
  while ((match = tRegex.exec(String(cellXml || ''))) !== null) {
    parts.push(decodeXmlText(match[1].replace(/<[^>]+>/g, '')));
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function isLikelyFormLabel(text) {
  const value = String(text || '').replace(/[:：\s]+$/g, '').trim();
  if (!value || value.length > 30) return false;
  if (/^[0-9.,\-\s]+$/.test(value)) return false;
  if (/[。.!?]$/.test(value) && value.length > 12) return false;
  return /[A-Za-z가-힣]/.test(value);
}

function parseHwpxRowCells(rowInner, rowIndex = 0) {
  const cells = [];
  const cellRegex = /<[^:>]*:?tc\b[^>]*>[\s\S]*?<\/[^:>]*:?tc>/gi;
  let cellMatch;
  let colIndex = 0;
  while ((cellMatch = cellRegex.exec(String(rowInner || ''))) !== null) {
    cells.push({
      full: cellMatch[0],
      start: cellMatch.index,
      end: cellMatch.index + cellMatch[0].length,
      text: stripHwpxCellText(cellMatch[0]),
      rowIndex,
      colIndex,
    });
    colIndex += 1;
  }
  return cells;
}

function rebuildHwpxRowInner(rowInner, cells, replacements) {
  let rebuilt = '';
  let cursor = 0;
  cells.forEach((cell, index) => {
    rebuilt += rowInner.slice(cursor, cell.start);
    rebuilt += replacements.get(index) || cell.full;
    cursor = cell.end;
  });
  rebuilt += rowInner.slice(cursor);
  return rebuilt;
}

function hwpxHeaderFieldsFromCells(cells = [], nextCells, targetRowIndex) {
  const nonEmpty = cells
    .map((cell, index) => ({
      ...cell,
      colIndex: Number.isFinite(cell.colIndex) ? cell.colIndex : index,
      label: String(cell.text || '').replace(/[:：\s]+$/g, '').trim(),
    }))
    .filter((cell) => cell.label);
  if (nonEmpty.length < 2) return [];
  if (!nonEmpty.every((cell) => isLikelyFormLabel(cell.label))) return [];

  const minCol = Math.min(...nonEmpty.map((cell) => cell.colIndex));
  const maxCol = Math.max(...nonEmpty.map((cell) => cell.colIndex));
  const hasNoGapsBetweenLabels = (maxCol - minCol + 1) === nonEmpty.length;
  if (!hasNoGapsBetweenLabels) return [];

  if (Array.isArray(nextCells)) {
    const hasEmptyTargets = nonEmpty.every((cell) => {
      const target = nextCells.find((nextCell) => nextCell.colIndex === cell.colIndex);
      return target && !String(target.text || '').trim();
    });
    if (!hasEmptyTargets) return [];
  }

  const targetRow = Number.isFinite(Number(targetRowIndex))
    ? Number(targetRowIndex)
    : (cellRowIndex(nonEmpty[0]) + 1);

  return nonEmpty.map((cell) => ({
    label: cell.label,
    value: '',
    row: targetRow,
    col: cell.colIndex,
    sourceRow: cell.rowIndex ?? 0,
    targetRow,
    targetCol: cell.colIndex,
    pattern: 'header-row',
  }));
}

function cellRowIndex(cell) {
  return Number.isFinite(Number(cell?.rowIndex)) ? Number(cell.rowIndex) : 0;
}

function hwpxHeaderTargetRows(rows, headerRowIndex, headerFields) {
  const targetRows = [];
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const cells = rows[index]?.cells || [];
    const isEmptyTargetRow = headerFields.every((field) => {
      const target = cells.find((cell) => cell.colIndex === field.col);
      return target && !String(target.text || '').trim();
    });
    if (!isEmptyTargetRow) break;
    targetRows.push(rows[index]);
  }
  return targetRows;
}

async function extractHwpxFormFieldsFallback(buffer) {
  const JSZip = loadKordocJsZip();
  const zip = await JSZip.loadAsync(Buffer.from(buffer));
  const fields = [];
  const seen = new Set();
  const sectionFiles = Object.keys(zip.files)
    .filter((name) => /[Ss]ection\d+\.xml$/i.test(name))
    .sort();

  for (const sectionPath of sectionFiles) {
    const entry = zip.file(sectionPath);
    if (!entry) continue;
    const xml = await entry.async('text');
    const rowRegex = /<[^:>]*:?tr\b[^>]*>([\s\S]*?)<\/[^:>]*:?tr>/gi;
    let rowMatch;
    const rows = [];
    while ((rowMatch = rowRegex.exec(xml)) !== null) {
      const rowIndex = rows.length;
      rows.push({ rowIndex, cells: parseHwpxRowCells(rowMatch[1], rowIndex) });
    }

    for (const row of rows) {
      const { cells, rowIndex } = row;

      const headerFields = hwpxHeaderFieldsFromCells(cells, rows[rowIndex + 1]?.cells || []);
      if (headerFields.length) {
        const targetRows = hwpxHeaderTargetRows(rows, rowIndex, headerFields);
        const rowFields = targetRows.length
          ? targetRows.flatMap((targetRow) => hwpxHeaderFieldsFromCells(cells, targetRow.cells, targetRow.rowIndex))
          : headerFields;
        rowFields.forEach((field) => {
          const key = `${field.label}:${field.targetRow}:${field.targetCol}:header`;
          if (seen.has(key)) return;
          seen.add(key);
          fields.push(field);
        });
        continue;
      }

      for (let colIndex = 0; colIndex < cells.length - 1; colIndex += 1) {
        const label = cells[colIndex].text.replace(/[:：\s]+$/g, '').trim();
        const value = cells[colIndex + 1].text.trim();
        if (!isLikelyFormLabel(label)) continue;
        if (value && isLikelyFormLabel(value)) continue;
        const key = `${label}:${rowIndex}:${colIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fields.push({ label, value, row: rowIndex, col: colIndex });
      }
    }
  }
  return fields;
}

function mergeFormFields(primary = [], fallback = []) {
  const merged = [];
  const seen = new Set();
  [...primary, ...fallback].forEach((field) => {
    const label = String(field?.label || '').trim();
    if (!label) return;
    const key = [
      label,
      Number.isFinite(Number(field?.row)) ? Number(field.row) : '',
      Number.isFinite(Number(field?.col)) ? Number(field.col) : '',
      Number.isFinite(Number(field?.targetRow)) ? Number(field.targetRow) : '',
      Number.isFinite(Number(field?.targetCol)) ? Number(field.targetCol) : '',
      field?.pattern || '',
    ].join(':');
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...field, label });
  });
  return merged;
}

function assignFormFieldValueKeys(fields = []) {
  const counts = new Map();
  return fields.map((field) => {
    const label = String(field?.label || '').trim();
    if (!label) return field;
    const occurrence = (counts.get(label) || 0) + 1;
    counts.set(label, occurrence);
    return { ...field, label, occurrence, valueKey: repeatedValueKey(label, occurrence) };
  });
}

function normalizeFormLabelForMatch(value) {
  return String(value || '')
    .replace(/[:：()\[\]{}ㆍ·\s]/g, '')
    .trim()
    .toLowerCase();
}

function findFormValueKey(label, values, excluded = new Set()) {
  const normalizedLabel = normalizeFormLabelForMatch(label);
  if (!normalizedLabel) return '';
  const entries = Object.keys(values || {})
    .filter((key) => !excluded.has(key))
    .map((key) => [key, normalizeFormLabelForMatch(key)]);
  const exact = entries.find(([, normalizedKey]) => normalizedKey === normalizedLabel);
  if (exact) return exact[0];
  let best = '';
  let bestLen = 0;
  entries.forEach(([key, normalizedKey]) => {
    if (!normalizedKey) return;
    const matched = normalizedLabel.startsWith(normalizedKey)
      ? normalizedKey.length >= normalizedLabel.length * 0.6
      : normalizedKey.startsWith(normalizedLabel) && normalizedLabel.length >= normalizedKey.length * 0.6;
    const score = Math.min(normalizedKey.length, normalizedLabel.length);
    if (matched && score > bestLen) {
      best = key;
      bestLen = score;
    }
  });
  return best;
}

function replaceFirstHwpxCellText(cellXml, value) {
  const escaped = escapeXmlText(value);
  let replaced = false;
  let next = String(cellXml || '').replace(/(<[^:>]*:?t\b[^>]*>)([\s\S]*?)(<\/[^:>]*:?t>)/gi, (match, open, body, close) => {
    if (!replaced) {
      replaced = true;
      return `${open}${escaped}${close}`;
    }
    return `${open}${close}`;
  });
  if (replaced) return next;

  next = next.replace(/<([^:>\s]+:)?run\b([^>]*)\/>/i, (match, prefix = '', attrs = '') => {
    replaced = true;
    return `<${prefix || ''}run${attrs}><${prefix || ''}t>${escaped}</${prefix || ''}t></${prefix || ''}run>`;
  });
  if (replaced) return next;

  next = next.replace(/(<((?:[^:>\s]+:)?)run\b[^>]*>)([\s\S]*?)(<\/(?:[^:>\s]+:)?run>)/i, (match, open, prefix = '', body, close) => {
    replaced = true;
    return `${open}${body}<${prefix || ''}t>${escaped}</${prefix || ''}t>${close}`;
  });
  if (replaced) return next;

  return next.replace(/(<[^:>]*:?subList\b[^>]*>)/i, `$1<hp:p><hp:run><hp:t>${escaped}</hp:t></hp:run></hp:p>`);
}

async function fillHwpxFormPreserveFallback(buffer, values) {
  const JSZip = loadKordocJsZip();
  const zip = await JSZip.loadAsync(Buffer.from(buffer));
  const filled = [];
  const matchedKeys = new Set();
  const sectionFiles = Object.keys(zip.files)
    .filter((name) => /[Ss]ection\d+\.xml$/i.test(name))
    .sort();

  for (const sectionPath of sectionFiles) {
    const entry = zip.file(sectionPath);
    if (!entry) continue;
    let xml = await entry.async('text');
    let sectionChanged = false;
    let rowIndex = 0;
    let pendingHeaderLabels = [];
    xml = xml.replace(/(<[^:>]*:?tr\b[^>]*>)([\s\S]*?)(<\/[^:>]*:?tr>)/gi, (rowFull, rowOpen, rowInner, rowClose) => {
      const cells = parseHwpxRowCells(rowInner, rowIndex);
      if (!cells.length) {
        rowIndex += 1;
        return rowFull;
      }

      if (pendingHeaderLabels.length) {
        const isEmptyTargetRow = pendingHeaderLabels.every((target) => {
          const cell = cells.find((candidate) => candidate.colIndex === target.colIndex);
          return cell && !String(cell.text || '').trim();
        });
        if (!isEmptyTargetRow) {
          pendingHeaderLabels = [];
        }
      }

      if (pendingHeaderLabels.length) {
        const replacements = new Map();
        pendingHeaderLabels.forEach((target) => {
          const key = findFormValueKey(target.label, values, matchedKeys);
          if (!key || matchedKeys.has(key)) return;
          const cell = cells.find((candidate) => candidate.colIndex === target.colIndex);
          if (!cell || String(cell.text || '').trim()) return;
          const value = String(values[key] ?? '');
          replacements.set(cell.colIndex, replaceFirstHwpxCellText(cell.full, value));
          matchedKeys.add(key);
          filled.push({ label: key, value, row: rowIndex, col: target.colIndex, pattern: 'header-row' });
          sectionChanged = true;
        });
        if (replacements.size) {
          const rebuilt = rebuildHwpxRowInner(rowInner, cells, replacements);
          rowIndex += 1;
          return `${rowOpen}${rebuilt}${rowClose}`;
        }
      }

      const headerFields = hwpxHeaderFieldsFromCells(cells);
      if (headerFields.length) {
        pendingHeaderLabels = headerFields
          .map((field) => ({ colIndex: field.col, label: field.label }))
          .filter((target) => findFormValueKey(target.label, values, matchedKeys));
        rowIndex += 1;
        return rowFull;
      }

      if (cells.length < 2) {
        rowIndex += 1;
        return rowFull;
      }

      const replacements = new Map();
      for (let colIndex = 0; colIndex < cells.length - 1; colIndex += 1) {
        const key = findFormValueKey(cells[colIndex].text, values, matchedKeys);
        if (!key || matchedKeys.has(key)) continue;
        const nextText = cells[colIndex + 1].text;
        if (nextText && isLikelyFormLabel(nextText)) continue;
        const value = String(values[key] ?? '');
        replacements.set(colIndex + 1, replaceFirstHwpxCellText(cells[colIndex + 1].full, value));
        matchedKeys.add(key);
        filled.push({ label: key, value, row: rowIndex, col: colIndex });
        sectionChanged = true;
      }

      if (!replacements.size) {
        rowIndex += 1;
        return rowFull;
      }
      const rebuilt = rebuildHwpxRowInner(rowInner, cells, replacements);
      rowIndex += 1;
      return `${rowOpen}${rebuilt}${rowClose}`;
    });
    if (sectionChanged) zip.file(sectionPath, xml);
  }

  const unmatched = Object.keys(values || {}).filter((key) => !matchedKeys.has(key));
  const output = await zip.generateAsync({ type: 'arraybuffer' });
  return { output, fill: { filled, unmatched } };
}

function mergeFillSummaries(primary = {}, fallback = {}, values = {}) {
  const filled = [];
  const seen = new Set();
  [...(primary.filled || []), ...(fallback.filled || [])].forEach((field) => {
    const label = String(field?.label || '').trim();
    const key = normalizeFormLabelForMatch(label);
    if (!label || seen.has(key)) return;
    seen.add(key);
    filled.push(field);
  });
  const unmatched = Object.keys(values || {}).filter((key) => !seen.has(normalizeFormLabelForMatch(key)));
  return { filled, unmatched };
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function htmlAttrInt(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = Number.parseInt(match?.[1] || match?.[2] || match?.[3] || '1', 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 50) : 1;
}

function htmlCellText(value) {
  return decodeBasicHtmlEntities(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<\/p\s*>/gi, ' / ')
    .replace(/<\/div\s*>/gi, ' / ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s*\/\s*(?:\/\s*)+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function markdownTableCell(value) {
  return String(value || '')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlTableToMarkdown(tableHtml) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rawRow = rowMatch[1];
    const rowIndex = rows.length;
    const gridRow = rows[rowIndex] || [];
    rows[rowIndex] = gridRow;
    const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    let colIndex = 0;

    while ((cellMatch = cellRegex.exec(rawRow)) !== null) {
      while (gridRow[colIndex] !== undefined) colIndex += 1;
      const attrs = cellMatch[2] || '';
      const colSpan = htmlAttrInt(attrs, 'colspan');
      const rowSpan = htmlAttrInt(attrs, 'rowspan');
      const text = markdownTableCell(htmlCellText(cellMatch[3]));

      for (let dr = 0; dr < rowSpan; dr += 1) {
        const targetRow = rowIndex + dr;
        if (!rows[targetRow]) rows[targetRow] = [];
        for (let dc = 0; dc < colSpan; dc += 1) {
          const targetCol = colIndex + dc;
          rows[targetRow][targetCol] = dr === 0 && dc === 0 ? text : '';
        }
      }
      colIndex += colSpan;
    }
  }

  const nonEmptyRows = rows
    .map((row) => row || [])
    .filter((row) => row.some((cell) => String(cell || '').trim()));
  if (!nonEmptyRows.length) return '';

  const colCount = Math.max(...nonEmptyRows.map((row) => row.length), 1);
  const normalizedRows = nonEmptyRows.map((row) => Array.from({ length: colCount }, (_, idx) => markdownTableCell(row[idx] || '')));
  const separator = Array.from({ length: colCount }, () => '---');
  const lines = [
    normalizedRows[0],
    separator,
    ...normalizedRows.slice(1),
  ].map((row) => `| ${row.join(' | ')} |`);
  return `\n${lines.join('\n')}\n`;
}

function markdownForHwpxRecreate(markdown) {
  return String(markdown || '').replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
    const converted = htmlTableToMarkdown(tableHtml);
    return converted || tableHtml;
  });
}

function loadKordocJsZip() {
  return require(path.join(__dirname, 'vendor', 'kordoc', 'node_modules', 'jszip'));
}

function escapeXmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageDimensions(buffer) {
  const data = Buffer.from(buffer || []);
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && data.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 26 && data.subarray(0, 2).toString('ascii') === 'BM') {
    return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return { width: 640, height: 360 };
}

function hwpxImageSize(buffer) {
  const dims = imageDimensions(buffer);
  const pxWidth = Math.max(1, dims.width || 640);
  const pxHeight = Math.max(1, dims.height || 360);
  const maxWidth = 42000;
  const maxHeight = 30000;
  const unitPerPixel = 60;
  const width = Math.max(1200, Math.round(pxWidth * unitPerPixel));
  const height = Math.max(1200, Math.round(pxHeight * unitPerPixel));
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function parseDataUrlImage(ref) {
  const match = String(ref || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  return {
    data: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
    mimeType,
    sourceName: `inline.${imageExtensionFromMime(mimeType)}`,
  };
}

function imageRefToFilename(ref) {
  const text = decodeURIComponent(String(ref || '').split('#')[0].split('?')[0]).replace(/\\/g, '/');
  if (text.startsWith('/api/kordoc/results/')) return path.basename(text);
  return path.basename(text);
}

function resolveKordocImageAsset(ref, sourceId) {
  const dataUrl = parseDataUrlImage(ref);
  if (dataUrl) return dataUrl;
  const filename = imageRefToFilename(ref);
  const safeFilename = path.basename(filename || '');
  if (!safeFilename || !sourceId) return null;
  const dir = kordocResultDir(sourceId);
  const imagePath = path.join(dir, 'images', safeFilename);
  const resolvedDir = path.resolve(dir, 'images');
  const resolvedImage = path.resolve(imagePath);
  if (!resolvedImage.startsWith(resolvedDir) || !fs.existsSync(resolvedImage)) return null;
  return {
    data: fs.readFileSync(resolvedImage),
    mimeType: imageMimeFromExtension(safeFilename),
    sourceName: safeFilename,
  };
}

function prepareHwpxImageMarkdown(markdown, sourceId) {
  const assets = [];
  const addAsset = (alt, ref) => {
    const resolved = resolveKordocImageAsset(ref, sourceId);
    if (!resolved || !resolved.data?.length) return alt ? `[이미지: ${alt}]` : '';
    const index = assets.length + 1;
    const ext = imageExtensionFromMime(resolved.mimeType, path.extname(resolved.sourceName).replace('.', '') || 'png');
    const refId = `image${index}`;
    const zipName = `${refId}.${ext}`;
    const marker = `AIIIMG${String(index).padStart(3, '0')}TOKEN`;
    assets.push({
      marker,
      alt: alt || path.basename(resolved.sourceName || zipName),
      refId,
      zipName,
      mimeType: resolved.mimeType || imageMimeFromExtension(zipName),
      data: Buffer.from(resolved.data),
    });
    return `\n\n${marker}\n\n`;
  };

  let normalized = String(markdown || '').replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (match, alt, ref) => addAsset(alt, ref));
  normalized = normalized.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const srcMatch = String(attrs || '').match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!srcMatch) return '';
    const altMatch = String(attrs || '').match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return addAsset(altMatch?.[1] || altMatch?.[2] || altMatch?.[3] || '', srcMatch[1] || srcMatch[2] || srcMatch[3] || '');
  });
  return { markdown: normalized, assets };
}

function generateHwpxPictureXml(asset, index) {
  const dims = imageDimensions(asset.data);
  const size = hwpxImageSize(asset.data);
  const width = size.width;
  const height = size.height;
  const orgWidth = Math.max(1, Math.round((dims.width || 640) * 100));
  const orgHeight = Math.max(1, Math.round((dims.height || 360) * 100));
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const picId = 5000 + index;
  const instanceId = 700000 + index;
  const ref = escapeXmlText(asset.refId || asset.zipName);
  const alt = escapeXmlText(asset.alt || asset.zipName);
  return `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instanceId}" reverse="0">`
    + `<hp:offset x="0" y="0"/>`
    + `<hp:orgSz width="${orgWidth}" height="${orgHeight}"/>`
    + `<hp:curSz width="${width}" height="${height}"/>`
    + `<hp:flip horizontal="0" vertical="0"/>`
    + `<hp:rotationInfo angle="0" centerX="${centerX}" centerY="${centerY}" rotateimage="1"/>`
    + `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`
    + `<hc:img binaryItemIDRef="${ref}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>`
    + `<hp:imgRect>`
    + `<hc:pt0 x="0" y="0"/><hc:pt1 x="${orgWidth}" y="0"/><hc:pt2 x="${orgWidth}" y="${orgHeight}"/><hc:pt3 x="0" y="${orgHeight}"/>`
    + `</hp:imgRect>`
    + `<hp:imgClip left="0" right="${orgWidth}" top="0" bottom="${orgHeight}"/>`
    + `<hp:inMargin left="0" right="0" top="0" bottom="0"/>`
    + `<hp:imgDim dimwidth="${orgWidth}" dimheight="${orgHeight}"/>`
    + `<hp:effects/>`
    + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`
    + `<hp:shapeComment>${alt}</hp:shapeComment>`
    + `</hp:pic>`;
}

function injectHwpxImageManifest(contentHpf, assets) {
  if (!assets.length) return contentHpf;
  const items = assets.map((asset, idx) => `    <opf:item id="${escapeXmlText(asset.refId || `image${idx + 1}`)}" href="BinData/${escapeXmlText(asset.zipName)}" media-type="${escapeXmlText(asset.mimeType)}" isEmbeded="1"/>`).join('\n');
  return String(contentHpf || '').replace(/(\s*<\/opf:manifest>)/, `\n${items}$1`);
}

function injectHwpxImageHeader(headerXml, assets) {
  return headerXml;
}

function ensureHwpxCoreNamespace(sectionXml) {
  const source = String(sectionXml || '');
  if (/\sxmlns:hc=/.test(source)) return source;
  return source.replace(/<hs:sec\b/, '<hs:sec xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"');
}

async function injectImagesIntoHwpx(hwpxBuffer, assets) {
  if (!assets.length) return Buffer.from(hwpxBuffer);
  const JSZip = loadKordocJsZip();
  const zip = await JSZip.loadAsync(Buffer.from(hwpxBuffer));
  for (const asset of assets) {
    zip.file(`BinData/${asset.zipName}`, asset.data);
  }
  const sectionPath = 'Contents/section0.xml';
  let sectionXml = ensureHwpxCoreNamespace(await zip.file(sectionPath).async('string'));
  assets.forEach((asset, idx) => {
    const marker = escapeXmlText(asset.marker);
    sectionXml = sectionXml.replace(`<hp:t>${marker}</hp:t>`, generateHwpxPictureXml(asset, idx + 1));
  });
  zip.file(sectionPath, sectionXml);

  const headerPath = 'Contents/header.xml';
  const headerFile = zip.file(headerPath);
  if (headerFile) {
    zip.file(headerPath, injectHwpxImageHeader(await headerFile.async('string'), assets));
  }

  const manifestPath = 'Contents/content.hpf';
  const manifestFile = zip.file(manifestPath);
  if (manifestFile) {
    zip.file(manifestPath, injectHwpxImageManifest(await manifestFile.async('string'), assets));
  }

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function kordocJsonResponse(id, originalName, result, html, images) {
  const sanitized = sanitizeKordocValue(result);
  return {
    id,
    originalName,
    success: Boolean(result?.success),
    fileType: result?.fileType || 'unknown',
    markdown: result?.success ? result.markdown || '' : '',
    html: html || '',
    metadata: result?.metadata || null,
    outline: result?.outline || [],
    warnings: result?.warnings || [],
    blockSummary: summarizeKordocBlocks(result?.blocks || []),
    images,
    json: sanitized,
    downloads: {
      markdown: `/api/kordoc/results/${id}/markdown`,
      json: `/api/kordoc/results/${id}/json`,
      html: `/api/kordoc/results/${id}/html`,
    },
  };
}

function requireLocalUpdateRequest(req) {
  const origin = String(req.get('Origin') || '');
  const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
  ]);
  if (!allowedOrigins.has(origin)) {
    const error = new Error('업데이트 설치는 James PDF 앱 화면에서만 실행할 수 있습니다.');
    error.statusCode = 403;
    throw error;
  }
}

app.get('/api/update/status', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const status = await updateService.check(String(req.query.force || '') === '1');
    res.json(status);
  } catch (error) {
    res.json({
      configured: true,
      currentVersion: APP_VERSION,
      available: false,
      installable: false,
      error: error.message,
    });
  }
}));

app.post('/api/update/install', asyncRoute(async (req, res) => {
  requireLocalUpdateRequest(req);
  if (updateInstallInProgress) {
    res.status(409).json({ error: '업데이트 설치가 이미 진행 중입니다.' });
    return;
  }
  updateInstallInProgress = true;
  try {
    const prepared = await updateService.prepareInstall();
    updateService.launchPreparedInstaller(prepared.installerPath, process.pid);
    res.once('finish', () => setTimeout(() => process.exit(0), 900));
    res.json({
      started: true,
      version: prepared.update.latestVersion,
      message: '설치 파일 검증이 완료되었습니다. James PDF를 업데이트하고 다시 시작합니다.',
    });
  } catch (error) {
    updateInstallInProgress = false;
    throw error;
  }
}));

app.get('/api/health', asyncRoute(async (req, res) => {
  const gs = ghostscriptCommand();
  const qpdf = qpdfCommand();
  const hybrid = await getHybridStatus();
  res.json({
    ok: true,
    version: APP_VERSION,
    appName: APP_NAME,
    storage: {
      uploads: fs.existsSync(UPLOADS_DIR),
      data: fs.existsSync(DATA_DIR),
    },
    dependencies: {
      localDependencyPath: LOCAL_DEP_NODE_MODULES,
      sharedNodeModules: SHARED_NODE_MODULES,
      pdfLib: true,
      converterJar: fs.existsSync(converterJarPath()),
      javaAvailable: commandExists('java'),
      detectedJavaBin: DETECTED_JAVA_BIN,
      koreanFont: systemKoreanFontPath(),
      ghostscript: gs ? commandPath(gs) : '',
      qpdf: qpdf ? commandPath(qpdf) : '',
      hybridPythonSource: fs.existsSync(PYTHON_HYBRID_SRC),
      hybrid,
      kordocStudio: {
        source: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'src')),
        dist: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'dist', 'index.js')),
        pdfjs: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'node_modules', 'pdfjs-dist')),
        puppeteerCore: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'node_modules', 'puppeteer-core')),
      },
    },
  });
}));

app.get('/api/kordoc/health', asyncRoute(async (req, res) => {
  const kordoc = await loadKordoc();
  res.json({
    ok: true,
    name: 'James Studio',
    version: APP_VERSION,
    exports: ['parse', 'detectFormat', 'markdownToHwpx', 'renderHtml', 'markdownToPdf', 'compare', 'extractFormFields']
      .filter((name) => typeof kordoc[name] === 'function'),
    vendor: {
      source: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'src')),
      dist: fs.existsSync(path.join(__dirname, 'vendor', 'kordoc', 'dist', 'index.js')),
    },
  });
}));

app.post('/api/kordoc/parse', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const kordoc = await loadKordoc();
  const id = crypto.randomUUID();
  const resultDir = kordocResultDir(id);
  fs.mkdirSync(resultDir, { recursive: true });
  const originalName = safeOriginalName(file.originalname || 'document');
  const inputPath = path.join(resultDir, originalName.replace(/[\\/:*?"<>|]+/g, '-'));
  fs.writeFileSync(inputPath, file.buffer);
  const options = buildKordocOptions(req.body || {}, inputPath);
  const pdfInput = isPdfUpload(file, inputPath);
  let result;
  let classicError = null;
  if (pdfInput) {
    try {
      result = await extractClassicPdfForKordoc(inputPath, resultDir, req.body || {});
    } catch (error) {
      classicError = error;
    }
  }
  if (!result) {
    result = await kordoc.parse(toArrayBuffer(file.buffer), options);
    normalizeKordocTextResult(result);
    if (classicError && result?.success) {
      result.warnings = Array.isArray(result.warnings) ? result.warnings : [];
      result.warnings.push({
        message: `Classic PDF 수식 보정 실패 후 Kordoc 파서로 처리했습니다: ${classicError.message || String(classicError)}`,
        code: 'PARTIAL_PARSE',
      });
    }
  } else {
    normalizeKordocTextResult(result);
  }
  forceKordocTextOnly(result);
  let images = [];
  if (result.success && result.fileType === 'pdf' && images.length === 0) {
    images = await renderPdfPageFallbackImages(inputPath, resultDir, req.body || {});
    if (images.length) {
      result.blocks = Array.isArray(result.blocks) ? result.blocks : [];
      images.forEach((image) => {
        result.blocks.push({ type: 'image', text: image.filename, pageNumber: image.pageNumber || 1 });
      });
      result.images = images.map((image) => ({
        filename: image.filename,
        mimeType: image.mimeType,
        data: `[${image.bytes} bytes]`,
      }));
      result.markdown = appendImageRefsToMarkdown(result.markdown || '', images);
    }
  }
  forceKordocTextOnly(result);
  const finalHtml = result.success && typeof kordoc.renderHtml === 'function'
    ? kordoc.renderHtml(result.markdown || '', { preset: req.body?.preset || 'default' })
    : '';
  images = [];
  const response = kordocJsonResponse(id, originalName, result, finalHtml, images);
  writeJson(path.join(resultDir, 'result.json'), response.json);
  fs.writeFileSync(path.join(resultDir, 'result.md'), response.markdown || '', 'utf8');
  fs.writeFileSync(path.join(resultDir, 'result.html'), response.html || '', 'utf8');
  writeJson(path.join(resultDir, 'summary.json'), {
    id,
    originalName,
    fileType: response.fileType,
    metadata: response.metadata,
    outline: response.outline,
    warnings: response.warnings,
    blockSummary: response.blockSummary,
    images,
  });
  res.json(response);
}));

app.post('/api/kordoc/recreate', asyncRoute(async (req, res) => {
  const kordoc = await loadKordoc();
  const markdown = normalizeReadableScienceMarkdown(String(req.body?.markdown || ''));
  if (!markdown.trim()) {
    res.status(400).json({ error: '재생성할 Markdown이 필요합니다.' });
    return;
  }
  const base = safeDownloadBase(req.body?.filename || 'kordoc-output') || 'kordoc-output';
  const format = String(req.body?.format || 'hwpx').toLowerCase();
  if (format === 'html') {
    const html = kordoc.renderHtml(markdown, { preset: req.body?.preset || 'default' });
    sendBuffer(res, `${base}.html`, 'text/html; charset=utf-8', Buffer.from(html, 'utf8'));
    return;
  }
  if (format === 'pdf') {
    const pdf = await kordoc.markdownToPdf(markdown, { preset: req.body?.preset || 'default' });
    sendBuffer(res, `${base}.pdf`, 'application/pdf', Buffer.from(pdf));
    return;
  }
  const hwpxMarkdown = stripMarkdownImages(markdownForHwpxRecreate(markdown));
  const hwpx = await kordoc.markdownToHwpx(hwpxMarkdown);
  sendBuffer(res, `${base}.hwpx`, 'application/vnd.hancom.hwpx', Buffer.from(hwpx));
}));

app.post('/api/kordoc/compare', memoryUpload.array('files', 2), asyncRoute(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length < 2) {
    res.status(400).json({ error: '비교할 문서 2개가 필요합니다.' });
    return;
  }
  const kordoc = await loadKordoc();
  const diff = await kordoc.compare(toArrayBuffer(files[0].buffer), toArrayBuffer(files[1].buffer), buildKordocOptions(req.body || {}));
  res.json(sanitizeKordocValue(diff));
}));

app.post('/api/kordoc/forms', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const kordoc = await loadKordoc();
  const result = await kordoc.parse(toArrayBuffer(file.buffer), buildKordocOptions(req.body || {}));
  if (!result.success) {
    res.status(422).json(sanitizeKordocValue(result));
    return;
  }
  const form = kordoc.extractFormFields(result.blocks || []);
  if (result.fileType === 'hwpx') {
    const fallbackFields = await extractHwpxFormFieldsFallback(file.buffer);
    const headerFields = fallbackFields.filter((field) => field.pattern === 'header-row');
    if (headerFields.length) {
      const otherFallbackFields = fallbackFields.filter((field) => field.pattern !== 'header-row');
      form.fields = mergeFormFields(headerFields, otherFallbackFields);
      if (Number(form.confidence || 0) < 0.8) form.confidence = 0.8;
    } else {
      form.fields = mergeFormFields(form.fields || [], fallbackFields);
      if (fallbackFields.length > 0 && Number(form.confidence || 0) < 0.5) form.confidence = 0.5;
    }
  }
  form.fields = assignFormFieldValueKeys(form.fields || []);
  const valuesTemplate = {};
  (form.fields || []).forEach((field) => {
    const key = String(field.valueKey || field.label || '').trim();
    if (key && valuesTemplate[key] === undefined) valuesTemplate[key] = '';
  });
  res.json({
    fileType: result.fileType,
    form: sanitizeKordocValue(form),
    valuesTemplate,
    blockSummary: summarizeKordocBlocks(result.blocks || []),
  });
}));

app.post('/api/kordoc/forms/fill', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const values = parseKordocFormValues(req.body || {});
  if (Object.keys(values).length === 0) {
    res.status(400).json({ error: '채울 양식 값 JSON이 필요합니다.' });
    return;
  }
  const kordoc = await loadKordoc();
  const format = String(req.body?.format || 'hwpx-preserve').toLowerCase();
  const outputFormat = ['hwpx-preserve', 'hwpx', 'markdown'].includes(format) ? format : 'hwpx-preserve';
  let result;
  if (outputFormat === 'hwpx-preserve') {
    const fallback = await fillHwpxFormPreserveFallback(file.buffer, values);
    result = {
      format: 'hwpx-preserve',
      output: fallback.output,
      fill: fallback.fill,
    };
  } else {
    result = await kordoc.fillForm(toArrayBuffer(file.buffer), values, outputFormat);
  }
  const id = crypto.randomUUID();
  const resultDir = kordocResultDir(id);
  fs.mkdirSync(resultDir, { recursive: true });
  const originalName = safeOriginalName(file.originalname || 'form-template.hwpx');
  const base = safeDownloadBase(originalName) || 'filled-form';
  const ext = result.format === 'markdown' ? 'md' : 'hwpx';
  const mime = result.format === 'markdown'
    ? 'text/markdown; charset=utf-8'
    : 'application/vnd.hancom.hwpx';
  const filename = `${base}-filled.${ext}`;
  const outputPath = path.join(resultDir, `filled.${ext}`);
  const outputBuffer = typeof result.output === 'string'
    ? Buffer.from(result.output, 'utf8')
    : Buffer.from(result.output);
  fs.writeFileSync(outputPath, outputBuffer);
  let userSavedPath = '';
  try {
    userSavedPath = saveCopyToUserDownloads(filename, outputBuffer);
  } catch (error) {
    console.warn('[kordoc/forms/fill] failed to copy to Downloads:', error.message);
  }
  writeJson(path.join(resultDir, 'fill-summary.json'), {
    originalName,
    filename,
    format: result.format,
    mime,
    values,
    fill: sanitizeKordocValue(result.fill || {}),
    savedPath: userSavedPath || outputPath,
  });
  res.json({
    ok: true,
    id,
    originalName,
    filename,
    format: result.format,
    filled: sanitizeKordocValue(result.fill?.filled || []),
    unmatched: sanitizeKordocValue(result.fill?.unmatched || []),
    download: `/api/kordoc/forms/fill/${id}/download`,
    savedPath: userSavedPath || outputPath,
  });
}));

app.get('/api/kordoc/forms/fill/:id/download', (req, res) => {
  const dir = kordocResultDir(req.params.id);
  const summaryPath = path.join(dir, 'fill-summary.json');
  if (!fs.existsSync(summaryPath)) {
    res.status(404).json({ error: '채우기 결과를 찾을 수 없습니다.' });
    return;
  }
  const summary = readJson(summaryPath, {});
  const ext = summary.format === 'markdown' ? 'md' : 'hwpx';
  const filePath = path.join(dir, `filled.${ext}`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: '채워진 문서를 찾을 수 없습니다.' });
    return;
  }
  sendBuffer(res, summary.filename || `filled.${ext}`, summary.mime || 'application/octet-stream', fs.readFileSync(filePath));
});

app.get('/api/kordoc/results/:id/:type', (req, res) => {
  const dir = kordocResultDir(req.params.id);
  const type = String(req.params.type || '').toLowerCase();
  const map = {
    markdown: ['result.md', 'text/markdown; charset=utf-8', 'result.md'],
    md: ['result.md', 'text/markdown; charset=utf-8', 'result.md'],
    json: ['result.json', 'application/json; charset=utf-8', 'result.json'],
    html: ['result.html', 'text/html; charset=utf-8', 'result.html'],
  };
  const target = map[type];
  if (!target) {
    res.status(400).json({ error: '지원하지 않는 결과 형식입니다.' });
    return;
  }
  const filePath = path.join(dir, target[0]);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: '결과 파일을 찾지 못했습니다.' });
    return;
  }
  sendBuffer(res, target[2], target[1], fs.readFileSync(filePath));
});

app.get('/api/kordoc/results/:id/images/:filename', (req, res) => {
  const dir = kordocResultDir(req.params.id);
  const filename = path.basename(String(req.params.filename || ''));
  const filePath = path.join(dir, 'images', filename);
  if (!filename || !fs.existsSync(filePath)) {
    res.status(404).json({ error: '이미지 파일을 찾지 못했습니다.' });
    return;
  }
  res.sendFile(filePath);
});

app.get('/api/hybrid/status', asyncRoute(async (req, res) => {
  res.json(await getHybridStatus(req.query.url || DEFAULT_HYBRID_URL));
}));

app.post('/api/hybrid/start', asyncRoute(async (req, res) => {
  const status = await ensureHybridServer(req.body?.url || DEFAULT_HYBRID_URL);
  res.json(status);
}));

app.get('/api/documents', (req, res) => {
  res.json(getHistory());
});

app.delete('/api/documents/:id', asyncRoute(async (req, res) => {
  const id = safeResultId(req.params.id);
  const inputPath = uploadedPdfPath(id);
  const docDir = path.join(DATA_DIR, id);

  // 1. PDF 파일 삭제
  if (inputPath && fs.existsSync(inputPath)) {
    try {
      fs.unlinkSync(inputPath);
    } catch (err) {
      console.error(`Failed to delete PDF file: ${inputPath}`, err);
    }
  }

  // 2. 데이터 디렉토리(추출 결과 등) 전체 삭제
  if (fs.existsSync(docDir)) {
    try {
      fs.rmSync(docDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete data directory: ${docDir}`, err);
    }
  }

  // 3. 히스토리 기록 제거
  try {
    const history = getHistory().filter((entry) => entry.id !== id);
    writeJson(HISTORY_FILE, history);
  } catch (err) {
    console.error('Failed to update history.json during deletion', err);
  }

  res.json({ success: true, id });
}));

app.post('/api/upload', diskUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'PDF 파일이 필요합니다.' });
    return;
  }

  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  let pageCount = 0;
  try {
    const doc = await loadPdf(fs.readFileSync(req.file.path));
    pageCount = doc.getPageCount();
  } catch {
    pageCount = 0;
  }

  const item = {
    id,
    originalName: safeOriginalName(req.file.originalname),
    filename: req.file.filename,
    size: req.file.size,
    pageCount,
    date: new Date().toISOString(),
    url: `/api/file/${id}`,
  };
  saveHistoryItem(item);
  res.json(item);
}));

app.get('/api/file/:id', (req, res) => {
  const filePath = uploadedPdfPath(req.params.id);
  if (!filePath) {
    res.status(404).json({ error: 'PDF 파일을 찾을 수 없습니다.' });
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(filePath).pipe(res);
});

app.post('/api/extract/:id', asyncRoute(async (req, res) => {
  const result = await extractPdfDocument(req.params.id, req.body || {});
  res.json({
    id: result.id,
    mode: result.mode,
    hybrid: result.hybrid,
    summary: result.summary,
    json: result.json,
    markdown: result.markdown,
    downloads: result.downloads,
  });
}));

app.get('/api/extract/:id/:type', (req, res) => {
  const id = safeResultId(req.params.id);
  const type = String(req.params.type || '').toLowerCase();
  const outputDir = path.join(DATA_DIR, id, 'extract');
  if (type === 'json') {
    const jsonPath = findOutputFile(outputDir, 'json');
    if (!jsonPath) return res.status(404).json({ error: 'JSON 분석 결과가 없습니다.' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(fs.readFileSync(jsonPath));
  }
  if (type === 'markdown' || type === 'md') {
    const mdPath = findOutputFile(outputDir, 'md');
    if (!mdPath) return res.status(404).json({ error: 'Markdown 분석 결과가 없습니다.' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(fs.readFileSync(mdPath));
  }
  return res.status(400).json({ error: '지원하지 않는 결과 형식입니다.' });
});
app.post('/api/system/save-file', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const suggestedName = safePdfFilename(req.body.suggestedName || file.originalname || 'document.pdf');
  const targetToken = String(req.body.targetToken || '').trim();

  let targetPath = '';
  let token = targetToken;
  if (targetToken) {
    targetPath = SAVE_TARGETS.get(targetToken) || '';
    if (!targetPath) {
      res.status(404).json({ error: '저장 위치가 더 이상 유효하지 않습니다. 다른 이름으로 저장을 다시 선택하세요.' });
      return;
    }
  } else {
    const dialog = openNativeSaveDialog(suggestedName);
    if (!dialog.available) {
      res.status(501).json({ error: '현재 시스템에서 네이티브 저장 대화상자를 사용할 수 없습니다.', fallback: 'download' });
      return;
    }
    if (dialog.canceled) {
      res.json({ saved: false, canceled: true });
      return;
    }
    if (dialog.error || !dialog.selectedPath) {
      res.status(500).json({ error: dialog.error || '저장 경로를 선택하지 못했습니다.' });
      return;
    }
    targetPath = dialog.selectedPath;
    token = crypto.randomUUID();
    SAVE_TARGETS.set(token, targetPath);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, file.buffer);
  res.json({
    saved: true,
    filename: path.basename(targetPath),
    targetToken: token,
  });
}));

app.post('/api/pdf/merge', memoryUpload.array('files', 50), asyncRoute(async (req, res) => {
  const files = req.files || [];
  if (files.length < 2) {
    res.status(400).json({ error: '병합하려면 PDF가 2개 이상 필요합니다.' });
    return;
  }

  const out = await PDFDocument.create();
  for (const file of files) {
    const source = await loadPdf(file.buffer);
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  sendPdf(res, 'merged.pdf', await savePdf(out));
}));

app.post('/api/pdf/extract-pages', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const pages = parsePagesSpec(req.body.pages, source.getPageCount());
  if (!pages.length) {
    res.status(400).json({ error: '추출할 페이지 범위가 올바르지 않습니다.' });
    return;
  }
  const out = await copyPagesToNewPdf(source, pages);
  sendPdf(res, `${safeDownloadBase(file.originalname)}-pages.pdf`, await savePdf(out));
}));

app.post('/api/pdf/split', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const ranges = parseRangeList(req.body.ranges, source.getPageCount());
  if (!ranges.length) {
    res.status(400).json({ error: '분할할 페이지 범위가 올바르지 않습니다.' });
    return;
  }

  const base = safeDownloadBase(file.originalname);
  const parts = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const out = await copyPagesToNewPdf(source, ranges[index]);
    const label = ranges[index].map((page) => page + 1).join('-');
    parts.push({
      name: `${base}-part-${String(index + 1).padStart(2, '0')}-p${label}.pdf`,
      content: await savePdf(out),
    });
  }

  sendBuffer(res, `${base}-split.zip`, 'application/zip', buildZip(parts));
}));

app.post('/api/pdf/rotate', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const delta = Number(req.body.degrees || 90);
  const pages = parsePagesSpec(req.body.pages, source.getPageCount());
  source.getPages().forEach((page, index) => {
    if (pages.includes(index)) {
      const current = page.getRotation().angle || 0;
      page.setRotation(degrees(((current + delta) % 360 + 360) % 360));
    }
  });
  sendPdf(res, `${safeDownloadBase(file.originalname)}-rotated.pdf`, await savePdf(source));
}));

app.post('/api/pdf/print-layout', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const printPdf = await buildPrintLayoutPdf(source, req.body || {});
  const pagesPerSheet = [1, 2, 4, 6, 9].includes(Number(req.body.pagesPerSheet)) ? Number(req.body.pagesPerSheet) : 1;
  const duplex = String(req.body.duplex || 'simplex');
  sendPdf(res, `${safeDownloadBase(file.originalname)}-print-${pagesPerSheet}up.pdf`, await savePdf(printPdf), {
    'X-JamePDF-Print-Pages-Per-Sheet': pagesPerSheet,
    'X-JamePDF-Print-Duplex': duplex,
    'X-JamePDF-Print-Note': encodeURIComponent('양면/단면은 브라우저 또는 프린터 인쇄 대화상자에서 최종 선택합니다.'),
  });
}));

app.post('/api/pdf/watermark', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const font = await embedReadableFont(source);
  const text = String(req.body.text || 'JamePDF').trim() || 'JamePDF';
  const size = Math.max(8, Math.min(160, Number(req.body.fontSize || 48)));
  const opacity = Math.max(0.05, Math.min(1, Number(req.body.opacity || 0.18)));
  const angle = Number(req.body.angle || -35);
  const color = hexToRgb(req.body.color || '#475569');
  const pages = parsePagesSpec(req.body.pages, source.getPageCount());

  source.getPages().forEach((page, index) => {
    if (!pages.includes(index)) return;
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: Math.max(24, (width - textWidth) / 2),
      y: height / 2,
      size,
      font,
      color,
      opacity,
      rotate: degrees(angle),
    });
  });

  sendPdf(res, `${safeDownloadBase(file.originalname)}-watermark.pdf`, await savePdf(source));
}));

app.post('/api/pdf/annotate', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  const pageIndex = Math.max(0, Math.min(source.getPageCount() - 1, Number(req.body.page || 1) - 1));
  const page = source.getPages()[pageIndex];
  const { width, height } = page.getSize();
  const font = await embedReadableFont(source);
  const text = String(req.body.text || '').trim();
  if (!text) {
    res.status(400).json({ error: '삽입할 텍스트가 필요합니다.' });
    return;
  }

  const size = Math.max(6, Math.min(80, Number(req.body.fontSize || 14)));
  const x = Math.max(0, Math.min(width - 20, Number(req.body.x || 72)));
  const y = Math.max(0, Math.min(height - 20, Number(req.body.y || height - 96)));

  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: hexToRgb(req.body.color || '#111827'),
    opacity: Math.max(0.05, Math.min(1, Number(req.body.opacity || 1))),
  });

  sendPdf(res, `${safeDownloadBase(file.originalname)}-edited.pdf`, await savePdf(source));
}));

app.post('/api/pdf/edit', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const source = await loadPdf(file.buffer);
  
  let annotations = [];
  try {
    annotations = JSON.parse(req.body.annotations || '[]');
  } catch (e) {
    res.status(400).json({ error: '올바르지 않은 편집 데이터 형식입니다.' });
    return;
  }

  const font = await embedReadableFont(source);
  const standardFonts = {
    helvetica: await source.embedFont(StandardFonts.Helvetica),
    courier: await source.embedFont(StandardFonts.Courier),
  };

  const pages = source.getPages();

  for (const ann of annotations) {
    const pageIndex = Math.max(0, Math.min(pages.length - 1, Number(ann.page || 1) - 1));
    const page = pages[pageIndex];
    if (!page) continue;

    if (ann.type === 'redact') {
      // 지우개: 흰색 사각형으로 가림
      page.drawRectangle({
        x: Number(ann.x) || 0,
        y: Number(ann.y) || 0,
        width: Number(ann.width) || 0,
        height: Number(ann.height) || 0,
        color: rgb(1, 1, 1), // 흰색
      });
    } else if (ann.type === 'text') {
      const text = String(ann.text || '').trim();
      if (!text) continue;

      const size = Math.max(6, Math.min(80, Number(ann.fontSize || 14)));
      const x = Number(ann.x) || 0;
      const y = Number(ann.y) || 0;
      const color = hexToRgb(ann.color || '#111827');
      const skewX = ann.italic ? degrees(-15) : undefined;
      
      // 폰트 선택
      let selectedFont = font;
      if (ann.fontFamily === 'courier') {
        selectedFont = standardFonts.courier;
      } else if (ann.fontFamily === 'helvetica') {
        selectedFont = standardFonts.helvetica;
      }

      page.drawText(text, {
        x,
        y,
        size,
        font: selectedFont,
        color,
        skewX,
      });

      // 가로줄 및 밑줄
      const textWidth = selectedFont.widthOfTextAtSize(text, size);
      
      if (ann.underline) {
        page.drawLine({
          start: { x, y: y - 2 },
          end: { x: x + textWidth, y: y - 2 },
          thickness: Math.max(0.5, size * 0.07),
          color,
        });
      }
      
      if (ann.strikethrough) {
        page.drawLine({
          start: { x, y: y + size * 0.35 },
          end: { x: x + textWidth, y: y + size * 0.35 },
          thickness: Math.max(0.5, size * 0.07),
          color,
        });
      }
    }
  }

  sendPdf(res, `${safeDownloadBase(file.originalname)}-edited.pdf`, await savePdf(source));
}));

app.post('/api/pdf/images-to-pdf', memoryUpload.array('files', 100), asyncRoute(async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    res.status(400).json({ error: 'PDF로 변환할 이미지가 필요합니다.' });
    return;
  }

  const out = await PDFDocument.create();
  for (const file of files) {
    const name = String(file.originalname || '').toLowerCase();
    let image;
    if (name.endsWith('.jpg') || name.endsWith('.jpeg') || file.mimetype === 'image/jpeg') {
      image = await out.embedJpg(file.buffer);
    } else if (name.endsWith('.png') || file.mimetype === 'image/png') {
      image = await out.embedPng(file.buffer);
    } else {
      continue;
    }
    const dims = image.scale(1);
    const page = out.addPage([dims.width, dims.height]);
    page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
  }

  if (out.getPageCount() === 0) {
    res.status(400).json({ error: 'JPG 또는 PNG 이미지만 PDF로 변환할 수 있습니다.' });
    return;
  }

  sendPdf(res, 'images.pdf', await savePdf(out));
}));

app.post('/api/pdf/compress', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const base = safeDownloadBase(file.originalname);
  const gs = ghostscriptCommand();
  const levelMap = {
    screen: '/screen',
    ebook: '/ebook',
    printer: '/printer',
    prepress: '/prepress',
  };
  const level = levelMap[String(req.body.level || 'ebook')] || '/ebook';

  if (gs) {
    const dir = tempDir();
    try {
      const input = path.join(dir, 'input.pdf');
      const output = path.join(dir, 'output.pdf');
      fs.writeFileSync(input, file.buffer);
      const result = spawnSync(gs, [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        `-dPDFSETTINGS=${level}`,
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${output}`,
        input,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0 || !fs.existsSync(output)) {
        throw new Error(result.stderr || 'Ghostscript 압축에 실패했습니다.');
      }
      const compressed = fs.readFileSync(output);
      sendPdf(res, `${base}-compressed.pdf`, compressed, {
        'X-JamePDF-Compression': 'ghostscript',
        'X-JamePDF-Original-Bytes': file.buffer.length,
        'X-JamePDF-Output-Bytes': compressed.length,
      });
    } finally {
      cleanupTemp(dir);
    }
    return;
  }

  const pdf = await loadPdf(file.buffer);
  const rewritten = await savePdf(pdf);
  sendPdf(res, `${base}-compressed.pdf`, rewritten, {
    'X-JamePDF-Compression': 'pdf-lib-rewrite',
    'X-JamePDF-Note': encodeURIComponent('Ghostscript가 없어 객체 스트림 재저장 압축만 적용했습니다.'),
    'X-JamePDF-Original-Bytes': file.buffer.length,
    'X-JamePDF-Output-Bytes': rewritten.length,
  });
}));

app.post('/api/pdf/encrypt', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const qpdf = qpdfCommand();
  if (!qpdf) {
    res.status(501).json({ error: '암호 설정은 qpdf 설치가 필요합니다. 현재 시스템에서 qpdf를 찾지 못했습니다.' });
    return;
  }

  const userPassword = String(req.body.userPassword || '').trim();
  const ownerPassword = String(req.body.ownerPassword || userPassword || crypto.randomUUID()).trim();
  if (!userPassword) {
    res.status(400).json({ error: '사용자 암호가 필요합니다.' });
    return;
  }

  const dir = tempDir();
  try {
    const input = path.join(dir, 'input.pdf');
    const output = path.join(dir, 'encrypted.pdf');
    fs.writeFileSync(input, file.buffer);
    const result = spawnSync(qpdf, ['--encrypt', userPassword, ownerPassword, '256', '--', input, output], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0 || !fs.existsSync(output)) {
      throw new Error(result.stderr || 'PDF 암호 설정에 실패했습니다.');
    }
    sendPdf(res, `${safeDownloadBase(file.originalname)}-encrypted.pdf`, fs.readFileSync(output));
  } finally {
    cleanupTemp(dir);
  }
}));

app.post('/api/pdf/decrypt', memoryUpload.single('file'), asyncRoute(async (req, res) => {
  const file = requiredFile(req);
  const qpdf = qpdfCommand();
  if (!qpdf) {
    res.status(501).json({ error: '암호 해제는 qpdf 설치가 필요합니다. 현재 시스템에서 qpdf를 찾지 못했습니다.' });
    return;
  }

  const password = String(req.body.password || '').trim();
  const dir = tempDir();
  try {
    const input = path.join(dir, 'input.pdf');
    const output = path.join(dir, 'decrypted.pdf');
    fs.writeFileSync(input, file.buffer);
    const args = password
      ? [`--password=${password}`, '--decrypt', input, output]
      : ['--decrypt', input, output];
    const result = spawnSync(qpdf, args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || !fs.existsSync(output)) {
      throw new Error(result.stderr || 'PDF 암호 해제에 실패했습니다.');
    }
    sendPdf(res, `${safeDownloadBase(file.originalname)}-decrypted.pdf`, fs.readFileSync(output));
  } finally {
    cleanupTemp(dir);
  }
}));

app.get('/api/ai/status', asyncRoute(async (req, res) => {
  const ollama = await getOllamaStatus(req.query.ollamaUrl || DEFAULT_OLLAMA_URL);
  res.json({
    ok: true,
    providers: {
      antigravity: {
        available: Boolean(antigravityCommand()),
        command: antigravityCommand() || '',
      },
      codex: {
        available: Boolean(codexCommand()),
        command: codexCommand() || '',
      },
      claude: {
        available: Boolean(claudeCommand()),
        command: claudeCommand() || '',
      },
      gemma: ollama,
    },
  });
}));

app.post('/api/ai/chat', asyncRoute(async (req, res) => {
  const provider = String(req.body?.provider || 'gemma').trim().toLowerCase();
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) {
    res.status(400).json({ error: 'AI prompt is required.' });
    return;
  }

  const fullPrompt = buildAiPrompt({
    prompt,
    context: req.body?.context || {},
  });

  let output = '';
  let resolvedProvider = provider;
  if (provider === 'gemma' || provider === 'ollama') {
    resolvedProvider = 'gemma';
    output = await runOllamaAi(fullPrompt, req.body?.model || DEFAULT_GEMMA_MODEL, req.body?.ollamaUrl || DEFAULT_OLLAMA_URL);
  } else if (provider === 'codex') {
    output = await runCodexAi(fullPrompt);
  } else if (provider === 'antigravity' || provider === 'agy') {
    resolvedProvider = 'antigravity';
    output = await runAntigravityAi(fullPrompt);
  } else if (provider === 'claude') {
    output = await runClaudeAi(fullPrompt);
  } else {
    res.status(400).json({ error: `Unsupported AI provider: ${provider}` });
    return;
  }

  res.json({
    ok: true,
    provider: resolvedProvider,
    model: resolvedProvider === 'gemma' ? String(req.body?.model || DEFAULT_GEMMA_MODEL) : '',
    output: output || '(no output)',
  });
}));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message || '요청을 처리하지 못했습니다.' });
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} running at http://localhost:${PORT}`);
});
