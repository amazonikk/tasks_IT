const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyYv_Vkw3rcYcX59OT7c_gQRUerethLblghxq6_sYVg880BI1zYEAEY4iK68O_jWPUPyA/exec',
  API_TOKEN: 'CHANGE_ME_SECRET_TOKEN',
  REFRESH_INTERVAL_MS: 0, // 0 = автооновлення вимкнене. Наприклад 60000 = раз на хвилину.
};

const HEADERS = {
  id: 'Task ID',
  department: 'Відділ / напрям',
  goal: 'Ціль задачі / навіщо',
  title: 'Назва задачі',
  description: 'Опис / контекст',
  result: 'Очікуваний результат',
  creator: 'Постановник',
  owner: 'Виконавець',
  status: 'Статус',
  priority: 'Пріоритет',
  type: 'Тип задачі',
  stakeholders: 'Кому потрібна / стейкхолдери',
  created: 'Дата постановки',
  deadline: 'Дедлайн',
  estimate: 'Оцінка, год',
  actual: 'Факт, год',
  start: 'Початок',
  finish: 'Завершення',
  progress: 'Прогрес %',
  blocker: 'Блокер?',
  blockingReason: 'Що блокує / що потрібно',
  doneCriteria: 'Критерії готовності',
  links: 'Лінки / макети / ТЗ',
  pr: 'Pull request / гілка / файл',
  managerComment: 'Коментар постановника',
  devComment: 'Коментар виконавця',
  nextStep: 'Наступний крок',
  updated: 'Дата останнього апдейту',
  tags: 'Теги',
  notes: 'Примітки',
};

const DEFAULT_STATUSES = ['Нове', 'Уточнення', 'До роботи', 'В роботі', 'На перевірці', 'Правки', 'Готово', 'Заблоковано', 'На паузі', 'Скасовано'];
const DONE_STATUSES = ['Готово', 'Скасовано'];
const ACTIVE_STATUSES = ['Нове', 'Уточнення', 'До роботи', 'В роботі', 'На перевірці', 'Правки', 'Заблоковано', 'На паузі'];
const BOARD_COLUMNS = [
  { title: 'Нове / уточнення', statuses: ['Нове', 'Уточнення'] },
  { title: 'До роботи', statuses: ['До роботи'] },
  { title: 'В роботі', statuses: ['В роботі'] },
  { title: 'Перевірка / правки', statuses: ['На перевірці', 'Правки'] },
  { title: 'Блок / готово', statuses: ['Заблоковано', 'На паузі', 'Готово', 'Скасовано'] },
];

const state = {
  tasks: [],
  subtasks: [],
  comments: [],
  dictionaries: {},
  filteredTasks: [],
  charts: {},
  isLoading: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const refs = {
  setupWarning: $('#setupWarning'),
  refreshData: $('#refreshData'),
  openCreateTask: $('#openCreateTask'),
  searchInput: $('#searchInput'),
  statusFilter: $('#statusFilter'),
  priorityFilter: $('#priorityFilter'),
  ownerFilter: $('#ownerFilter'),
  departmentFilter: $('#departmentFilter'),
  overdueOnly: $('#overdueOnly'),
  kpiGrid: $('#kpiGrid'),
  board: $('#board'),
  tableBody: $('#taskTableBody'),
  lastSync: $('#lastSync'),
  toast: $('#toast'),
  taskModal: $('#taskModal'),
  taskForm: $('#taskForm'),
  modalMode: $('#modalMode'),
  modalTitle: $('#modalTitle'),
  saveTaskBtn: $('#saveTaskBtn'),
  commentModal: $('#commentModal'),
  commentForm: $('#commentForm'),
  commentTaskTitle: $('#commentTaskTitle'),
};

function getValue(task, key) {
  return task?.[HEADERS[key]] ?? '';
}

function setValue(obj, key, value) {
  obj[HEADERS[key]] = value ?? '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isApiConfigured() {
  return CONFIG.API_URL && !CONFIG.API_URL.includes('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE');
}

function showToast(message, type = 'info') {
  refs.toast.textContent = message;
  refs.toast.dataset.type = type;
  refs.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => refs.toast.classList.remove('show'), 3600);
}

