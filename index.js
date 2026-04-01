require('dotenv').config();
const Parser = require('rss-parser');
const fetch = require('node-fetch');
const cron = require('node-cron');
const { isAlreadySeen, markAsSeen } = require('./db');

const parser = new Parser();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const MY_ID = process.env.TELEGRAM_MY_ID;

const RSS_FEEDS = [
  // 구글 뉴스
  'https://news.google.com/rss/search?q=tornado+cash&hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/search?q=tornado+cash&hl=en&gl=US&ceid=US:en',
  // 코인 전문 미디어
  'https://cointelegraph.com/rss/tag/tornado-cash',
  'https://decrypt.co/feed',
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cryptonews.com/news/feed/',
  'https://bitcoinmagazine.com/.rss/full/',
  // 한국
  'https://tokenpost.kr/rss',
  'https://www.blockmedia.co.kr/feed',
  'https://coinreaders.com/feed',
];

function cleanThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function getSourceName(url) {
  if (url.includes('cointelegraph')) return 'CoinTelegraph';
  if (url.includes('decrypt')) return 'Decrypt';
  if (url.includes('coindesk')) return 'CoinDesk';
  if (url.includes('cryptonews')) return 'CryptoNews';
  if (url.includes('bitcoinmagazine')) return 'Bitcoin Magazine';
  if (url.includes('tokenpost')) return '토큰포스트';
  if (url.includes('blockmedia')) return '블록미디어';
  if (url.includes('coinreaders')) return '코인리더스';
  if (url.includes('google')) return 'Google News';
  return '알 수 없음';
}

async function summarize(title, content) {
  const prompt = `다음 뉴스를 한국어로 번역하고 3줄로 요약해줘. 반드시 한국어로만 답해. 불필요한 설명 없이 바로 결과만 줘.

제목: ${title}
내용: ${content || title}

형식:
[한국어 제목]
1. 
2. 
3. `;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:4b',
      prompt,
      stream: false
    })
  });

  const data = await response.json();
  return cleanThinking(data.response);
}

async function askConfirmation(item, summary, source) {
  const text = `🌪️ 새 뉴스\n\n뉴스 내용:\n${summary}\n\n출처 : ${source}\n🔗 ${item.link}`;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: MY_ID,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ 발송', callback_data: `send:${Buffer.from(item.link).toString('base64').slice(0, 50)}` },
          { text: '❌ 스킵', callback_data: `skip:${Buffer.from(item.link).toString('base64').slice(0, 50)}` }
        ]]
      }
    })
  });
}

async function sendToChannel(text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text
    })
  });
}

// 컨펌 버튼 처리 (offset 방식으로 중복 처리 방지)
let lastUpdateId = 0;

async function handleCallback() {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`
  );
  const data = await response.json();

  for (const update of data.result) {
    lastUpdateId = update.update_id;
    if (!update.callback_query) continue;

    const query = update.callback_query;
    const [action] = query.data.split(':');
    const msgText = query.message.text;

    if (action === 'send') {
      await sendToChannel(msgText.replace('🌪️ 새 뉴스', '🌪️ 토네이도 캐시 뉴스'));
    }

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: query.id,
        text: action === 'send' ? '✅ 발송 완료!' : '❌ 스킵'
      })
    });

    // 컨펌 메시지 삭제
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: MY_ID,
        message_id: query.message.message_id
      })
    });
  }
}

async function fetchNews() {
  console.log(`[${new Date().toLocaleString('ko-KR')}] 뉴스 수집 시작...`);

  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const source = getSourceName(feedUrl);

      for (const item of feed.items.slice(0, 5)) {
        if (isAlreadySeen(item.link)) continue;

        // tornado cash 관련 아닌 것 필터 (구글뉴스 외 피드)
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
        if (!feedUrl.includes('google') && !text.includes('tornado')) continue;

        console.log(`새 뉴스 [${source}]:`, item.title);
        const summary = await summarize(item.title, item.contentSnippet);
        await askConfirmation(item, summary, source);
        markAsSeen(item.link, item.title);

        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`피드 오류 [${feedUrl}]:`, err.message);
    }
  }

  console.log(`[${new Date().toLocaleString('ko-KR')}] 수집 완료`);
}

// 3시간마다 뉴스 수집
cron.schedule('0 */3 * * *', fetchNews);

// 5분마다 컨펌 버튼 체크
cron.schedule('*/5 * * * *', handleCallback);

console.log('🌪️ 토네이도 캐시 뉴스봇 시작!');
fetchNews();