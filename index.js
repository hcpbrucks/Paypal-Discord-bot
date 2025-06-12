const express = require('express');
const paypal = require('paypal-rest-sdk');
const { Client, GatewayIntentBits } = require('discord.js');

const DISCORD_TOKEN = 'MTM4MTM3MDkyNDEwODA5MTUzMg.GohYFg.U9pl0rvkjbCTYYXT40hR1I6G2wsfDOnt_8a0Lg';
const GUILD_ID = '1381009607123796069';
const ROLE_ID = '1381289636952932352';
const PAYPAL_CLIENT_ID = 'AQYB9y5a6UIUUabcti0aRyydn90q-_IUJxKFNoqEaeZWt19wQir2zpEaABT21rD5XSYNyyniSaB2l9Pk';
const PAYPAL_CLIENT_SECRET = 'EB6wUs5ki6kJHVkWXNCihMvRR_kC-Jbvp3U0g6EsOQ12LYtjRH6oLJSJdPlb319tAeR_qb9VoEGt2CN-';
const BASE_URL = 'https://8c19823d-522d-415f-af34-28aaaac074e5-00-33ly12zdo5ip4.kirk.replit.dev';

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
    const userId = message.author.id;
    const channel = message.channel;

    // Letzte Nachricht vom BotGhost lesen
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
  mode: 'live', // Achtung: Jetzt LIVE-Modus!
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

app.get('/success', async (req, res) => {
  const { PayerID: payerId, paymentId, userId } = req.query;
  const amount = registeredUsers.get(userId);

  const execute_payment_json = {
    payer_id: payerId,
    transactions: [{
      amount: { currency: 'EUR', total: amount }
    }]
  };

  paypal.payment.execute(paymentId, execute_payment_json, async (error, payment) => {
    if (error) {
      console.error(error.response);
      return res.send('❌ Zahlung fehlgeschlagen.');
    }

    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(userId);
      await member.roles.add(ROLE_ID);
      res.send('✅ Zahlung erfolgreich! Deine Discord-Rolle wurde vergeben.');
    } catch (err) {
      console.error('❌ Fehler beim Rollen vergeben:', err);
      res.send('❌ Zahlung erfolgreich, aber Fehler beim Rollen vergeben.');
    }
  });
});

app.get('/cancel', (req, res) => {
  res.send('❌ Zahlung wurde abgebrochen.');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🌐 Server läuft auf Port ${PORT}`);
});