async function apiCall(action, payload = {}) {
  if (!isApiConfigured()) {
    throw new Error('API_URL не налаштований у app.js');
  }

  const response = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: CONFIG.API_TOKEN, ...payload }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Apps Script повернув не JSON. Перевір deployment. Відповідь: ${text.slice(0, 160)}`);
  }

  if (!data.success) {
    throw new Error(data.error || 'Невідома помилка API');
  }

  return data;
}

function normalizePercent(value) {
  const number = Number(String(value ?? '').replace('%', '').replace(',', '.'));
  if (!Number.isFinite(number)) return 0;
  if (number > 1) return Math.max(0, Math.min(100, Math.round(number)));
  return Math.max(0, Math.min(100, Math.round(number * 100)));
}

function percentToSheet(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number)) / 100;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [year, month, day] = str.slice(0, 10).split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toInputDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDone(task) {
  return DONE_STATUSES.includes(getValue(task, 'status'));
}

function isActive(task) {
  return ACTIVE_STATUSES.includes(getValue(task, 'status')) && !isDone(task);
}

function isOverdue(task) {
  const deadline = parseDate(getValue(task, 'deadline'));
  if (!deadline || isDone(task)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return deadline < today;
}

function isBlocked(task) {
  const status = getValue(task, 'status');
  const blocker = String(getValue(task, 'blocker')).toLowerCase();
  return status === 'Заблоковано' || status === 'На паузі' || blocker === 'так' || blocker === 'true';
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item) || 'Без значення';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function uniqueValues(tasks, key) {
  return [...new Set(tasks.map((task) => getValue(task, key)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'uk'));
}

function dictionaryValues(name, fallback = []) {
  const values = state.dictionaries?.[name];
  return values?.length ? values : fallback;
}

function fillSelect(select, values, placeholder = 'Всі') {
  const currentValue = select.value;
  select.innerHTML = '';
  if (placeholder !== null) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    select.appendChild(option);
  }
  values.filter(Boolean).forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function hydrateFilters() {
  fillSelect(refs.statusFilter, dictionaryValues('Статуси', uniqueValues(state.tasks, 'status')));
  fillSelect(refs.priorityFilter, dictionaryValues('Пріоритети', uniqueValues(state.tasks, 'priority')));
  fillSelect(refs.ownerFilter, dictionaryValues('Люди для dropdown', uniqueValues(state.tasks, 'owner')));
  fillSelect(refs.departmentFilter, dictionaryValues('Відділи / напрями', uniqueValues(state.tasks, 'department')));

  fillSelect($('#taskStatus'), dictionaryValues('Статуси', DEFAULT_STATUSES), null);
  fillSelect($('#taskPriority'), dictionaryValues('Пріоритети', ['P0 Критично', 'P1 Високий', 'P2 Середній', 'P3 Низький']), null);
  fillSelect($('#taskDepartment'), dictionaryValues('Відділи / напрями', uniqueValues(state.tasks, 'department')), null);
  fillSelect($('#taskType'), dictionaryValues('Типи задач', ['Баг', 'Фіча', 'Автоматизація', 'Інтеграція']), null);
  fillSelect($('#taskOwner'), dictionaryValues('Люди для dropdown', uniqueValues(state.tasks, 'owner')), null);
  fillSelect($('#taskCreator'), dictionaryValues('Люди для dropdown', uniqueValues(state.tasks, 'creator')), null);
  fillSelect($('#commentType'), dictionaryValues('Типи записів', ['Коментар', 'Питання', 'Рішення', 'Блокер', 'Апдейт']), null);
  fillSelect($('#commentAuthor'), dictionaryValues('Люди для dropdown', uniqueValues(state.tasks, 'owner')), null);
  fillSelect($('#commentTo'), dictionaryValues('Люди для dropdown', uniqueValues(state.tasks, 'creator')), null);
}

function applyFilters() {
  const search = refs.searchInput.value.trim().toLowerCase();
  const status = refs.statusFilter.value;
  const priority = refs.priorityFilter.value;
  const owner = refs.ownerFilter.value;
  const department = refs.departmentFilter.value;
  const overdueOnly = refs.overdueOnly.checked;

  state.filteredTasks = state.tasks.filter((task) => {
    const blob = Object.values(task).join(' ').toLowerCase();
    return (!search || blob.includes(search))
      && (!status || getValue(task, 'status') === status)
      && (!priority || getValue(task, 'priority') === priority)
      && (!owner || getValue(task, 'owner') === owner)
      && (!department || getValue(task, 'department') === department)
      && (!overdueOnly || isOverdue(task));
  });

  renderAll(false);
}

function renderKpis() {
  const tasks = state.filteredTasks;
  const total = tasks.length;
  const active = tasks.filter(isActive).length;
  const done = tasks.filter(isDone).length;
  const overdue = tasks.filter(isOverdue).length;
  const blocked = tasks.filter(isBlocked).length;
  const averageProgress = total ? Math.round(tasks.reduce((sum, task) => sum + normalizePercent(getValue(task, 'progress')), 0) / total) : 0;

  const cards = [
    { title: 'Усього задач', value: total, note: 'за вибраним фільтром' },
    { title: 'Активні', value: active, note: 'ще потребують роботи' },
    { title: 'Готово', value: done, note: 'закриті або скасовані' },
    { title: 'Прострочені', value: overdue, note: 'дедлайн вже минув' },
    { title: 'Блок / пауза', value: blocked, note: 'потрібна дія або рішення' },
    { title: 'Середній прогрес', value: `${averageProgress}%`, note: 'по задачах у фільтрі' },
  ];

  refs.kpiGrid.innerHTML = cards.map((card) => `
    <article class="kpi-card">
      <div class="kpi-title">${escapeHtml(card.title)}</div>
      <div class="kpi-value">${escapeHtml(card.value)}</div>
      <div class="kpi-note">${escapeHtml(card.note)}</div>
    </article>
  `).join('');
}

function renderCharts() {
  const statusCounts = countBy(state.filteredTasks, (task) => getValue(task, 'status'));
  const priorityCounts = countBy(state.filteredTasks, (task) => getValue(task, 'priority'));
  renderChart('statusChart', 'statuses', statusCounts);
  renderChart('priorityChart', 'priorities', priorityCounts);
}

function renderChart(canvasId, key, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = Object.keys(data);
  const values = Object.values(data);

  if (state.charts[key]) {
    state.charts[key].destroy();
  }

  state.charts[key] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#d7deea', boxWidth: 12, boxHeight: 12 },
        },
      },
      cutout: '62%',
    },
  });
}

function priorityClass(priority) {
  const text = String(priority).toLowerCase();
  if (text.includes('p0')) return 'p0';
  if (text.includes('p1')) return 'p1';
  if (text.includes('p2')) return 'p2';
  if (text.includes('p3')) return 'p3';
  return '';
}

function taskCardTemplate(task) {
  const id = getValue(task, 'id');
  const progress = normalizePercent(getValue(task, 'progress'));
  const deadline = getValue(task, 'deadline');
  const owner = getValue(task, 'owner') || 'Без виконавця';
  const nextStep = getValue(task, 'nextStep');
  const priority = getValue(task, 'priority') || 'Без пріоритету';
  const statusOptions = dictionaryValues('Статуси', DEFAULT_STATUSES).map((status) => `
    <option value="${escapeHtml(status)}" ${status === getValue(task, 'status') ? 'selected' : ''}>${escapeHtml(status)}</option>
  `).join('');

  return `
    <article class="task-card" data-task-id="${escapeHtml(id)}">
      <div class="task-top">
        <span class="badge ${priorityClass(priority)}">${escapeHtml(priority)}</span>
        ${isOverdue(task) ? '<span class="badge overdue">Прострочено</span>' : ''}
        ${isBlocked(task) ? '<span class="badge blocked">Блокер</span>' : ''}
      </div>
      <div>
        <div class="task-title">${escapeHtml(getValue(task, 'title') || id)}</div>
        <div class="task-meta">${escapeHtml(id)} · ${escapeHtml(getValue(task, 'department') || 'Без відділу')}</div>
      </div>
      <div class="task-text">${escapeHtml(getValue(task, 'description') || getValue(task, 'goal') || 'Опис не заповнено')}</div>
      <div class="progress-row">
        <div class="progress-label"><span>Прогрес</span><span>${progress}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <div class="task-meta">Виконавець: ${escapeHtml(owner)}</div>
      <div class="task-meta">Дедлайн: ${escapeHtml(formatDate(deadline))}</div>
      ${nextStep ? `<div class="task-meta">Наступний крок: ${escapeHtml(nextStep)}</div>` : ''}
      <select class="status-select" data-action="change-status">${statusOptions}</select>
      <div class="card-actions">
        <button class="small-btn" data-action="edit-task">Редагувати</button>
        <button class="small-btn" data-action="add-comment">Коментар</button>
        <button class="small-btn" data-action="mark-done">Готово</button>
      </div>
    </article>
  `;
}

function renderBoard() {
  refs.board.innerHTML = BOARD_COLUMNS.map((column) => {
    const tasks = state.filteredTasks.filter((task) => column.statuses.includes(getValue(task, 'status')));
    const content = tasks.length ? tasks.map(taskCardTemplate).join('') : '<div class="empty-state">Немає задач</div>';
    return `
      <section class="lane">
        <div class="lane-head">
          <div class="lane-title">${escapeHtml(column.title)}</div>
          <div class="counter">${tasks.length}</div>
        </div>
        ${content}
      </section>
    `;
  }).join('');
}

function renderTable() {
  refs.tableBody.innerHTML = state.filteredTasks.map((task) => {
    const id = getValue(task, 'id');
    const progress = normalizePercent(getValue(task, 'progress'));
    return `
      <tr data-task-id="${escapeHtml(id)}">
        <td>${escapeHtml(id)}</td>
        <td>
          <div class="row-title">${escapeHtml(getValue(task, 'title'))}</div>
          <div class="row-subtitle">${escapeHtml(getValue(task, 'nextStep') || getValue(task, 'goal') || '')}</div>
        </td>
        <td>${escapeHtml(getValue(task, 'department'))}</td>
        <td>${escapeHtml(getValue(task, 'owner'))}</td>
        <td>${escapeHtml(getValue(task, 'status'))}</td>
        <td>${escapeHtml(getValue(task, 'priority'))}</td>
        <td>${escapeHtml(formatDate(getValue(task, 'deadline')))}</td>
        <td>${progress}%</td>
        <td><button class="small-btn" data-action="edit-task">Відкрити</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9">Задач не знайдено</td></tr>';
}

