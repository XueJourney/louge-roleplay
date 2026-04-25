/**
 * @file src/services/log-service.js
 * @description
 * 后台日志查询与按日写入服务。
 *
 * 调用说明：
 * - `src/lib/logger.js` 调用 `appendDailyLog()`，把运行日志拆成 `logs/app-YYYY-MM-DD.log`、`logs/app-error-YYYY-MM-DD.log`、`logs/access-YYYY-MM-DD.log`。
 * - `src/routes/web-routes.js` 的 `/admin/logs` 调用 `listLogEntries()`，解析旧日志和新日志，提供日期、等级、文件、错误类型、函数名筛选与分页。
 * - 本服务只读写 `logs/` 目录，不碰业务数据库，也不记录敏感请求正文。
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const LEVELS = ['debug', 'info', 'warn', 'error', 'access', 'raw'];
const MONTH_INDEX = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLocalDateKey(date = new Date()) {
  return new Date(date.getTime() + TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeLogDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function getDailyLogPath(kind, dateKey = getLocalDateKey()) {
  const safeKind = ['app', 'app-error', 'access'].includes(kind) ? kind : 'app';
  return path.join(LOG_DIR, `${safeKind}-${dateKey}.log`);
}

function appendDailyLog(kind, line) {
  try {
    ensureLogDir();
    const filePath = getDailyLogPath(kind);
    fs.appendFileSync(filePath, `${String(line || '').replace(/\n+$/u, '')}\n`, 'utf8');
  } catch (error) {
    // 日志写入不能反过来拖垮业务；这里故意吞掉文件错误，systemd/journal 仍会接住 console 输出。
  }
}

function readFileTail(filePath) {
  const stats = fs.statSync(filePath);
  const start = Math.max(0, stats.size - MAX_FILE_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(stats.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function inferLogFileType(fileName) {
  if (/access/.test(fileName)) return 'access';
  if (/error/.test(fileName)) return 'error';
  return 'app';
}

function parseDateFromFileName(fileName) {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function listReadableLogFiles(dateKey = '') {
  ensureLogDir();
  const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => {
      const filePath = path.join(LOG_DIR, entry.name);
      const stats = fs.statSync(filePath);
      const fileDate = parseDateFromFileName(entry.name);
      return {
        name: entry.name,
        path: filePath,
        size: stats.size,
        modifiedAt: stats.mtime,
        date: fileDate,
        type: inferLogFileType(entry.name),
        isLegacy: entry.name === 'app.log' || entry.name === 'app-error.log',
      };
    })
    .filter((file) => {
      if (!dateKey) return true;
      return file.date === dateKey || file.isLegacy;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseApacheDate(raw) {
  const match = String(raw || '').match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, day, monthName, year, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  if (!Object.prototype.hasOwnProperty.call(MONTH_INDEX, monthName)) return null;
  const utc = Date.UTC(Number(year), MONTH_INDEX[monthName], Number(day), Number(hour), Number(minute), Number(second));
  const offsetMs = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60 * 1000;
  return new Date(sign === '+' ? utc - offsetMs : utc + offsetMs);
}

function parseJsonMeta(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function compactProjectPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const srcIndex = raw.lastIndexOf('/src/');
  if (srcIndex >= 0) return raw.slice(srcIndex + 1);
  const publicIndex = raw.lastIndexOf('/public/');
  if (publicIndex >= 0) return raw.slice(publicIndex + 1);
  const scriptIndex = raw.lastIndexOf('/scripts/');
  if (scriptIndex >= 0) return raw.slice(scriptIndex + 1);
  return raw.replace(/^file:\/\//, '');
}

function parseStackFrame(text = '') {
  const raw = String(text || '');
  const stackMatch = raw.match(/\bat\s+([^\n(]+?)\s+\(([^\n)]+?):(\d+):(\d+)\)/)
    || raw.match(/\bat\s+([^\n ]+)\s+([^\n]+?):(\d+):(\d+)/);
  if (stackMatch) {
    return {
      functionName: stackMatch[1].trim(),
      sourceFile: compactProjectPath(stackMatch[2]),
      line: Number(stackMatch[3]),
      column: Number(stackMatch[4]),
    };
  }

  const fileOnlyMatch = raw.match(/((?:\/|[A-Za-z]:\\)[^\n:]+?\.(?:js|ejs|css|json)):(\d+)(?::(\d+))?/);
  if (fileOnlyMatch) {
    return {
      functionName: '',
      sourceFile: compactProjectPath(fileOnlyMatch[1]),
      line: Number(fileOnlyMatch[2]),
      column: fileOnlyMatch[3] ? Number(fileOnlyMatch[3]) : null,
    };
  }

  return { functionName: '', sourceFile: '', line: null, column: null };
}

function inferErrorType({ message = '', raw = '', meta = {} }) {
  const candidates = [
    meta.errorType,
    meta.name,
    meta.code,
    meta.error,
    message,
    raw,
  ].map((item) => String(item || ''));

  for (const candidate of candidates) {
    const match = candidate.match(/\b([A-Z][A-Za-z]+Error)\b/);
    if (match) return match[1];
  }
  if (/rate limited|429/i.test(candidates.join(' '))) return 'RateLimit';
  if (/timeout|504/i.test(candidates.join(' '))) return 'Timeout';
  return '';
}

function inferFunctionName(message = '', frame = {}, meta = {}) {
  if (frame.functionName) return frame.functionName;
  if (meta.functionName) return String(meta.functionName);
  const bracketMatch = String(message || '').match(/^\[([^\]]+)\]/);
  return bracketMatch ? bracketMatch[1] : '';
}

function buildEntryFields(entry) {
  const metaStack = typeof entry.meta.stack === 'string' ? entry.meta.stack : '';
  const frame = parseStackFrame(metaStack || entry.raw);
  const sourceFile = compactProjectPath(entry.meta.file || entry.meta.sourceFile || entry.meta.view || frame.sourceFile || '');
  return {
    ...entry,
    errorType: inferErrorType(entry),
    sourceFile,
    functionName: inferFunctionName(entry.message, frame, entry.meta),
    line: frame.line,
    column: frame.column,
  };
}

function parseLogLine(rawLine, context) {
  const raw = String(rawLine || '').replace(/\r$/u, '');
  const structuredMatch = raw.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(.+)$/);
  if (structuredMatch) {
    const [, timeText, levelText, rest] = structuredMatch;
    const metaMatch = rest.match(/^(.*?)(?:\s+(\{.*\}))?$/);
    const message = metaMatch ? metaMatch[1] : rest;
    const meta = metaMatch && metaMatch[2] ? parseJsonMeta(metaMatch[2]) : {};
    const timestamp = new Date(timeText);
    return buildEntryFields({
      timestamp: Number.isNaN(timestamp.getTime()) ? context.lastTimestamp : timestamp,
      level: levelText.toLowerCase(),
      message,
      meta,
      raw,
      logFile: context.file.name,
      logFileType: context.file.type,
      lineNumber: context.lineNumber,
    });
  }

  const accessMatch = raw.match(/^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/);
  if (accessMatch) {
    const [, ip, timeText, requestLine, status, bytes, referer, userAgent] = accessMatch;
    const timestamp = parseApacheDate(timeText) || context.lastTimestamp;
    return buildEntryFields({
      timestamp,
      level: 'access',
      message: `${requestLine} → ${status}`,
      meta: { ip, status: Number(status), bytes, referer, userAgent },
      raw,
      logFile: context.file.name,
      logFileType: context.file.type,
      lineNumber: context.lineNumber,
    });
  }

  const fallbackLevel = context.file.type === 'error' || /\b(?:SyntaxError|TypeError|ReferenceError|RangeError|Error):/u.test(raw)
    ? 'error'
    : 'raw';
  return buildEntryFields({
    timestamp: context.lastTimestamp,
    level: fallbackLevel,
    message: raw.slice(0, 240),
    meta: {},
    raw,
    logFile: context.file.name,
    logFileType: context.file.type,
    lineNumber: context.lineNumber,
  });
}

function parseLogFile(file) {
  const text = readFileTail(file.path);
  const lines = text.split('\n').filter((line) => line.trim());
  const entries = [];
  let lastTimestamp = file.modifiedAt;
  lines.forEach((line, index) => {
    const entry = parseLogLine(line, {
      file,
      lineNumber: index + 1,
      lastTimestamp,
    });
    if (entry.timestamp && !Number.isNaN(entry.timestamp.getTime())) {
      lastTimestamp = entry.timestamp;
    }
    entries.push(entry);
  });
  return entries;
}

function matchesText(value, filter) {
  const needle = String(filter || '').trim().toLowerCase();
  if (!needle) return true;
  return String(value || '').toLowerCase().includes(needle);
}

function toDisplayTime(timestamp) {
  if (!timestamp || Number.isNaN(timestamp.getTime())) return '';
  return timestamp.toLocaleString('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    hour12: false,
  });
}

function collectFacet(entries, fieldName) {
  return Array.from(new Set(entries.map((entry) => String(entry[fieldName] || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .slice(0, 200);
}

function listAvailableDates() {
  try {
    ensureLogDir();
    return Array.from(new Set(fs.readdirSync(LOG_DIR)
      .map(parseDateFromFileName)
      .filter(Boolean)))
      .sort()
      .reverse();
  } catch (error) {
    return [];
  }
}

function normalizeLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return LEVELS.includes(level) ? level : '';
}

function listLogEntries(options = {}) {
  const dateKey = normalizeLogDate(options.date);
  const level = normalizeLevel(options.level);
  const fileFilter = String(options.file || '').trim();
  const errorTypeFilter = String(options.errorType || '').trim();
  const functionFilter = String(options.functionName || '').trim();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.pageSize || DEFAULT_PAGE_SIZE)));
  const page = Math.max(1, Number(options.page || 1));

  const scannedFiles = listReadableLogFiles(dateKey);
  const parsedEntries = scannedFiles.flatMap(parseLogFile).filter((entry) => {
    const entryDate = entry.timestamp ? getLocalDateKey(entry.timestamp) : '';
    if (dateKey && entryDate !== dateKey) return false;
    if (level && entry.level !== level) return false;
    if (!matchesText(entry.sourceFile || entry.logFile, fileFilter)) return false;
    if (!matchesText(entry.errorType, errorTypeFilter)) return false;
    if (!matchesText(entry.functionName, functionFilter)) return false;
    return true;
  });

  parsedEntries.sort((a, b) => {
    const diff = (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0);
    if (diff) return diff;
    return `${b.logFile}:${b.lineNumber}`.localeCompare(`${a.logFile}:${a.lineNumber}`);
  });

  const total = parsedEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageEntries = parsedEntries.slice(start, start + pageSize).map((entry) => ({
    ...entry,
    displayTime: toDisplayTime(entry.timestamp),
    metaText: Object.keys(entry.meta || {}).length ? JSON.stringify(entry.meta) : '',
  }));

  return {
    entries: pageEntries,
    total,
    page: safePage,
    pageSize,
    totalPages,
    filters: {
      date: dateKey,
      level,
      file: fileFilter,
      errorType: errorTypeFilter,
      functionName: functionFilter,
    },
    availableDates: listAvailableDates(),
    levels: LEVELS,
    sourceFiles: collectFacet(parsedEntries, 'sourceFile'),
    errorTypes: collectFacet(parsedEntries, 'errorType'),
    functionNames: collectFacet(parsedEntries, 'functionName'),
    scannedFiles: scannedFiles.map((file) => ({
      name: file.name,
      size: file.size,
      date: file.date,
      type: file.type,
      truncated: file.size > MAX_FILE_BYTES,
    })),
  };
}

module.exports = {
  appendDailyLog,
  getLocalDateKey,
  listLogEntries,
};
