const express = require('express');
const paypal = require('paypal-rest-sdk');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

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

// === Discord-Login ===
client.once('ready', () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() !== '!register') return;

  const userId = message.author.id;
  const channel = message.channel;

  const isKaufTicket = channel.name.startsWith('kauf-ticket-');

  const messages = await channel.messages.fetch({ limit: 10 });
  const last = messages.find(msg => msg.author.bot && /(\d+[.,]?\d*)€/.test(msg.content));

  if (!last) {
    const reply = await message.reply('❌ Konnte keine Nachricht mit dem Preis finden.');
    if (!isKaufTicket) {
      setTimeout(() => {
        reply.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 10_000);
    }
    return;
  }

  const match = last.content.match(/(\d+[.,]?\d*)€/);
  if (!match) {
    const reply = await message.reply('❌ Preis konnte nicht ausgelesen werden.');
    if (!isKaufTicket) {
      setTimeout(() => {
        reply.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 10_000);
    }
    return;
  }

  const price = match[1].replace(',', '.');
  registeredUsers.set(userId, price);

  const reply = await message.reply(`✅ Du bist registriert! Zahle hier: ${process.env.BASE_URL}/pay?userId=${userId}`);
  if (!isKaufTicket) {
    setTimeout(() => {
      reply.delete().catch(() => {});
      message.delete().catch(() => {});
    }, 10_000);
  }
});

client.login(process.env.DISCORD_TOKEN);

// === PayPal Konfiguration ===
paypal.configure({
  mode: 'live',
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET
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
      return_url: `${process.env.BASE_URL}/success?userId=${userId}`,
      cancel_url: `${process.env.BASE_URL}/cancel`
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
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(userId);
      await member.roles.add(process.env.ROLE_ID);
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