function renderAll(updateFilters = true) {
  if (updateFilters) hydrateFilters();
  if (!state.filteredTasks.length && state.tasks.length) {
    state.filteredTasks = [...state.tasks];
  }
  renderKpis();
  renderCharts();
  renderBoard();
  renderTable();
}

async function loadData() {
  if (state.isLoading) return;
  if (!isApiConfigured()) {
    refs.setupWarning.classList.remove('hidden');
    showToast('Спочатку встав Apps Script URL у app.js', 'warning');
    return;
  }

  state.isLoading = true;
  refs.refreshData.disabled = true;
  refs.refreshData.textContent = 'Оновлюю...';

  try {
    const data = await apiCall('getData');
    state.tasks = data.tasks || [];
    state.subtasks = data.subtasks || [];
    state.comments = data.comments || [];
    state.dictionaries = data.dictionaries || {};
    state.filteredTasks = [...state.tasks];
    hydrateFilters();
    applyFilters();
    refs.lastSync.textContent = `Остання синхронізація: ${new Date().toLocaleString('uk-UA')}`;
    showToast('Дані оновлено');
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    state.isLoading = false;
    refs.refreshData.disabled = false;
    refs.refreshData.textContent = 'Оновити дані';
  }
}

function findTaskById(taskId) {
  return state.tasks.find((task) => getValue(task, 'id') === taskId);
}

