# BP Tasks Dashboard

Дашборд активных заданий бизнес-процессов Bitrix24. Показывает все текущие задания по сотрудникам выбранного департамента с аналитикой.

## Что умеет

- Список всех активных заданий БП по сотрудникам
- Поля для заполнения (типы, варианты, обязательность)
- Дашборд с 10 метриками + 4 интерактивных графика
- Фильтры: по отделу, шаблону БП, поиск, сортировка
- Экспорт в CSV
- Тёмная тема
- Автообновление каждые 5 минут
- Авторизация (пароль)

## Архитектура

```
[Любой хостинг]  →  [n8n Webhook]  →  [Bitrix24 REST API]
  index.html           бэкенд              данные
```

## Быстрый деплой (15 минут)

### 1. n8n (бэкенд)

1. Откройте n8n → **Import workflow** → загрузите `n8n-workflow.json`
2. Откройте ноду **"Auth Check"** → измените пароль:
   ```javascript
   const AUTH_TOKEN = 'ВашПароль123';
   ```
3. Откройте ноду **"Fetch BP Tasks"** → измените:
   ```javascript
   const WEBHOOKS = [
     'https://ваш-битрикс.ru/rest/USER_ID/WEBHOOK_CODE'
   ];
   const DEPT_NAME = 'Название вашего департамента';
   ```
4. **Активируйте** workflow (тогл справа вверху)
5. Запомните URL вебхука: `https://ваш-n8n.com/webhook/bp-dashboard`

> **Важно:** В n8n Settings установите Execution Timeout ≥ 120 секунд.

### 2. Фронтенд (index.html)

Откройте `docs/index.html` и замените URL на строке ~560:

```javascript
const API_URL = 'https://ваш-n8n.com/webhook/bp-dashboard';
```

### 3. Разместите index.html

Варианты:

| Способ | Как |
|--------|-----|
| **Свой сервер (nginx)** | Скопируйте `docs/index.html` в `/var/www/html/` |
| **GitHub Pages** | Push в репу → Settings → Pages → /docs |
| **Netlify** | Drag & drop папку `docs/` на netlify.com |
| **Просто открыть** | Двойной клик на `index.html` (работает локально) |

## Требования

- **n8n** — любая версия (self-hosted или cloud)
- **Bitrix24** — REST webhook с правами: `department`, `user`, `bizproc`, `crm.type`
- **Хостинг** — любой, способный отдать 1 HTML-файл (или просто браузер)

## Как получить Bitrix24 webhook

1. Bitrix24 → Приложения → Разработчикам → Другое → Входящий вебхук
2. Установите права: `department`, `user`, `bizproc`, `crm.type`
3. Скопируйте URL вида `https://your.bitrix24.ru/rest/1/abc123xyz/`

## Файлы

| Файл | Назначение |
|------|-----------|
| `n8n-workflow.json` | Workflow для импорта в n8n (бэкенд) |
| `docs/index.html` | Фронтенд (единственный файл для деплоя) |
| `server.js` | Express-сервер для локальной разработки |

## FAQ

**Q: Долго грузится?**
A: Первый запуск ~15-30 сек (зависит от кол-ва сотрудников). Данные не кешируются.

**Q: Можно добавить второй webhook Bitrix для ускорения?**
A: Да, просто добавьте второй URL в массив `WEBHOOKS` в Code ноде.

**Q: Как сменить пароль?**
A: В n8n откройте ноду "Auth Check" → измените `AUTH_TOKEN`.

**Q: Code нода падает с ошибкой `fetch is not defined`?**
A: Убедитесь что Code нода имеет `typeVersion: 1` (не 2). Версия 2 использует sandbox без HTTP.
