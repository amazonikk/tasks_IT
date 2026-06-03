/**
 * Google Apps Script API для GitHub Pages дашборду задач.
 *
 * Куди вставити:
 * 1. Відкрий Google Таблицю.
 * 2. Extensions / Розширення → Apps Script.
 * 3. Видали старий код, встав цей файл.
 * 4. Зміни API_TOKEN на такий самий, як у app.js.
 * 5. Deploy → New deployment → Web app.
 */

const CONFIG = {
  SPREADSHEET_ID: '10apvYFdhWe0M0VAo8LBWUTewyp76EWPM',
  API_TOKEN: 'CHANGE_ME_SECRET_TOKEN',
  SHEETS: {
    TASKS: 'Задачі',
    SUBTASKS: 'Підзадачі',
    COMMENTS: 'Коментарі_Лог',
    PEOPLE: 'Люди_Ролі',
    DICTIONARIES: 'Довідники',
  },
};

const TASK_HEADERS = {
  ID: 'Task ID',
  DEPARTMENT: 'Відділ / напрям',
  GOAL: 'Ціль задачі / навіщо',
  TITLE: 'Назва задачі',
  DESCRIPTION: 'Опис / контекст',
  RESULT: 'Очікуваний результат',
  CREATOR: 'Постановник',
  OWNER: 'Виконавець',
  STATUS: 'Статус',
  PRIORITY: 'Пріоритет',
  TYPE: 'Тип задачі',
  STAKEHOLDERS: 'Кому потрібна / стейкхолдери',
  CREATED: 'Дата постановки',
  DEADLINE: 'Дедлайн',
  ESTIMATE: 'Оцінка, год',
  ACTUAL: 'Факт, год',
  START: 'Початок',
  FINISH: 'Завершення',
  PROGRESS: 'Прогрес %',
  BLOCKER: 'Блокер?',
  BLOCKING_REASON: 'Що блокує / що потрібно',
  DONE_CRITERIA: 'Критерії готовності',
  LINKS: 'Лінки / макети / ТЗ',
  PR: 'Pull request / гілка / файл',
  MANAGER_COMMENT: 'Коментар постановника',
  DEV_COMMENT: 'Коментар виконавця',
  NEXT_STEP: 'Наступний крок',
  UPDATED: 'Дата останнього апдейту',
  TAGS: 'Теги',
  NOTES: 'Примітки',
};

const COMMENT_HEADERS = {
  DATE: 'Дата',
  TASK_ID: 'Task ID',
  SUBTASK_ID: 'Subtask ID',
  TYPE: 'Тип запису',
  AUTHOR: 'Автор',
  TO: 'Кому адресовано',
  TEXT: 'Текст / коментар',
  NEXT_ACTION: 'Наступна дія',
  RESPONSE_DEADLINE: 'Дедлайн відповіді',
  RESPONSE_STATUS: 'Статус відповіді',
};

function doGet(e) {
  return respond_({
    success: true,
    message: 'Task dashboard API is working. Use POST requests from GitHub Pages.',
    time: new Date(),
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    validateToken_(request.token);

    const action = request.action;
    if (action === 'getData') return respond_(getData_());
    if (action === 'createTask') return respond_(createTask_(request.fields || {}));
    if (action === 'updateTask') return respond_(updateTask_(request.taskId, request.fields || {}));
    if (action === 'addComment') return respond_(addComment_(request));

    throw new Error('Unknown action: ' + action);
  } catch (error) {
    return respond_({ success: false, error: error.message || String(error) });
  }
}

function parseRequest_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw);
}

function validateToken_(token) {
  if (!CONFIG.API_TOKEN || CONFIG.API_TOKEN === 'CHANGE_ME_SECRET_TOKEN') {
    throw new Error('Set API_TOKEN in Apps Script first.');
  }
  if (token !== CONFIG.API_TOKEN) {
    throw new Error('Wrong API token.');
  }
}

