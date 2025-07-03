const express = require('express');
const paypal = require('paypal-rest-sdk');
const { Client, GatewayIntentBits } = require('discord.js');

// ✅ Umgebungsvariablen aus Render
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLE_ID = process.env.ROLE_ID;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL;

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
  const userId = message.author.id;
  const channel = message.channel;

  if (message.content.toLowerCase() !== '!register') return;

  // ✅ Wenn kein Kauf-Ticket: Nachricht löschen
  if (!channel.name.startsWith('kauf-ticket-')) {
    const reply = await message.reply('❌ Dieser Befehl darf nur in einem Kauf-Ticket verwendet werden.');
    setTimeout(() => {
      message.delete().catch(() => {});
      reply.delete().catch(() => {});
    }, 10000);
    return;
  }

  // ✅ Letzte Nachricht mit Preis suchen
  const messages = await channel.messages.fetch({ limit: 10 });
  const last = messages
    .filter(msg => msg.author.bot && /(\d+[.,]?\d*)€/.test(msg.content))
    .first();

  if (!last) {
    return message.reply('❌ Konnte keine Nachricht mit dem Preis finden.');
  }

  const match = last.content.match(/(\d+[.,]?\d*)€/);
  if (!match) {
    return message.reply('❌ Preis konnte nicht ausgelesen werden.');
  }

  const price = match[1].replace(',', '.');
  registeredUsers.set(userId, price);

  message.reply(`✅ Du bist registriert! Zahle hier: ${BASE_URL}/pay?userId=${userId}`);
});

client.login(DISCORD_TOKEN);

// === PayPal Konfiguration ===
paypal.configure({
  mode: 'live', // oder 'sandbox' für Tests
  client_id: PAYPAL_CLIENT_ID,
  client_secret: PAYPAL_CLIENT_SECRET
});

// === Express Webserver ===
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

  if (!userId || !amount || !payerId || !paymentId) {
    return res.send('❌ Ungültiger Zahlungsversuch.');
  }

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
      res.send('✅ Zahlung erfolgreich, aber Fehler beim Rollen vergeben.');
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
