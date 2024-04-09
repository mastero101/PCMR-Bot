const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Leer variables de entorno
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const bot = new TelegramBot(token, { polling: true });
let dbConnection = null;
const redis = new Redis();

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
      const logMessage = (`Error al conectar a la base de datos con el host ${host}:`, err);
      writeLogToFile(logMessage);
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

  // Verifica si el usuario está intentando darse puntos a sí mismo o al bot
  if (userId === repliedToUserId || repliedToUsername === 'ranking_pcmr_bot') {
    bot.sendMessage(chatId, '¡No puedes darte puntos a ti mismo o al bot!');
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
      const logMessage1 = ('Error al consultar la base de datos:', selectErr)
      writeLogToFile(logMessage1);
    } else {
      if (selectResults.length === 0) {
        // Si el usuario no existe, inserta un nuevo registro
        const insertSql = 'INSERT INTO ranking (userId, username, fullname, points) VALUES (?, ?, ?, ?)';
        dbConnection.query(insertSql, [repliedToUserId, repliedToUsername, repliedToUserFullName, pointsToAdd], (insertErr) => {
          if (insertErr) {
            console.error('Error al agregar puntos a la base de datos:', insertErr);
            const logMessage2 = ('Error al agregar puntos a la base de datos:', insertErr)
            writeLogToFile(logMessage2);
            bot.sendMessage(chatId, 'Ha ocurrido un error al agregar puntos.');
          } else {
            if (repliedToUsername) {
              console.log(`Se ha sumado ${pointsToAdd} punto a @${repliedToUsername}.`);
            } else {
              console.log(`Se ha sumado ${pointsToAdd} punto a [${repliedToUserId}]${repliedToUserFullName}.`);
            }

            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a ${repliedToUserMention}.`, extraOpts);

            // Actualiza la caché de Redis después de agregar puntos
            updateRedisCache(extraOpts);
          }
        });
      } else {
        // Si el usuario ya existe, actualiza sus puntos y nombre (evita que no coincida si lo cambia)
        const updateSql = 'UPDATE ranking SET points = points + ?, fullname = ? WHERE userId = ?';
        dbConnection.query(updateSql, [pointsToAdd, repliedToUserFullName, repliedToUserId], (updateErr) => {
          if (updateErr) {
            console.error('Error al actualizar puntos del usuario:', updateErr);
            bot.sendMessage(chatId, 'Ha ocurrido un error al actualizar puntos.');
            const logMessage3 = ('Error al actualizar puntos del usuario:', updateErr)
            writeLogToFile(logMessage3);
          } else {
            if (repliedToUsername) {
              console.log(`Se ha sumado ${pointsToAdd} punto a @${repliedToUsername}.`);
            } else {
              console.log(`Se ha sumado ${pointsToAdd} punto a [${repliedToUserId}]${repliedToUserFullName}.`);
            }

            bot.sendMessage(chatId, `Se ha sumado ${pointsToAdd} punto a ${repliedToUserMention}.`, extraOpts);

            // Actualiza la caché de Redis después de agregar puntos
            updateRedisCache(extraOpts);
          }
        });
      }
    }
  });
}

// Función para actualizar la caché de Redis
function updateRedisCache(extraOpts) {
  // Realiza una consulta SQL para obtener el ranking de usuarios
  const sql = 'SELECT userId, username, fullname, SUM(points) AS total_points FROM ranking GROUP BY userId ORDER BY total_points DESC LIMIT 10';
  dbConnection.query(sql, (err, results) => {
    if (err) {
      console.error('Error al obtener el ranking de la base de datos:', err);
      const logMessage4 = ('Error al obtener el ranking de la base de datos:', err)
      writeLogToFile(logMessage4);
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

      // Almacena el ranking en la caché de Redis por 5 minutos
      redis.set('rank', response, 'EX', 300);
    }
  });
}

// Define una función para el comando /rank
bot.onText(/\/rank/, async (msg) => {
  const chatId = msg.chat.id;

  // Opciones adicionales a sendMessage()
  // https://core.telegram.org/bots/api#sendmessage
  const extraOpts = { parse_mode: 'HTML' };

  // Intenta obtener el ranking desde la caché de Redis
  const cachedRanking = await redis.get('rank');
  if (cachedRanking) {
    console.log('Obteniendo ranking desde la caché de Redis.');
    bot.sendMessage(chatId, cachedRanking, extraOpts);
  } else {
    // Realiza una consulta SQL para obtener el ranking de usuarios
    const sql = 'SELECT userId, username, fullname, SUM(points) AS total_points FROM ranking GROUP BY userId ORDER BY total_points DESC LIMIT 10';
    dbConnection.query(sql, (err, results) => {
      if (err) {
        console.error('Error al obtener el ranking de la base de datos:', err);
        bot.sendMessage(chatId, 'Ha ocurrido un error al obtener el ranking.');
        const logMessage5 = ('Error al obtener el ranking de la base de datos:', err)
        writeLogToFile(logMessage5);
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

        // Almacena el ranking en la caché de Redis por 5 minutos
        redis.set('rank', response, 'EX', 300);

        bot.sendMessage(chatId, response, extraOpts);
      }
    });
  }
});

// Define una función para el comando /chatgpt
bot.onText(/\/gpt/, (msg) => {
  const chatId = msg.chat.id;

  // Obtén el texto del mensaje del usuario
  const userMessage = msg.text.replace(/\/gpt/, '').trim();

  // Verifica si el mensaje no está vacío
  if (!userMessage) {
    bot.sendMessage(chatId, 'Por favor, proporciona un mensaje para obtener una respuesta de ChatGPT.');
    return;
  }

  // Envía el mensaje del usuario a OpenAI para obtener una respuesta
  sendToOpenAI(userMessage)
    .then((aiResponse) => {
      // Envía la respuesta de ChatGPT al chat de Telegram
      bot.sendMessage(chatId, `GPT: ${aiResponse}`);
    })
    .catch((error) => {
      console.error('Error al obtener respuesta de ChatGPT:', error);
      bot.sendMessage(chatId, 'Ha ocurrido un error al obtener respuesta de ChatGPT.');
    });
});

bot.onText(/\/dalle/, (msg) => {
  const chatId = msg.chat.id;
  const userPrompt = msg.text.replace(/\/dalle/, '').trim();

  if (!userPrompt) {
    bot.sendMessage(chatId, 'Por favor, proporciona un prompt para generar una imagen con DALL-E.');
    return;
  }

  generateImageWithDALL_E(userPrompt)
    .then((imageURL) => {
      // Envía la URL de la imagen generada al chat de Telegram
      bot.sendMessage(chatId, `Aquí está tu imagen generada:\n${imageURL}`);
    })
    .catch((error) => {
      console.error('Error al generar la imagen con DALL-E:', error);
      bot.sendMessage(chatId, 'Ha ocurrido un error al generar la imagen con DALL-E.');
    });
});

// Evento para manejar mensajes de voz
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;

  try {
    // Transcribe el audio utilizando la función que creamos
    const transcription = await transcribeAudio(msg.voice.file_id);
    // Envía la transcripción al chat de Telegram
    bot.sendMessage(chatId, `Transcripción: ${transcription}`);

    userMessage = transcription
    // Envía la transcripción como userMessage a ChatGPT 3.5Turbo
    const chatGPTResponse = await sendToOpenAI(userMessage);
    // Envía la transcripción al chat de Telegram
    bot.sendMessage(chatId, `GPT: ${chatGPTResponse}`);
  } catch (error) {
    console.error('Error al obtener la transcripción:', error);
    bot.sendMessage(chatId, 'Ha ocurrido un error al obtener la transcripción.');
  }
});

// Función para manejar el comando /ec (exchange)
bot.onText(/\/ec/, (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text.replace(/\/ec/, '').trim();

  // Expresión regular para validar el formato del comando
  const formatRegex = /^(\d{1,}(,\d{3})*(\.\d+)?)\s+([a-zA-Z]{3})\s+([a-zA-Z]{3})$/;

  // Verifica si el mensaje cumple con el formato esperado
  const match = userMessage.match(formatRegex);
  if (!match) {
    bot.sendMessage(chatId, 'El comando debe tener este formato\n/ec 1,000,000 usd mxn\n/ec 1000000 usd mxn');
    return;
  }

  // Extrae las partes del mensaje
  const amount = match[1].replace(/,/g, '');
  const fromCurrency = match[4].toUpperCase();
  const toCurrency = match[5].toUpperCase();

  // Verifica si los valores esperados están presentes
  if (!amount || !fromCurrency || !toCurrency) {
    bot.sendMessage(chatId, 'El comando debe tener este formato\n/ec 1,000,000 usd mxn\n/ec 1000000 usd mxn');
    return;
  }

  // Realiza la conversión utilizando ExchangeRate-API
  convertCurrency(amount, fromCurrency, toCurrency)
    .then((result) => {
      // Formatea la cantidad con separador de miles y millones
      const formattedAmount = parseFloat(amount).toLocaleString(undefined, { maximumFractionDigits: 2 });

      // Formatea el resultado con separador de miles y millones
      const formattedResult = parseFloat(result).toLocaleString(undefined, { maximumFractionDigits: 2 });

      bot.sendMessage(chatId, `${formattedAmount} ${fromCurrency} Valen: ${formattedResult} ${toCurrency}`);
    })
    .catch((error) => {
      console.error('Error al realizar la conversión de divisas:', error);
      bot.sendMessage(chatId, 'Ha ocurrido un error al realizar la conversión de divisas.');
    });
});

bot.onText(/\/cloud/, (msg) => {
  const chatId = msg.chat.id;
  const userPrompt = msg.text.replace(/\/cloud/, '').trim();

  if (!userPrompt) {
    bot.sendMessage(chatId, 'Por favor, proporciona un prompt para generar una imagen.');
    return;
  }

  sendPromptToWorker(userPrompt)
    .then((imageURL) => {
      // Envía la URL de la imagen generada al chat de Telegram
      bot.sendMessage(chatId, `Aquí está tu imagen generada:\n${imageURL}`);
    })
    .catch((error) => {
      console.error('Error al generar la imagen:', error);
      bot.sendMessage(chatId, 'Ha ocurrido un error al generar la imagen.');
    });
});

// Función para enviar el prompt a Cloudflare Workers y obtener una imagen
async function sendPromptToWorker(prompt) {
  try {
    const response = await axios.post(
      'https://stable-difussion-xl.castro-alejandro17.workers.dev/',
      { prompt },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // Retorna la URL de la imagen generada
    return response.data;
  } catch (error) {
    throw error;
  }
}


// Función para enviar mensajes a OpenAI y obtener una respuesta
async function sendToOpenAI(userMessage) {
  try {
    const openAiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      messages: [{ role: 'user', content: userMessage }],
      model: 'gpt-3.5-turbo',
      max_tokens: 300,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    });

    return openAiResponse.data.choices[0].message.content;
  } catch (error) {
    throw error;
  }
}

// Función para enviar prompt a OpenAI-DALL-E y obtener una imagen
async function generateImageWithDALL_E(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        prompt: prompt,
        model: 'dall-e-3',
        size: "1024x1024",
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`, // Reemplaza con tu clave de API para DALL-E
        },
      }
    );

    // Extrae la URL de la imagen generada del campo 'data'
    const imageURL = response.data.data[0].url;

    // Retorna la URL de la imagen generada
    return imageURL;
  } catch (error) {
    throw error;
  }
}

