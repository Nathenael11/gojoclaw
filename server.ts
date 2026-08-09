import 'dotenv/config';
import { InMemoryRunner } from '@google/adk';
import { rootAgent } from './agent.js';
import { Telegraf } from 'telegraf';
import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';
import pkg from 'whatsapp-web.js';
const { Client: WAClient, LocalAuth } = pkg;
// @ts-ignore
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import http from 'http';

// ─── SESSION MANAGEMENT ─────────────────────────────────────

class SessionManager {
  private sessions: Map<string, any> = new Map();
  private filePath: string = './.sessions_store.json';

  constructor() {
    this.loadSessions();
  }

  loadSessions() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.sessions = new Map(Object.entries(parsed));
        console.log(`[Sessions] Loaded ${this.sessions.size} persistent sessions.`);
      }
    } catch (error) {
      console.error('[Sessions] Failed to load sessions:', error);
    }
  }

  saveSessions() {
    try {
      const obj = Object.fromEntries(this.sessions);
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
      console.log(`[Sessions] Saved ${this.sessions.size} sessions to disk.`);
    } catch (error) {
      console.error('[Sessions] Failed to save sessions:', error);
    }
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  setSession(sessionId: string, data: any) {
    this.sessions.set(sessionId, data);
    this.saveSessions();
  }
}

const sessionManager = new SessionManager();
const runner = new InMemoryRunner({ appName: 'gojoclaw', agent: rootAgent });

// Helper to split long messages to prevent API failures
function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.substring(i, i + maxLength));
  }
  return chunks;
}

// Main message processor
async function processMessage(userId: string, sessionId: string, text: string): Promise<string> {
  try {
    // 1. Maintain custom user history mapping
    let session = sessionManager.getSession(sessionId);
    if (!session) {
      session = { userId, messages: [], createdAt: new Date().toISOString() };
      sessionManager.setSession(sessionId, session);
    }

    console.log(`[Message] [${sessionId}] User (${userId}): ${text}`);

    // 2. Fix InMemoryRunner session not found issue
    let adkSession = await runner.sessionService.getSession({
      appName: runner.appName,
      userId,
      sessionId
    });
    if (!adkSession) {
      adkSession = await runner.sessionService.createSession({
        appName: runner.appName,
        userId,
        sessionId
      });
      console.log(`[Sessions] Initialized new ADK session: ${sessionId}`);
    }

    const message = { role: 'user', parts: [{ text }] };
    let responseText = '';

    // 3. Stream agent response
    const stream = runner.runAsync({
      userId,
      sessionId,
      newMessage: message
    });

    for await (const event of stream) {
      if (event.content?.parts?.[0]?.text) {
        responseText += event.content.parts[0].text;
      }
    }

    // 4. Handle empty responses with fallback to never send empty messages
    if (!responseText || responseText.trim() === '') {
      console.warn(`[Warning] Empty response received for session ${sessionId}. Sending fallback message.`);
      return "I'm having trouble processing your request right now. Please try again in a moment. 🙏";
    }

    // 5. Save message history
    session.messages.push({ role: 'user', content: text });
    session.messages.push({ role: 'assistant', content: responseText });
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }
    sessionManager.setSession(sessionId, session);

    console.log(`[Response] [${sessionId}] Sent response (${responseText.length} chars)`);
    return responseText;

  } catch (error: any) {
    console.error(`[Error] [${sessionId}] failed to process message:`, error.message);
    return `❌ I encountered an error: ${error.message || 'Unknown error'}. Please try again.`;
  }
}

console.log('\n🦞 GojoClaw Personal Assistant Gateway');
console.log('='.repeat(45));

// ─── TELEGRAM CHANNEL ───────────────────────────────────────