function openTaskModal(task = null) {
  refs.taskForm.reset();
  const isEdit = Boolean(task);
  refs.modalMode.textContent = isEdit ? 'Редагування задачі' : 'Нова задача';
  refs.modalTitle.textContent = isEdit ? `Редагувати ${getValue(task, 'id')}` : 'Додати задачу';
  refs.saveTaskBtn.textContent = isEdit ? 'Зберегти зміни' : 'Створити задачу';

  $('#taskId').value = isEdit ? getValue(task, 'id') : '';
  $('#taskTitle').value = isEdit ? getValue(task, 'title') : '';
  $('#taskStatus').value = isEdit ? getValue(task, 'status') : 'Нове';
  $('#taskPriority').value = isEdit ? getValue(task, 'priority') : 'P2 Середній';
  $('#taskDepartment').value = isEdit ? getValue(task, 'department') : '';
  $('#taskType').value = isEdit ? getValue(task, 'type') : '';
  $('#taskOwner').value = isEdit ? getValue(task, 'owner') : '';
  $('#taskCreator').value = isEdit ? getValue(task, 'creator') : '';
  $('#taskDeadline').value = isEdit ? toInputDate(getValue(task, 'deadline')) : '';
  $('#taskEstimate').value = isEdit ? getValue(task, 'estimate') : '';
  $('#taskGoal').value = isEdit ? getValue(task, 'goal') : '';
  $('#taskDescription').value = isEdit ? getValue(task, 'description') : '';
  $('#taskResult').value = isEdit ? getValue(task, 'result') : '';
  $('#taskDoneCriteria').value = isEdit ? getValue(task, 'doneCriteria') : '';
  $('#taskNextStep').value = isEdit ? getValue(task, 'nextStep') : '';
  $('#taskLinks').value = isEdit ? getValue(task, 'links') : '';
  $('#taskPr').value = isEdit ? getValue(task, 'pr') : '';
  $('#taskTags').value = isEdit ? getValue(task, 'tags') : '';
  $('#taskProgress').value = isEdit ? normalizePercent(getValue(task, 'progress')) : 0;
  $('#taskBlocker').checked = isEdit ? isBlocked(task) : false;
  $('#taskBlockingReason').value = isEdit ? getValue(task, 'blockingReason') : '';

  refs.taskModal.showModal();
}

