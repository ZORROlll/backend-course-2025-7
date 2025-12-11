const { program } = require('commander');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const swaggerJsdoc = require('swagger-jsdoc'); //генерація OpenAPI-специфікації з коментарів
const swaggerUi = require('swagger-ui-express'); //веб-інтерфейс для перегляду документації Swagger


program
  .requiredOption('-h, --host <host>', 'Адреса сервера')
  .requiredOption('-p, --port <port>', 'Порт сервера')
  .requiredOption('-c, --cache <path>', 'Шлях до директорії кешу')
  .parse(process.argv);

const options = program.opts();

// Перевіряємо/створюємо директорію кешу
const cachePath = path.resolve(options.cache); //перетворюю шлях до кешу в абсолютний
if (!fs.existsSync(cachePath)) {
  console.log(`Створюю директорію кешу: ${cachePath}`);
  fs.mkdirSync(cachePath, { recursive: true }); //синхронно створюю папку, і проміжні папки якщо треба
}

const app = express();
app.use(express.json()); //підтримка json у тілі запиту
app.use(express.urlencoded({ extended: true })); //підтримка даних html-форм

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
        url: `http://${options.host}:${options.port}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./server.js'], //з цього файлу беруться коментарі для swagger
};

const swaggerSpec = swaggerJsdoc(swaggerOptions); //cтворює об’єкт документації api і кладе його в swaggerSpec.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec)); // підключаю сторінку з документацією swagger за шляхом /docs

// Налаштування multer для завантаження файлів
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, cachePath);
  },
  filename: (req, file, cb) => { //вказую куди саме зберігати файли
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9); //унікальна частина імені (час + випадкове число)
    cb(null, 'photo-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage }); //cтворюю middleware для завантаження файлів з цим сховищем

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
app.get('/RegisterForm.html', (req, res) => { //маршрут для повернення сторінки з формою реєстрації
  res.sendFile(path.join(__dirname, 'RegisterForm.html'));
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
  res.sendFile(path.join(__dirname, 'SearchForm.html'));
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
app.post('/register', upload.single('photo'), (req, res) => { //маршрут для реєстрації нової речі (post/register)
  const { inventory_name, description } = req.body;

  if (!inventory_name) { //якщо назва не вказана
    return res.status(400).json({ error: "Ім'я речі обов'язкове" });
  }

  const newItem = {
    id: nextId++,
    inventory_name,
    description: description || '',
    photo_filename: req.file ? req.file.filename : null //ім'я файлу фото, якщо воно було завантажене
  };

  inventory.push(newItem); //додаю нову річ до масиву інвентарю


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
app.get('/inventory', (req, res) => { //маршрут для отримання списку всіх речей 
  const inventoryWithUrls = inventory.map(item => ({ //формується новий масив з додатковим полем photo_url
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    photo_url: item.photo_filename ? `/inventory/${item.id}/photo` : null
  }));

  res.json(inventoryWithUrls);  //відправляємо список речей у форматі json
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
app.get('/inventory/:id', (req, res) => { //маршрут для отримання інформації про одну річ за id

  const itemId = parseInt(req.params.id, 10); //бере параметр id з url і переводимо його в число
  const item = inventory.find(i => i.id === itemId); //шкає річ з таким id у масиві inventory

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
app.put('/inventory/:id', (req, res) => { //маршрут для оновлення назви або опису речі
  const itemId = parseInt(req.params.id, 10); //отримую id з url
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const { inventory_name, description } = req.body; //бере нові можливі значення зтіла запиту

  if (inventory_name !== undefined) { //якщо в запиті передано нову назву
    item.inventory_name = inventory_name //оновлює назву
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
app.get('/inventory/:id/photo', (req, res) => { //маршрут для отримання фото речі
  const itemId = parseInt(req.params.id, 10);  //отримує id з url
  const item = inventory.find(i => i.id === itemId); // шукає відповіну річ

  if (!item || !item.photo_filename) { //якщо речі немає або у неї немає фото
    return res.status(404).json({ error: 'Фото не знайдено' });
  }

  const photoPath = path.join(cachePath, item.photo_filename); //формує повний шлях до файлу фото
  if (!fs.existsSync(photoPath)) { //перевіряє, чи фото фізично існує на диску
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
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => { //маршрут для оновлення фото речі
  const itemId = parseInt(req.params.id, 10); // отримує id з url
  const item = inventory.find(i => i.id === itemId); // шукає річ з таким id 

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  if (!req.file) { //якщо клієнт не передав файл у запиті
    return res.status(400).json({ error: 'Фото обов\'язкове для оновлення' });
  }

  // Видаляємо старе фото, якщо воно було
  if (item.photo_filename) { // якщо  у реі вже було фото
    const oldPhotoPath = path.join(cachePath, item.photo_filename);
    if (fs.existsSync(oldPhotoPath)) { //якщо старий файл існує
      fs.unlinkSync(oldPhotoPath); 
    }
  }
 
  item.photo_filename = req.file.filename; //записує ім'я нового файлу фото для цієї речі
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
app.delete('/inventory/:id', (req, res) => { //маршрут для видалення речі з інвентаря
  const itemId = parseInt(req.params.id, 10); //отримує id з url
  const itemIndex = inventory.findIndex(i => i.id === itemId); //знаходить індекс реі в масиві

  if (itemIndex === -1) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const item = inventory[itemIndex]; //бере стару річ перед видаленням

  if (item.photo_filename) { //якщо у речі було фото
    const photoPath = path.join(cachePath, item.photo_filename); //шлях до файлу фото
    if (fs.existsSync(photoPath)) { //перевіряє чи фал існує
      fs.unlinkSync(photoPath);
    }
  }

  inventory.splice(itemIndex, 1); //видаляємо річ з масиву inventory

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
app.post('/search', (req, res) => { //маршрут для пошуку речі за id (через html-форму)
  const { id, has_photo } = req.body;
  const itemId = parseInt(id, 10); //перетворюємо id з рядка в число
  const item = inventory.find(i => i.id === itemId);

  if (!item) {
    return res.status(404).json({ error: 'Річ не знайдена' });
  }

  const responseItem = { //формує базову відповідь
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description
  };

  if (has_photo === 'on' && item.photo_filename) { //якщо користувач хоче посилання на фото і фото існує
    responseItem.photo_url = `/inventory/${item.id}/photo`;
  }

  res.json(responseItem); //повертає знайдену річ у форматі json
});
  
// Обробка невідомих маршрутів/методів
app.use((req, res) => {
  res.status(405).json({ error: 'Метод не дозволений' });
});

// Створюємо HTTP сервер з допомогою модуля http
const server = http.createServer(app);

// Запускаємо сервер з параметрами --host та --port
server.listen(options.port, options.host, () => {
  console.log('=== Сервіс інвентаризації ===');
  console.log(`Сервер запущено: http://${options.host}:${options.port}`);
  console.log(`Директорія кешу: ${cachePath}`);
  console.log(`Swagger документація: http://${options.host}:${options.port}/docs`);
  console.log('=============================');
});

module.exports = app;