if (process.env.ENABLE_TELEGRAM === 'true') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token || token === 'your_telegram_bot_token_here') {
    console.error('[Telegram] Token is missing or invalid.');
  } else {
    try {
      const bot = new Telegraf(token);

      bot.start(async (ctx) => {
        try {
          const name = ctx.from.first_name || 'User';
          const sessionId = `telegram_${ctx.chat.id}`;
          
          sessionManager.setSession(sessionId, {
            userId: ctx.from.id.toString(),
            messages: [],
            createdAt: new Date().toISOString()
          });
          
          await ctx.reply(
            `🦞 Welcome to GojoClaw, ${name}!\n\n` +
            `I'm your personal AI assistant. I can help you with:\n` +
            `• Running commands\n` +
            `• Reading and writing files\n` +
            `• Browsing the web\n` +
            `• Reading your emails\n` +
            `• And much more!\n\n` +
            `Try saying: "Hello" or "List my files"`
          );
          console.log(`[Telegram] Started new session for user ${ctx.from.id}`);
        } catch (err: any) {
          console.error('[Telegram] Start handler error:', err.message);
        }
      });

      bot.on('text', async (ctx) => {
        try {
          const text = ctx.message.text;
          const userId = ctx.from.id.toString();
          const sessionId = `telegram_${ctx.chat.id}`;

          if (text.startsWith('/')) return;

          try {
            await ctx.sendChatAction('typing');
          } catch (e) {
            // Non-blocking typing state failures
          }

          const reply = await processMessage(userId, sessionId, text);

          // Split Telegram message if it exceeds the 4096 character limit
          const chunks = splitMessage(reply, 4000);
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } catch (error: any) {
          console.error('[Telegram] Error handling message:', error.message);
          try {
            await ctx.reply(`❌ Telegram Error: ${error.message || 'Unknown error'}`);
          } catch (replyErr) {
            console.error('[Telegram] Failed to reply with error:', replyErr);
          }
        }
      });

      bot.catch((err) => {
        console.error('[Telegram] Global bot error:', err);
      });

      bot.launch()
        .then(async () => {
          try {
            const botInfo = await bot.telegram.getMe();
            console.log(`[Telegram] Bot started as @${botInfo.username}`);
          } catch (e) {
            console.log('[Telegram] Bot started (verified username unavailable)');
          }
        })
        .catch((err) => {
          console.error('[Telegram] Launch failed:', err.message);
        });

      process.once('SIGINT', () => bot.stop('SIGINT'));
      process.once('SIGTERM', () => bot.stop('SIGTERM'));

    } catch (err: any) {
      console.error('[Telegram] Setup failed:', err.message);
    }
  }
}

// ─── DISCORD CHANNEL ────────────────────────────────────────

if (process.env.ENABLE_DISCORD === 'true') {
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token || token === 'your_discord_bot_token_here') {
    console.error('[Discord] Token is missing or invalid.');
  } else {
    try {
      const client = new DiscordClient({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages
        ]
      });

      client.once('ready', () => {
        console.log(`[Discord] Bot logged in as ${client.user?.tag}`);
      });

      client.on('messageCreate', async (message) => {
        try {
          if (message.author.bot) return;
          const isDM = !message.guild;
          const isMentioned = message.mentions.has(client.user!);

          if (isDM || isMentioned) {
            let text = message.content;
            if (isMentioned) {
              text = text.replace(new RegExp(`<@!?${client.user!.id}>`, 'g'), '').trim();
            }

            if (!text) return;

            const userId = message.author.id;
            const sessionId = `discord_${message.channel.id}`;

            try {
              await message.channel.sendTyping();
            } catch (e) {
              // Non-blocking typing state failures
            }

            const reply = await processMessage(userId, sessionId, text);

            // Split Discord message if it exceeds the 2000 character limit
            const chunks = splitMessage(reply, 2000);
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
          }
        } catch (error: any) {
          console.error('[Discord] Error handling message:', error.message);
        }
      });

      client.login(token).catch((err) => {
        console.error('[Discord] Login failed:', err.message);
      });
    } catch (err: any) {
      console.error('[Discord] Client setup failed:', err.message);
    }
  }
}

// ─── WHATSAPP CHANNEL ───────────────────────────────────────

if (process.env.ENABLE_WHATSAPP === 'true') {
  try {
    const client = new WAClient({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', (qr) => {
      console.log('\n📱 Scan this QR code with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      try {
        console.log(`[WhatsApp] Connected as ${client.info.pushname || 'unknown'} (${client.info.wid?.user || 'unknown'})`);
      } catch (e) {
        console.log('[WhatsApp] Connected successfully');
      }
    });

    client.on('message', async (msg) => {
      try {
        const chat = await msg.getChat();
        if (chat.isGroup) return;

        const userId = msg.from;
        const sessionId = `whatsapp_${msg.from}`;

        try {
          await chat.sendStateTyping();
        } catch (e) {
          // Non-blocking typing state failures
        }

        const reply = await processMessage(userId, sessionId, msg.body);
        
        try {
          await chat.clearState();
        } catch (e) {
          // Non-blocking typing state failures
        }

        const chunks = splitMessage(reply, 4000);
        for (const chunk of chunks) {
          await msg.reply(chunk);
        }
      } catch (error: any) {
        console.error('[WhatsApp] Error handling message:', error.message);
      }
    });

    client.initialize().catch((err) => {
      console.error('[WhatsApp] Initialization failed:', err.message);
    });
  } catch (err: any) {
    console.error('[WhatsApp] Client setup failed:', err.message);
  }
}

// ─── HEALTH CHECK HTTP SERVER ───────────────────────────────

const port = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      uptime: process.uptime(),
      channels: {
        telegram: process.env.ENABLE_TELEGRAM === 'true',
        discord: process.env.ENABLE_DISCORD === 'true',
        whatsapp: process.env.ENABLE_WHATSAPP === 'true'
      }
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(port, () => {
  console.log(`\n🚀 Health check server listening on port ${port}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  try {
    sessionManager.saveSessions();
  } catch (e) {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  try {
    sessionManager.saveSessions();
  } catch (e) {}
  process.exit(0);
});
