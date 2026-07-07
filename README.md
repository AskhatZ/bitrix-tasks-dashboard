# BP Tasks Dashboard

Дашборд активных заданий бизнес-процессов из Bitrix24 для департамента корпоративных продаж.

## Архитектура

```
[GitHub Pages / Netlify]  →  [n8n Webhook]  →  [Bitrix24 REST API]
     фронтенд (HTML)           бэкенд              данные
```

## Деплой

### Шаг 1: n8n (бэкенд)

1. Откройте ваш n8n
2. Нажмите **Import workflow** (или Ctrl+O)
3. Импортируйте файл `n8n-workflow.json`
4. **Активируйте** workflow (тогл в правом верхнем углу)
5. Скопируйте URL вебхука — он будет вида:
   ```
   https://ваш-n8n.com/webhook/bp-dashboard
   ```

> Важно: в n8n Settings → убедитесь что Execution Timeout достаточный (минимум 60 секунд), т.к. загрузка данных из Bitrix занимает ~25 сек.

### Шаг 2: Фронтенд (GitHub Pages)

1. Создайте репозиторий на GitHub
2. Запушьте папку `docs/` в репозиторий
3. В настройках репозитория: **Settings → Pages → Source: Deploy from branch → Branch: main, /docs**
4. **Отредактируйте** `docs/index.html` — замените `YOUR_N8N_DOMAIN` на реальный URL:
   ```javascript
   const API_URL = 'https://ваш-n8n.com/webhook/bp-dashboard';
   ```
5. Через ~1 мин сайт будет доступен по адресу `https://username.github.io/repo-name/`

### Альтернатива: Netlify

1. Зайдите на [netlify.com](https://netlify.com)
2. Drag & drop папку `docs/` на страницу деплоя
3. Готово — получите URL вида `https://random-name.netlify.app`

## Локальная разработка

```bash
npm install
npm start
# Открыть http://localhost:3000
```

## Файлы

| Файл | Назначение |
|------|-----------|
| `n8n-workflow.json` | Workflow для импорта в n8n (бэкенд) |
| `docs/index.html` | Фронтенд для GitHub Pages / Netlify |
| `server.js` | Локальный Express-сервер (для разработки) |
| `public/index.html` | Фронтенд для локальной версии |

## Настройки

Вебхуки Bitrix24 захардкожены в n8n workflow (нода "Fetch BP Tasks").
Чтобы изменить — откройте workflow в n8n и отредактируйте массив `WEBHOOKS` в Code ноде.