function collectTaskForm() {
  const payload = {};
  setValue(payload, 'title', $('#taskTitle').value.trim());
  setValue(payload, 'status', $('#taskStatus').value);
  setValue(payload, 'priority', $('#taskPriority').value);
  setValue(payload, 'department', $('#taskDepartment').value);
  setValue(payload, 'type', $('#taskType').value);
  setValue(payload, 'owner', $('#taskOwner').value);
  setValue(payload, 'creator', $('#taskCreator').value);
  setValue(payload, 'deadline', $('#taskDeadline').value);
  setValue(payload, 'estimate', $('#taskEstimate').value);
  setValue(payload, 'goal', $('#taskGoal').value.trim());
  setValue(payload, 'description', $('#taskDescription').value.trim());
  setValue(payload, 'result', $('#taskResult').value.trim());
  setValue(payload, 'doneCriteria', $('#taskDoneCriteria').value.trim());
  setValue(payload, 'nextStep', $('#taskNextStep').value.trim());
  setValue(payload, 'links', $('#taskLinks').value.trim());
  setValue(payload, 'pr', $('#taskPr').value.trim());
  setValue(payload, 'tags', $('#taskTags').value.trim());
  setValue(payload, 'progress', percentToSheet($('#taskProgress').value));
  setValue(payload, 'blocker', $('#taskBlocker').checked ? 'Так' : 'Ні');
  setValue(payload, 'blockingReason', $('#taskBlockingReason').value.trim());
  return payload;
}

