const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');

// Leer variables de entorno
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const bot = new TelegramBot(token, { polling: true });
let dbConnection = null;

// Función para conectar a la base de datos
function connectToDatabase() {
  const port = Number(process.env.DB_NAME);
  const host = process.env.DB_HOST ?? 'localhost';

  dbConnection = mysql.createConnection({
    host: host,
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASS ?? '',
    database: process.env.DB_NAME ?? '',
    port: Number.isNaN(port) ? 3306 : port,
    ssl: (process.env.DB_HOST ?? '') === 'true'
  });

  dbConnection.connect((err) => {
    if (err) {
      console.error(`Error al conectar a la base de datos con el host ${host}:`, err);
    } else {
      console.log(`Conexión a la base de datos establecida con el host ${host}.`);
    }
  });
}

// Inicia el intento de conexión a la base de datos
connectToDatabase();

// Define una función para el comando /addpoints y /lesspoints
bot.onText(/\/add/, (msg) => {
  handlePointsCommand(msg, 1);
});

bot.onText(/\/less/, (msg) => {
  handlePointsCommand(msg, -1);
});

// Función para manejar los comandos de puntos
function handlePointsCommand(msg, pointsToAdd) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Obtiene el ID del usuario al que se le responde
  const repliedToUserId = msg.reply_to_message.from.id;

  // Obtiene el nombre de usuario del usuario al que se le responde
  const repliedToUsername = msg.reply_to_message.from.username;

  // Nombre del usuario
  const repliedToUserFullName = `${msg.reply_to_message.from.first_name ?? ''} ${msg.reply_to_message.from.last_name ?? ''}`.trim();

  // Enlace al usuario
  const repliedToUserMention = repliedToUsername ? `@${repliedToUsername}` : `<a href="tg://user?id=${repliedToUserId}">${repliedToUserFullName}</a>`;

  // Verifica si el usuario está intentando darse puntos a sí mismo
  if (userId === repliedToUserId) {
    bot.sendMessage(chatId, '¡No puedes darte puntos a ti mismo!');
    return;
  }

  // Opciones adicionales a sendMessage()
  // https://core.telegram.org/bots/api#sendmessage
  const extraOpts = {};

  // Se generó el enlace (repliedToUserMention) con HTML
  // https://core.telegram.org/bots/api#html-style
  if (!repliedToUsername) {
    extraOpts.parse_mode = 'HTML';
  }

  // Verifica si el usuario ya existe en la base de datos
  const selectSql = 'SELECT * FROM ranking WHERE userId = ?';
  dbConnection.query(selectSql, [repliedToUserId], (selectErr, selectResults) => {
    if (selectErr) {
      console.error('Error al consultar la base de datos:', selectErr);
      bot.sendMessage(chatId, 'Ha ocurrido un error al verificar el usuario.');
    } else {
      if (selectResults.length === 0) {
        // Si el usuario no existe, inserta un nuevo registro
        const insertSql = 'INSERT INTO ranking (userId, username, fullname, points) VALUES (?, ?, ?)';
        dbConnection.query(insertSql, [repliedToUserId, repliedToUsername, repliedToUserFullName, pointsToAdd], (insertErr) => {
          if (insertErr) {
            console.error('Error al agregar puntos a la base de datos:', insertErr);
            bot.sendMessage(chatId, 'Ha ocurrido un error al agregar puntos.');
          } else {
            if (repliedToUsername) {
              console.log(`Se ha sumado ${pointsToAdd} punto a @${repliedToUsername}.`);
            } else {
              console.log(`Se ha sumado ${pointsToAdd} punto a [${repliedToUserId}]${repliedToUserFullName}.`);
            }

            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a ${repliedToUserMention}.`, extraOpts);
          }
        });
      } else {
        // Si el usuario ya existe, actualiza sus puntos y nombre (evita que no coincida si lo cambia)
        const updateSql = 'UPDATE ranking SET points = points + ?, fullname = ? WHERE userId = ?';
        dbConnection.query(updateSql, [pointsToAdd, repliedToUserFullName, repliedToUserId], (updateErr) => {
          if (updateErr) {
            console.error('Error al actualizar puntos del usuario:', updateErr);
            bot.sendMessage(chatId, 'Ha ocurrido un error al actualizar puntos.');
          } else {
            if (repliedToUsername) {
              console.log(`Se ha sumado ${pointsToAdd} punto a @${repliedToUsername}.`);
            } else {
              console.log(`Se ha sumado ${pointsToAdd} punto a [${repliedToUserId}]${repliedToUserFullName}.`);
            }

            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a ${repliedToUserMention}.`, extraOpts);
          }
        });
      }
    }
  });
}

// Define una función para el comando /rank
bot.onText(/\/rank/, (msg) => {
    const chatId = msg.chat.id;

    // Opciones adicionales a sendMessage()
    // https://core.telegram.org/bots/api#sendmessage
    const extraOpts = {};
  
    // Realiza una consulta SQL para obtener el ranking de usuarios
    const sql = 'SELECT userId, username, fullname, SUM(points) AS total_points FROM ranking GROUP BY userId ORDER BY total_points DESC LIMIT 10';
    dbConnection.query(sql, (err, results) => {
      if (err) {
        console.error('Error al obtener el ranking de la base de datos:', err);
        bot.sendMessage(chatId, 'Ha ocurrido un error al obtener el ranking.');
      } else {
        let response = 'Top 10 de usuarios:\n';
        results.forEach((row, index) => {
          const userId = row.userId;
          const username = row.username ?? '';
          const fullname = row.fullname;
          const usermention = username?.length > 0 ? `@${username}` : `<a href="tg://user?id=${userId}">${fullname}</a>`;

          // Se generó el enlace (usermention) con HTML
          // https://core.telegram.org/bots/api#html-style
          if (username?.length < 1) {
            extraOpts.parse_mode = 'HTML';
          }

          response += `${index + 1}. ${usermention} - ${row.total_points}\n`;
        });
        bot.sendMessage(chatId, response, extraOpts);
      }
    });
  });

// Inicia el bot
bot.on('polling_error', (error) => {
  console.log(`Polling error: ${error}`);
});

// Cierra la conexión a la base de datos al detener el bot
process.on('exit', () => {
  dbConnection.end();
  console.log('Conexión a la base de datos cerrada.');
});

console.log('Bot Telegram PCMRM Corriendo ..............');
