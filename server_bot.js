const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');

const token = '6779482679:AAHJwXiVpvz0fXCaf4LcwUKtx0p3GpZjVws';

const bot = new TelegramBot(token, { polling: true });

let dbConnection;

// Función para conectar a la base de datos
function connectToDatabase(host) {
  return mysql.createConnection({
    host: host,
    user: 'mastero',
    password: 'alejandrof15',
    database: 'test',
    port: 3306,
    ssl: false
  });
}

// Lista de hosts de base de datos
const dbHosts = ['localhost', '20.172.167.237'];

// Intenta la conexión a la base de datos
function tryDatabaseConnection(hosts) {
  const host = hosts.shift();

  dbConnection = connectToDatabase(host);

  dbConnection.connect((err) => {
    if (err) {
      console.error(`Error al conectar a la base de datos con el host ${host}:`, err);

      if (hosts.length > 0) {
        tryDatabaseConnection(hosts);
      } else {
        console.error('Error al conectar a todos los hosts.');
      }
    } else {
      console.log(`Conexión a la base de datos establecida con el host ${host}.`);
    }
  });
}

tryDatabaseConnection([...dbHosts]); // Inicia el intento de conexión con la lista de hosts

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

  // Verifica si el usuario tiene un nombre de usuario
  const username = repliedToUsername || 'No_Username';

  // Verifica si el usuario ya existe en la base de datos
  const selectSql = 'SELECT * FROM ranking WHERE userId = ?';
  dbConnection.query(selectSql, [repliedToUserId], (selectErr, selectResults) => {
    if (selectErr) {
      console.error('Error al consultar la base de datos:', selectErr);
      bot.sendMessage(chatId, 'Ha ocurrido un error al verificar el usuario.');
    } else {
      if (selectResults.length === 0) {
        // Si el usuario no existe, inserta un nuevo registro
        const insertSql = 'INSERT INTO ranking (userId, username, points) VALUES (?, ?, ?)';
        dbConnection.query(insertSql, [repliedToUserId, username, pointsToAdd], (insertErr) => {
          if (insertErr) {
            console.error('Error al agregar puntos a la base de datos:', insertErr);
            bot.sendMessage(chatId, 'Ha ocurrido un error al agregar puntos.');
          } else {
            console.log(`Se ha sumado ${pointsToAdd} punto a @${username}.`);
            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a @${username}.`);
          }
        });
      } else {
        // Si el usuario ya existe, actualiza sus puntos
        const updateSql = 'UPDATE ranking SET points = points + ? WHERE userId = ?';
        dbConnection.query(updateSql, [pointsToAdd, repliedToUserId], (updateErr) => {
          if (updateErr) {
            console.error('Error al actualizar puntos del usuario:', updateErr);
            bot.sendMessage(chatId, 'Ha ocurrido un error al actualizar puntos.');
          } else {
            console.log(`Se ha sumado ${pointsToAdd} punto a @${username}.`);
            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a @${username}.`);
          }
        });
      }
    }
  });
}


// Define una función para el comando /rank
bot.onText(/\/rank/, (msg) => {
    const chatId = msg.chat.id;
  
    // Realiza una consulta SQL para obtener el ranking de usuarios
    const sql = 'SELECT username, SUM(points) AS total_points FROM ranking GROUP BY userId ORDER BY total_points DESC LIMIT 10';
    dbConnection.query(sql, (err, results) => {
      if (err) {
        console.error('Error al obtener el ranking de la base de datos:', err);
        bot.sendMessage(chatId, 'Ha ocurrido un error al obtener el ranking.');
      } else {
        let response = 'Top 10 de usuarios:\n';
        results.forEach((row, index) => {
          response += `${index + 1}. @${row.username}: Puntos - ${row.total_points}\n`;
        });
        bot.sendMessage(chatId, response);
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