async function saveTask(event) {
  event.preventDefault();
  const taskId = $('#taskId').value;
  const fields = collectTaskForm();

  try {
    refs.saveTaskBtn.disabled = true;
    refs.saveTaskBtn.textContent = 'Зберігаю...';
    if (taskId) {
      await apiCall('updateTask', { taskId, fields });
      showToast(`Задачу ${taskId} оновлено`);
    } else {
      await apiCall('createTask', { fields });
      showToast('Задачу створено');
    }
    refs.taskModal.close();
    await loadData();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    refs.saveTaskBtn.disabled = false;
    refs.saveTaskBtn.textContent = taskId ? 'Зберегти зміни' : 'Створити задачу';
  }
}

async function quickUpdateTask(taskId, fields) {
  try {
    await apiCall('updateTask', { taskId, fields });
    showToast(`Задачу ${taskId} оновлено`);
    await loadData();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  }
}

function openCommentModal(task) {
  refs.commentForm.reset();
  $('#commentTaskId').value = getValue(task, 'id');
  refs.commentTaskTitle.textContent = `Коментар до ${getValue(task, 'id')}`;
  refs.commentModal.showModal();
}

async function saveComment(event) {
  event.preventDefault();
  const taskId = $('#commentTaskId').value;
  const payload = {
    taskId,
    type: $('#commentType').value,
    author: $('#commentAuthor').value,
    to: $('#commentTo').value,
    text: $('#commentText').value.trim(),
    nextAction: $('#commentNext').value.trim(),
    responseDeadline: $('#commentDeadline').value,
  };

  try {
    await apiCall('addComment', payload);
    refs.commentModal.close();
    showToast(`Коментар до ${taskId} додано`);
    await loadData();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  }
}

function handleBoardClick(event) {
  const action = event.target.dataset.action;
  if (!action) return;
  const card = event.target.closest('[data-task-id]');
  if (!card) return;
  const taskId = card.dataset.taskId;
  const task = findTaskById(taskId);
  if (!task) return;

  if (action === 'edit-task') openTaskModal(task);
  if (action === 'add-comment') openCommentModal(task);
  if (action === 'mark-done') {
    const fields = {};
    setValue(fields, 'status', 'Готово');
    setValue(fields, 'progress', 1);
    quickUpdateTask(taskId, fields);
  }
}

function handleBoardChange(event) {
  if (event.target.dataset.action !== 'change-status') return;
  const card = event.target.closest('[data-task-id]');
  if (!card) return;
  const fields = {};
  setValue(fields, 'status', event.target.value);
  if (event.target.value === 'Готово') setValue(fields, 'progress', 1);
  quickUpdateTask(card.dataset.taskId, fields);
}

function handleTableClick(event) {
  if (event.target.dataset.action !== 'edit-task') return;
  const row = event.target.closest('[data-task-id]');
  const task = findTaskById(row?.dataset.taskId);
  if (task) openTaskModal(task);
}

function bindEvents() {
  refs.refreshData.addEventListener('click', loadData);
  refs.openCreateTask.addEventListener('click', () => openTaskModal());
  refs.taskForm.addEventListener('submit', saveTask);
  refs.commentForm.addEventListener('submit', saveComment);
  refs.board.addEventListener('click', handleBoardClick);
  refs.board.addEventListener('change', handleBoardChange);
  refs.tableBody.addEventListener('click', handleTableClick);

  [refs.searchInput, refs.statusFilter, refs.priorityFilter, refs.ownerFilter, refs.departmentFilter, refs.overdueOnly]
    .forEach((el) => el.addEventListener('input', applyFilters));

  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => refs.taskModal.close()));
  $$('[data-close-comment]').forEach((button) => button.addEventListener('click', () => refs.commentModal.close()));
}

function init() {
  bindEvents();
  if (!isApiConfigured()) {
    refs.setupWarning.classList.remove('hidden');
    renderAll();
    return;
  }
  loadData();
  if (CONFIG.REFRESH_INTERVAL_MS > 0) {
    window.setInterval(loadData, CONFIG.REFRESH_INTERVAL_MS);
  }
}

init();