function respond_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(normalizeForJson_(payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function sheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function getData_() {
  return {
    success: true,
    tasks: readObjects_(CONFIG.SHEETS.TASKS),
    subtasks: readObjects_(CONFIG.SHEETS.SUBTASKS),
    comments: readObjects_(CONFIG.SHEETS.COMMENTS),
    people: readObjects_(CONFIG.SHEETS.PEOPLE),
    dictionaries: readDictionaries_(),
    serverTime: new Date(),
  };
}

function readObjects_(sheetName) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(String);
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        if (header) obj[header] = row[index] === undefined ? '' : row[index];
      });
      return obj;
    });
}

function readDictionaries_() {
  const sheet = sheet_(CONFIG.SHEETS.DICTIONARIES);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return {};

  const headers = values[0].map(String);
  const dictionaries = {};
  headers.forEach((header, colIndex) => {
    if (!header) return;
    dictionaries[header] = values.slice(1)
      .map(row => row[colIndex])
      .filter(value => value !== '' && value !== null && value !== undefined)
      .map(value => String(value));
  });
  return dictionaries;
}

function createTask_(fields) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = sheet_(CONFIG.SHEETS.TASKS);
    const headers = getHeaders_(sheet);
    const taskId = nextTaskId_(sheet, headers);
    const today = startOfDay_(new Date());

    const rowObject = {};
    rowObject[TASK_HEADERS.ID] = taskId;
    rowObject[TASK_HEADERS.CREATED] = today;
    rowObject[TASK_HEADERS.UPDATED] = today;
    rowObject[TASK_HEADERS.STATUS] = 'Нове';
    rowObject[TASK_HEADERS.PRIORITY] = 'P2 Середній';
    rowObject[TASK_HEADERS.PROGRESS] = 0;
    rowObject[TASK_HEADERS.BLOCKER] = 'Ні';

    Object.keys(fields).forEach(header => {
      if (header === TASK_HEADERS.ID) return;
      rowObject[header] = coerceValue_(header, fields[header]);
    });

    const row = headers.map(header => rowObject[header] !== undefined ? rowObject[header] : '');
    sheet.appendRow(row);

    addSystemComment_(taskId, 'Апдейт', rowObject[TASK_HEADERS.CREATOR] || '', 'Створено задачу через GitHub Pages dashboard.');

    return { success: true, taskId: taskId };
  } finally {
    lock.releaseLock();
  }
}

function updateTask_(taskId, fields) {
  if (!taskId) throw new Error('taskId is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = sheet_(CONFIG.SHEETS.TASKS);
    const headers = getHeaders_(sheet);
    const rowNumber = findTaskRow_(sheet, headers, taskId);
    if (!rowNumber) throw new Error('Task not found: ' + taskId);

    const currentValues = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const current = rowToObject_(headers, currentValues);

    Object.keys(fields).forEach(header => {
      if (header === TASK_HEADERS.ID) return;
      const col = headers.indexOf(header) + 1;
      if (col > 0) sheet.getRange(rowNumber, col).setValue(coerceValue_(header, fields[header]));
    });

    const today = startOfDay_(new Date());
    setCellIfHeaderExists_(sheet, headers, rowNumber, TASK_HEADERS.UPDATED, today);

    const nextStatus = fields[TASK_HEADERS.STATUS];
    if (nextStatus === 'Готово') {
      setCellIfHeaderExists_(sheet, headers, rowNumber, TASK_HEADERS.FINISH, today);
      setCellIfHeaderExists_(sheet, headers, rowNumber, TASK_HEADERS.PROGRESS, 1);
    }
    if (nextStatus === 'В роботі' && !current[TASK_HEADERS.START]) {
      setCellIfHeaderExists_(sheet, headers, rowNumber, TASK_HEADERS.START, today);
    }

    return { success: true, taskId: taskId };
  } finally {
    lock.releaseLock();
  }
}