// Función para enviar un archivo de audio a OpenAI Whisper y obtener la transcripción
async function transcribeAudio(fileId) {
  const voiceFile = await bot.getFile(fileId);
  const voiceUrl = `https://api.telegram.org/file/bot${token}/${voiceFile.file_path}`;

  const response = await axios.get(voiceUrl, { responseType: 'arraybuffer' });
  const audioBuffer = Buffer.from(response.data);

  try {
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.ogg' }); // Ajusta el nombre del archivo según sea necesario
    form.append('model', 'whisper-1');
    form.append('language', 'es'); // Ajusta el idioma según sea necesario

    const openaiResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${form._boundary}`,
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    });

    console.log('Respuesta de OpenAI:', openaiResponse.data);

    if (openaiResponse.data && openaiResponse.data.text) {
      return openaiResponse.data.text;
    } else {
      console.error('La respuesta de OpenAI no tiene la estructura esperada:', openaiResponse.data);
      throw new Error('Error al obtener la transcripción: Respuesta inesperada de OpenAI');
    }
    
  } catch (error) {
    console.error('Error al procesar la respuesta de OpenAI:', error.message);
    throw error;
  }
}

// Función para realizar la conversión de divisas
async function convertCurrency(amount, fromCurrency, toCurrency) {
  try {
    const response = await axios.get(`https://v6.exchangerate-api.com/v6/dc53d5e849ebd478c7b979aa/pair/${fromCurrency}/${toCurrency}/${amount}`);
    return response.data.conversion_result;
  } catch (error) {
    throw error;
  }
}

// Función para escribir en el archivo de registro
function writeLogToFile(message) {
  const logFilePath = path.join(__dirname, 'logs.txt');

  // Formatea el mensaje con la fecha y hora actual
  const formattedMessage = `[${new Date().toLocaleString()}] ${message}\n`;

  // Escribe en el archivo
  fs.appendFileSync(logFilePath, formattedMessage);
}

// Inicia el bot
bot.on('polling_error', (error) => {
  console.log(`Polling error: ${error}`);
});



// Cierra la conexión a la base de datos al detener el bot
process.on('exit', () => {
  if (dbConnection.state !== 'disconnected') {
    dbConnection.end();
  }
  redis.quit();
  console.log('Conexión a la base de datos cerrada.');
});

console.log('Bot Telegram PCMRM Corriendo ..............');
