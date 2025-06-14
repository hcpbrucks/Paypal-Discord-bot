const express = require('express');

const paypal = require('paypal-rest-sdk');
const { Client, GatewayIntentBits } = require('discord.js');

const DISCORD_TOKEN = 'MTM4MTM3MDkyNDEwODA5MTUzMg.GucPl3.Hu4W3PwZjCrlZo-k2r4i2jpdMPivlxxYvO44Fw';
const GUILD_ID = '1381009607123796069';
const ROLE_ID = '1381289636952932352';
const PAYPAL_CLIENT_ID = 'AQYB9y5a6UIUUabcti0aRyydn90q-_IUJxKFNoqEaeZWt19wQir2zpEaABT21rD5XSYNyyniSaB2l9Pk';
const PAYPAL_CLIENT_SECRET = 'EB6wUs5ki6kJHVkWXNCihMvRR_kC-Jbvp3U0g6EsOQ12LYtjRH6oLJSJdPlb319tAeR_qb9VoEGt2CN-';
const BASE_URL = 'https://paypal-discord-bot.onrender.com';

const app = express();
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

const registeredUsers = new Map();

client.once('ready', () => {
  console.log(`✅ Discord Bot ist online als ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!register') {
    // ✅ Nur in Kauf-Ticket-Channels erlaubt
    const channelName = message.channel.name.toLowerCase();
    const forbiddenChannels = ['chat', 'hilfe', 'reviews'];

    if (!channelName.startsWith('kauf-ticket-') || forbiddenChannels.includes(channelName)) {
      return message.reply('❌ Dieser Befehl darf nur in einem Kauf-Ticket-Channel verwendet werden (z. B. „kauf-ticket-123“).');
    }

    const userId = message.author.id;
    const channel = message.channel;

    const messages = await channel.messages.fetch({ limit: 10 });
    const last = messages.find(msg =>
      msg.author.bot && msg.content.toLowerCase().includes('option')
    );

    if (!last) {
      return message.reply('❌ Konnte keine Nachricht mit dem Preis finden.');
    }

    const match = last.content.match(/Option\s+(\d+(?:[.,]\d{1,2})?)€/i);
    if (!match) {
      return message.reply('❌ Preis konnte nicht ausgelesen werden.');
    }

    const price = match[1].replace(',', '.');

    registeredUsers.set(userId, price);
    message.reply(`✅ Du bist registriert! Zahle hier: ${BASE_URL}/pay?userId=${userId}`);
  }
});

client.login(DISCORD_TOKEN);

// === PayPal ===
paypal.configure({
  mode: 'live',
  client_id: PAYPAL_CLIENT_ID,
  client_secret: PAYPAL_CLIENT_SECRET
});

// === Express Server ===
app.get('/', (req, res) => {
  res.send('🟢 Bot & Server laufen');
});

app.get('/pay', (req, res) => {
  const userId = req.query.userId;
  const amount = registeredUsers.get(userId);

  if (!userId || !amount) {
    return res.send('❌ Du musst dich zuerst mit !register registrieren.');
  }

  const create_payment_json = {
    intent: 'sale',
    payer: { payment_method: 'paypal' },
    redirect_urls: {
      return_url: `${BASE_URL}/success?userId=${userId}`,
      cancel_url: `${BASE_URL}/cancel`
    },
    transactions: [{
      amount: { currency: 'EUR', total: amount },
      description: 'Discord Rolle kaufen'
    }]
  };

  paypal.payment.create(create_payment_json, (error, payment) => {
    if (error) {
      console.error(error);
      return res.send('❌ Fehler beim Erstellen der Zahlung.');
    }

    const approvalUrl = payment.links.find(link => link.rel === 'approval_url');
    if (approvalUrl) return res.redirect(approvalUrl.href);
    return res.send('❌ Keine Weiterleitung möglich.');
  });
});
;