function addComment_(request) {
  const taskId = request.taskId;
  if (!taskId) throw new Error('taskId is required.');
  if (!request.text) throw new Error('Comment text is required.');

  const comment = {};
  comment[COMMENT_HEADERS.DATE] = startOfDay_(new Date());
  comment[COMMENT_HEADERS.TASK_ID] = taskId;
  comment[COMMENT_HEADERS.SUBTASK_ID] = request.subtaskId || '';
  comment[COMMENT_HEADERS.TYPE] = request.type || 'Коментар';
  comment[COMMENT_HEADERS.AUTHOR] = request.author || '';
  comment[COMMENT_HEADERS.TO] = request.to || '';
  comment[COMMENT_HEADERS.TEXT] = request.text || '';
  comment[COMMENT_HEADERS.NEXT_ACTION] = request.nextAction || '';
  comment[COMMENT_HEADERS.RESPONSE_DEADLINE] = coerceValue_(COMMENT_HEADERS.RESPONSE_DEADLINE, request.responseDeadline || '');
  comment[COMMENT_HEADERS.RESPONSE_STATUS] = request.responseStatus || 'Відкрите';

  appendObjectRow_(CONFIG.SHEETS.COMMENTS, comment);

  if (request.nextAction) {
    updateTask_(taskId, { [TASK_HEADERS.NEXT_STEP]: request.nextAction });
  }

  return { success: true, taskId: taskId };
}

function addSystemComment_(taskId, type, author, text) {
  try {
    const comment = {};
    comment[COMMENT_HEADERS.DATE] = startOfDay_(new Date());
    comment[COMMENT_HEADERS.TASK_ID] = taskId;
    comment[COMMENT_HEADERS.TYPE] = type || 'Апдейт';
    comment[COMMENT_HEADERS.AUTHOR] = author || 'GitHub Pages dashboard';
    comment[COMMENT_HEADERS.TEXT] = text || '';
    comment[COMMENT_HEADERS.RESPONSE_STATUS] = 'Закрите';
    appendObjectRow_(CONFIG.SHEETS.COMMENTS, comment);
  } catch (error) {
    // Не блокуємо створення задачі, якщо лог коментарів недоступний.
  }
}

function appendObjectRow_(sheetName, object) {
  const sheet = sheet_(sheetName);
  const headers = getHeaders_(sheet);
  const row = headers.map(header => object[header] !== undefined ? object[header] : '');
  sheet.appendRow(row);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((header, index) => obj[header] = row[index]);
  return obj;
}

function nextTaskId_(sheet, headers) {
  const idCol = headers.indexOf(TASK_HEADERS.ID) + 1;
  if (!idCol) throw new Error('Task ID column not found.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 'T-001';

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
  const max = ids.reduce((highest, value) => {
    const match = String(value || '').match(/^T-(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return 'T-' + String(max + 1).padStart(3, '0');
}

function findTaskRow_(sheet, headers, taskId) {
  const idCol = headers.indexOf(TASK_HEADERS.ID) + 1;
  if (!idCol) throw new Error('Task ID column not found.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
  const index = ids.findIndex(value => String(value) === String(taskId));
  return index >= 0 ? index + 2 : null;
}

function setCellIfHeaderExists_(sheet, headers, rowNumber, header, value) {
  const col = headers.indexOf(header) + 1;
  if (col > 0) sheet.getRange(rowNumber, col).setValue(value);
}

function coerceValue_(header, value) {
  if (value === undefined || value === null) return '';

  const dateHeaders = [
    TASK_HEADERS.CREATED,
    TASK_HEADERS.DEADLINE,
    TASK_HEADERS.START,
    TASK_HEADERS.FINISH,
    TASK_HEADERS.UPDATED,
    COMMENT_HEADERS.DATE,
    COMMENT_HEADERS.RESPONSE_DEADLINE,
  ];

  if (dateHeaders.indexOf(header) >= 0) {
    if (!value) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') return startOfDay_(value);
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : startOfDay_(date);
  }

  if (header === TASK_HEADERS.PROGRESS) {
    const number = Number(String(value).replace('%', '').replace(',', '.'));
    if (isNaN(number)) return 0;
    return number > 1 ? number / 100 : number;
  }

  const numericHeaders = [TASK_HEADERS.ESTIMATE, TASK_HEADERS.ACTUAL];
  if (numericHeaders.indexOf(header) >= 0) {
    if (value === '') return '';
    const number = Number(String(value).replace(',', '.'));
    return isNaN(number) ? value : number;
  }

  return value;
}

function startOfDay_(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function normalizeForJson_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (Array.isArray(value)) return value.map(normalizeForJson_);
  if (value && typeof value === 'object') {
    const obj = {};
    Object.keys(value).forEach(key => obj[key] = normalizeForJson_(value[key]));
    return obj;
  }
  return value;
}
