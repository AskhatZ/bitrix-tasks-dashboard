require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOKS = (process.env.BITRIX_WEBHOOKS || process.env.BITRIX_WEBHOOK).split(',').map(s => s.trim());
const DEPT_NAME = process.env.DEPARTMENT_NAME;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Round-robin webhook selector ---
let webhookIdx = 0;
function getWebhook() {
  const wh = WEBHOOKS[webhookIdx % WEBHOOKS.length];
  webhookIdx++;
  return wh;
}

// --- Bitrix24 API helpers ---

async function callBitrix(method, params = {}, retries = 3) {
  const webhook = getWebhook();
  const res = await fetch(`${webhook}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    if (res.status === 429 && retries > 0) {
      await new Promise(r => setTimeout(r, 600));
      return callBitrix(method, params, retries - 1);
    }
    throw new Error(`Bitrix API error: ${res.status}`);
  }
  const data = await res.json();
  if (data.error === 'QUERY_LIMIT_EXCEEDED' && retries > 0) {
    await new Promise(r => setTimeout(r, 600));
    return callBitrix(method, params, retries - 1);
  }
  return data;
}

async function callBitrixAll(method, params = {}) {
  let all = [];
  let start = 0;
  while (true) {
    const data = await callBitrix(method, { ...params, start });
    const result = data.result || [];
    all.push(...result);
    if (!data.total || all.length >= data.total) break;
    start += 50;
  }
  return all;
}

async function getAllSubDeptIds(parentId) {
  const ids = [parentId];
  const children = await callBitrixAll('department.get', { PARENT: parentId });
  for (const dept of children) {
    const childIds = await getAllSubDeptIds(Number(dept.ID));
    ids.push(...childIds);
  }
  return ids;
}

// --- Parallel batch helper ---
async function parallelBatch(items, fn, concurrency = 4) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// --- Cache ---
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

// --- Smart process names cache ---
let smartProcessMap = {};

async function loadSmartProcesses() {
  try {
    const data = await callBitrix('crm.type.list');
    const types = data.result?.types || [];
    smartProcessMap = {};
    for (const t of types) {
      smartProcessMap[`DYNAMIC_${t.entityTypeId}`] = t.title;
    }
  } catch (e) {
    console.error('Failed to load smart processes:', e.message);
  }
}

// --- API Routes ---

app.get('/api/dashboard', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';

    if (!forceRefresh && cache.data && (Date.now() - cache.timestamp < CACHE_TTL)) {
      return res.json(cache.data);
    }

    console.time('dashboard-load');

    // Parallel: load smart processes + find department
    const [, deptData] = await Promise.all([
      loadSmartProcesses(),
      callBitrix('department.get', { NAME: DEPT_NAME })
    ]);

    if (!deptData.result || deptData.result.length === 0) {
      return res.status(404).json({ error: 'Департамент не найден' });
    }
    const rootDeptId = Number(deptData.result[0].ID);

    // Parallel: sub-departments + all departments reference
    const [allDeptIds, allDepts] = await Promise.all([
      getAllSubDeptIds(rootDeptId),
      callBitrixAll('department.get', {})
    ]);

    const deptMap = {};
    for (const d of allDepts) {
      deptMap[d.ID] = d.NAME;
    }

    // Users from all departments (deduplicated)
    const rawUsers = await callBitrixAll('user.get', {
      filter: { UF_DEPARTMENT: allDeptIds, ACTIVE: true }
    });
    const usersMap = new Map();
    for (const u of rawUsers) {
      usersMap.set(u.ID, u);
    }
    const users = [...usersMap.values()];
    console.log(`Found ${users.length} users, fetching tasks in parallel...`);

    // Fetch tasks for all users in PARALLEL (6 — optimal for 2 webhooks)
    const dashboard = await parallelBatch(users, async (user) => {
      const tasks = await callBitrixAll('bizproc.task.list', {
        select: [
          'ID', 'NAME', 'DESCRIPTION', 'PARAMETERS',
          'USER_ID', 'WORKFLOW_TEMPLATE_NAME', 'WORKFLOW_STATE',
          'DOCUMENT_NAME', 'DOCUMENT_URL', 'MODIFIED', 'ACTIVITY',
          'WORKFLOW_STARTED', 'WORKFLOW_STARTED_BY', 'OVERDUE_DATE'
        ],
        filter: { USER_ID: Number(user.ID), STATUS: 0 },
        order: { ID: 'DESC' }
      });

      const userDepts = (user.UF_DEPARTMENT || [])
        .filter(id => allDeptIds.includes(Number(id)))
        .map(id => deptMap[id] || `Отдел #${id}`);

      return {
        user: {
          id: user.ID,
          name: `${user.LAST_NAME || ''} ${user.NAME || ''}`.trim(),
          position: user.WORK_POSITION || '',
          photo: user.PERSONAL_PHOTO || '',
          departments: userDepts
        },
        tasksCount: tasks.length,
        tasks: tasks.map(t => ({
          id: t.ID,
          name: t.NAME,
          description: t.DESCRIPTION || '',
          templateName: t.WORKFLOW_TEMPLATE_NAME,
          documentName: t.DOCUMENT_NAME,
          documentUrl: t.DOCUMENT_URL,
          modified: t.MODIFIED,
          workflowStarted: t.WORKFLOW_STARTED,
          overdueDate: t.OVERDUE_DATE,
          state: t.WORKFLOW_STATE,
          activity: t.ACTIVITY,
          buttons: extractButtons(t.PARAMETERS),
          fields: extractFields(t.PARAMETERS)
        }))
      };
    }, 6);

    dashboard.sort((a, b) => b.tasksCount - a.tasksCount);

    const bitrixBase = WEBHOOKS[0].replace(/\/rest\/.*$/, '');
    const result = {
      department: DEPT_NAME,
      bitrixUrl: bitrixBase,
      smartProcesses: smartProcessMap,
      subDepartments: allDeptIds.map(id => ({ id, name: deptMap[id] || `#${id}` })),
      totalUsers: dashboard.length,
      totalTasks: dashboard.reduce((sum, u) => sum + u.tasksCount, 0),
      updatedAt: new Date().toISOString(),
      employees: dashboard
    };

    cache = { data: result, timestamp: Date.now() };
    console.timeEnd('dashboard-load');
    res.json(result);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

function extractButtons(params) {
  if (!params) return [];
  const buttons = [];
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith('Label') && value) {
      buttons.push({ key, label: value });
    }
  }
  return buttons;
}

function extractFields(params) {
  if (!params || !params.Fields) return [];
  return params.Fields.map(f => ({
    id: f.Id,
    name: f.Name,
    type: f.Type,
    required: f.Required || false,
    multiple: f.Multiple || false,
    description: f.Description || '',
    options: f.Options || null
  }));
}

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Using ${WEBHOOKS.length} webhook(s) with parallel requests`);
});
