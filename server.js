const { program } = require('commander');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const swaggerJsdoc = require('swagger-jsdoc'); //генерація OpenAPI-специфікації з коментарів
const swaggerUi = require('swagger-ui-express'); //веб-інтерфейс для перегляду документації Swagger

const runningInDocker = process.env.DOCKER === 'true';

// Базові значення за замовчуванням
let options = {
  host: process.env.HOST || '0.0.0.0',
  port: process.env.PORT || 3000,
  cache: process.env.CACHE_DIR || './cache'
};

if (!runningInDocker) {
  // Аргументи командного рядка використовуються лише локально
  program
    .option('-h, --host <host>', 'Адреса сервера', options.host)
    .option('-p, --port <port>', 'Порт сервера', options.port)
    .option('-c, --cache <path>', 'Шлях до директорії кешу', options.cache)
    .parse(process.argv);

  options = program.opts();
}

// ❗Просто закоментували, НІЧОГО НЕ ВИДАЛИЛИ
// module.exports = options;

// Перевіряємо/створюємо директорію кешу
const cachePath = path.resolve(options.cache);
if (!fs.existsSync(cachePath)) {
  console.log(`Створюю директорію кешу: ${cachePath}`);
  fs.mkdirSync(cachePath, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger конфігурація
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service API',
      version: '1.0.0',
      description: 'API для управління інвентарем',
    },
    servers: [
      {
        url: `http://localhost:${options.port}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./server.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Налаштування multer для файлів
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, cachePath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// "база даних" у пам'яті
let inventory = [];
let nextId = 1;

/**
 * @swagger
 * /RegisterForm.html:
 *   get:
 *     summary: Повертає HTML-форму реєстрації пристрою
 *     tags:
 *       - Форми
 *     responses:
 *       200:
 *         description: HTML-сторінка з формою реєстрації
 */
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.resolve('RegisterForm.html')); 
});

/**
 * @swagger
 * /SearchForm.html:
 *   get:
 *     summary: Повертає HTML-форму пошуку пристрою за ID
 *     tags:
 *       - Форми
 *     responses:
 *       200:
 *         description: HTML-сторінка з формою пошуку
 */
app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.resolve('SearchForm.html')); 
});

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Реєстрація нового пристрою
 *     tags:
 *       - Інвентар
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: Назва речі
 *               description:
 *                 type: string
 *                 description: Опис речі
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Фото пристрою (необов'язково)
 *     responses:
 *       201:
 *         description: Пристрій успішно зареєстрований
 *       400:
 *         description: Не вказано обов'язкові дані
 */
app.post('/register', upload.single('photo'), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    return res.status(400).json({ error: "Ім'я речі обов'язкове" });
  }

  const newItem = {
    id: nextId++,
    inventory_name,
    description: description || '',
    photo_filename: req.file ? req.file.filename : null
  };

  inventory.push(newItem);

  res.status(201).json({
    message: 'Пристрій успішно зареєстрований',
    id: newItem.id
  });
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Повертає список усіх речей
 *     tags:
 *       - Інвентар
 *     responses:
 *       200:
 *         description: Список усіх зареєстрованих речей
 */
app.get('/inventory', (req, res) => {
  const inventoryWithUrls = inventory.map(item => ({
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    photo_url: item.photo_filename ? `/inventory/${item.id}/photo` : null
  }));

  res.json(inventoryWithUrls);
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Отримати інформацію про конкретну річ
 *     tags:
 *       - Інвентар
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID речі
 *     responses:
 *       200:
 *         description: Інформація про річ
 *       404:
 *         description: Річ не знайдена
 */
app.get('/inventory/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  res.json({
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    photo_url: item.photo_filename ? `/inventory/${item.id}/photo` : null
  });
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Оновити назву або опис речі
 *     tags:
 *       - Інвентар
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID речі
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: Нова назва речі
 *               description:
 *                 type: string
 *                 description: Новий опис речі
 *     responses:
 *       200:
 *         description: Інформацію про річ оновлено
 *       404:
 *         description: Річ не знайдена
 */
app.put('/inventory/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const { inventory_name, description } = req.body;

  if (inventory_name !== undefined) {
    item.inventory_name = inventory_name;
  }

  if (description !== undefined) {
    item.description = description;
  }

  res.json({ message: 'Інформацію про річ оновлено' });
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Отримати фото речі
 *     tags:
 *       - Фото
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID речі
 *     responses:
 *       200:
 *         description: Файл зображення
 *       404:
 *         description: Фото не знайдено
 */
app.get('/inventory/:id/photo', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const item = inventory.find(i => i.id === itemId);

  if (!item || !item.photo_filename) {
    return res.status(404).json({ error: 'Фото не знайдено' });
  }

  const photoPath = path.join(cachePath, item.photo_filename);
  if (!fs.existsSync(photoPath)) {
    return res.status(404).json({ error: 'Файл фото не знайдено' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(photoPath);
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Оновити фото речі
 *     tags:
 *       - Фото
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID речі
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Нове фото речі
 *     responses:
 *       200:
 *         description: Фото оновлено успішно
 *       400:
 *         description: Фото не передано
 *       404:
 *         description: Річ не знайдена
 */
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Фото обов\'язкове' });
  }

  if (item.photo_filename) {
    const oldPath = path.join(cachePath, item.photo_filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  item.photo_filename = req.file.filename;

  res.json({ message: 'Фото оновлено успішно' });
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Видалити річ з інвентаря
 *     tags:
 *       - Інвентар
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID речі
 *     responses:
 *       200:
 *         description: Річ успішно видалена
 *       404:
 *         description: Річ не знайдена
 */
app.delete('/inventory/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const index = inventory.findIndex(i => i.id === itemId);

  if (index === -1) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const item = inventory[index];

  if (item.photo_filename) {
    const photoPath = path.join(cachePath, item.photo_filename);
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  }

  inventory.splice(index, 1);

  res.json({ message: 'Річ успішно видалена' });
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Пошук речі за ID, з можливістю повернення посилання на фото
 *     tags:
 *       - Пошук
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: ID речі
 *               has_photo:
 *                 type: string
 *                 description: Якщо 'on', додається поле з посиланням на фото
 *     responses:
 *       200:
 *         description: Інформація про знайдену річ
 *       404:
 *         description: Річ не знайдена
 */
app.post('/search', (req, res) => {
  const { id, has_photo } = req.body;

  const itemId = parseInt(id, 10);
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const result = {
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description
  };

  if (has_photo === 'on' && item.photo_filename) {
    result.photo_url = `/inventory/${item.id}/photo`;
  }

  res.json(result);
});

// Обробка невідомих маршрутів
app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не знайдено' });
});


// Запуск сервера
const server = http.createServer(app);

server.listen(options.port, options.host, () => {
  console.log("=======================================");
  console.log(" Сервіс інвентаризації запущено");
  console.log("=======================================\n");

  console.log(` Сервер працює на  :  http://localhost:${options.port}`);
  console.log(` Swagger Docs      :  http://localhost:${options.port}/docs\n`);

  console.log(" Доступні сторінки:");
  console.log(` • Реєстрація      :  http://localhost:${options.port}/RegisterForm.html`);
  console.log(` • Пошук           :  http://localhost:${options.port}/SearchForm.html\n`);

  console.log(` Директорія кешу   :  ${cachePath}`);
  console.log("=======================================");
});

module.exports = app;
