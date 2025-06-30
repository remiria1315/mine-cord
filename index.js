const { Server, ServerEvent } = require('socket-be');
const { Client: DiscordClient, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { writeFileSync, existsSync, mkdirSync, readFileSync } = require('fs');
const { join } = require('path');
const { createCanvas, loadImage } = require('canvas');
const { send } = require('process');

async function getXUID(gamertag) {
  const res = await fetch(`https://api.geysermc.org/v1/xbox/xuid/${gamertag}`);
  const json = await res.json();
  if (!json.success) throw new Error('XUID取得失敗');
  return json.data.xuid.toString();
}

async function getTextureId(xuid) {
  const res = await fetch(`https://api.geysermc.org/v2/skin/${xuid}`);
  const json = await res.json();
  if (!json.texture_id) throw new Error('スキンデータがありません');
  return json.texture_id;
}

async function downloadSkinImage(textureId) {
  const url = `https://textures.minecraft.net/texture/${textureId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('スキン画像の取得に失敗');
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

async function generateIconFromSkin(imageBuffer, outputPath) {
  const skin = await loadImage(imageBuffer);

  const isHD = skin.width >= 128 && skin.height >= 128;
  const factor = isHD ? 2 : 1;

  const scale = 64;
  const canvas = createCanvas(10 * scale, 10 * scale);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    skin,
    8 * factor, 8 * factor, 8 * factor, 8 * factor,
    1 * scale, 1 * scale, 8 * scale, 8 * scale
  );

  ctx.drawImage(
    skin,
    40 * factor, 8 * factor, 8 * factor, 8 * factor,
    0.5 * scale, 0.5 * scale, 9 * scale, 9 * scale
  );

  const buffer = canvas.toBuffer('image/png');
  writeFileSync(outputPath, buffer);

  return canvas.toDataURL('image/png');
}


const DISCORD_WEBHOOK_URL = '君のwebhookのURL！';
const DISCORD_CHANNEL_ID = '連携するチャンネルのid！';
const DISCORD_BOT_TOKEN = 'botのtoken！';

const cacheDir = './cache';
if (!existsSync(cacheDir)) mkdirSync(cacheDir);

async function getSkinBase64(gamertag) {
  const cachePath = join(cacheDir, `${gamertag}.png`);
  if (existsSync(cachePath)) {
    const buf = readFileSync(cachePath);
    return 'data:image/png;base64,' + buf.toString('base64');
  }
  const xuid = await getXUID(gamertag);
  const textureId = await getTextureId(xuid);
  const skinBuf = await downloadSkinImage(textureId);
  await generateIconFromSkin(skinBuf, cachePath);
  const buf = readFileSync(cachePath);
  return 'data:image/png;base64,' + buf.toString('base64');
}

(async () => {
  const options = {
    port: MCBE_PORT,
    debug: true,
    commandVersion: "1.19.70",
  };
  const mcbeClient = new Server(options);

  mcbeClient.on(ServerEvent.PlayerChat, async event => {
    const username = event.sender.name;
    const message = event.message;
    if (message === "!status") {
      const ping = event.world.averagePing
      const players = event.world.players
      const host = (await event.world.getLocalPlayer()).name
      event.sender.sendMessage(`[§l§2mine§s-§9cord§r] status: \n  ping: ${ping}, \n  host: ${host}, \n  worldname: ${event.world.name}, \n  current_players: ${players.size} / ${event.world.maxPlayers}`)
    }
    console.log("<"+username+"> "+message)
    const base64 = await getSkinBase64(username).catch(() => null);
    if (!base64) {
      await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, content: message }),
      });
      return;
    }
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: username, avatar: base64 }),
    });

    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  });
  
async function sendmessage(name, content) {
await fetch(DISCORD_WEBHOOK_URL, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: name, avatar: "" }),
});

await fetch(DISCORD_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: content }),
});
}
mcbeClient.on(ServerEvent.PlayerJoin, async (event) => {
  sendmessage("sys", `join: ${event.player.name} | ${event.world.players.size} / ${event.world.maxPlayers}`)
});

mcbeClient.on(ServerEvent.PlayerLeave, async (event) => {
  sendmessage("sys", `leave: ${event.player.name} | ${event.world.players.size} / ${event.world.maxPlayers}`)
});
mcbeClient.on(ServerEvent.WorldAdd, ev => {
  ev.world.sendMessage(`[§l§2mine§s-§9cord§r]\n  connected`)

})
  
  const discordBot = new DiscordClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  discordBot.on('ready', () => {
    console.log(`Discordログイン成功: ${discordBot.user.tag}`);
  });

  discordBot.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.id !== DISCORD_CHANNEL_ID) return;
    const name = message.member?.nickname || message.author.username;
    let formattedMessage = ``;
    if (message.content.startsWith("/")) {
        formattedMessage = `<[§6Discord§r] ${name}> §o§7${message.content}`;
        let i = 0
        let rep = await message.reply("実行中...")
        let interval = setInterval(() => {
          i++;
          rep.edit("実行中"+".".repeat(i+1))
          if (i >=4) {
            i = 0
          }
        }, 1e3);
        let res = ``
        let embed = null
        try {
          res = await mcbeClient.broadcastCommand(message.content.slice(1))
          res = JSON.stringify(res, null, 2);
          embed = new EmbedBuilder()
          .setTitle(`結果:`)
          .setDescription(`\`\`\`json\n${res}\n\`\`\``)
          .setFooter({ text: "by " + name })
        } catch (error) {
          embed = new EmbedBuilder()
          .setTitle(`結果: `)
          .setDescription(`失敗: \n\`\`\`${error}\`\`\``)
          .setFooter({ text: "by " + name })
        } finally {
          clearInterval(interval)
        }
        await rep.edit({ content: "", embeds: [embed] })
    } else if (message.attachments.size > 0) {
        console.log(message.attachments)
        let files = ``
        message.attachments.forEach(value => {
          files+="\n    "+value.name
        })
        formattedMessage = `<[§9Discord§r] ${name}> ${message.content} \n  [§7files§r] ${files}`;
    } else {
      formattedMessage = `<[§9Discord§r] ${name}> ${message.content}`;
    }

    mcbeClient.broadcastMessage(formattedMessage);
  });

  await discordBot.login(DISCORD_BOT_TOKEN);

  const readline = require('readline');
  const { stdin: input, stdout: output } = require('process');
  const rl = readline.createInterface({ input, output });
  
  const readlineEmitKeypressEvents = require('readline').emitKeypressEvents;
  readlineEmitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  
  let isMultiLineMode = false;
  let multiLineBuffer = [];
  
  rl.on('line', (line) => {
    if (isMultiLineMode) {
      if (line === '.') {
        const fullMessage = multiLineBuffer.join('\n');
        try {
          mcbeClient.broadcastMessage(fullMessage);
        } catch (e) {
          console.error('EvalError:', e);
        }
        isMultiLineMode = false;
        multiLineBuffer = [];
        console.log('[multi] Message sent.');
      } else if (line === '/cancel') {
        isMultiLineMode = false;
        multiLineBuffer = [];
        console.log('[multi] Canceled.');
      } else {
        multiLineBuffer.push(line);
      }
      return;
    }
  
    if (line.startsWith('/')) {
      mcbeClient.broadcastCommand(line.replaceAll("\\n", "\n"))
        .then(console.log)
        .catch(err => console.error("CommandError:", err));
    } else {
      try {
        mcbeClient.broadcastMessage(line.replaceAll("\\n", "\n"));
      } catch (e) {
        console.error('EvalError:', e);
      }
    }
  });
})();
 
