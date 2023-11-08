const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');

const token = '6779482679:AAHJwXiVpvz0fXCaf4LcwUKtx0p3GpZjVws';

const bot = new TelegramBot(token, { polling: true });

// Configura la conexión a la base de datos
const dbConnection = mysql.createConnection({
    host: '20.172.167.237',
    user: 'mastero',
    password: 'alejandrof15',
    database: 'test',
    port: 3306,
    ssl: false
});

const dbConfig2 = {
    host: '20.172.167.237',
    user: 'mastero',
    password: 'alejandrof15',
    database: 'test',
    port: 3306,
    ssl: false
};

dbConnection.connect((err) => {
  if (err) {
    console.error('Error al conectar a la base de datos:', err);
  } else {
    console.log('Conexión a la base de datos establecida.');
  }
});

// Define una función para el comando /addpoints
bot.on('text', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
  
    if (text === '+' || text === '-') {
      // Verifica si el usuario ya existe en la base de datos
      const selectSql = 'SELECT * FROM ranking WHERE userId = ?';
      dbConnection.query(selectSql, [userId], (selectErr, selectResults) => {
        if (selectErr) {
          console.error('Error al consultar la base de datos:', selectErr);
          bot.sendMessage(chatId, 'Ha ocurrido un error al verificar el usuario.');
        } else {
          if (selectResults.length === 0) {
            // Si el usuario no existe, inserta un nuevo registro
            const insertSql = 'INSERT INTO ranking (userId, points) VALUES (?, ?)';
            dbConnection.query(insertSql, [userId, (text === '+') ? 1 : -1], (insertErr) => {
              if (insertErr) {
                console.error('Error al agregar puntos a la base de datos:', insertErr);
                bot.sendMessage(chatId, 'Ha ocurrido un error al agregar puntos.');
              } else {
                console.log(`Se ha agregado 1 punto al usuario con ID ${userId}.`);
                bot.sendMessage(chatId, `Se ha agregado 1 punto a ${msg.from.first_name}.`);
              }
            });
          } else {
            // Si el usuario ya existe, actualiza sus puntos
            const updateSql = 'UPDATE ranking SET points = points + ? WHERE userId = ?';
            dbConnection.query(updateSql, [(text === '+') ? 1 : -1, userId], (updateErr) => {
              if (updateErr) {
                console.error('Error al actualizar puntos del usuario:', updateErr);
                bot.sendMessage(chatId, 'Ha ocurrido un error al actualizar puntos.');
              } else {
                console.log(`Se ha ${text === '+' ? 'sumado' : 'restado'} 1 punto al usuario con ID ${userId}.`);
                bot.sendMessage(chatId, `Se ha ${text === '+' ? 'sumado' : 'restado'} 1 punto a ${msg.from.first_name}.`);
              }
            });
          }
        }
      });
    }
  });

// Define una función para el comando /rank
bot.onText(/\/rank/, (msg) => {
  const chatId = msg.chat.id;

  // Realiza una consulta SQL para obtener el ranking de usuarios
  const sql = 'SELECT user_id, SUM(points) AS total_points FROM ranking GROUP BY user_id ORDER BY total_points DESC';
  dbConnection.query(sql, (err, results) => {
    if (err) {
      console.error('Error al obtener el ranking de la base de datos:', err);
      bot.sendMessage(chatId, 'Ha ocurrido un error al obtener el ranking.');
    } else {
      let response = 'Ranking de usuarios:\n';
      results.forEach((row, index) => {
        response += `${index + 1}. Usuario ID: ${row.user_id}, Puntos: ${row.total_points}\n`;
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
