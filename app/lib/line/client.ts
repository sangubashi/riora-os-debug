import * as https from 'https';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!CHANNEL_ACCESS_TOKEN) {
  throw new Error('Missing ENV: LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
}

export interface TextMessage {
  type: 'text';
  text: string;
}

function post(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.line.me',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`LINE API Error ${res.statusCode}: ${data}`));
          } else {
            resolve(JSON.parse(data || '{}'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** 特定ユーザーへプッシュ送信 */
export async function pushMessage(to: string, messages: TextMessage[]): Promise<void> {
  await post('/v2/bot/message/push', { to, messages });
}

/** 全フォロワーへブロードキャスト送信 */
export async function broadcastMessage(messages: TextMessage[]): Promise<void> {
  await post('/v2/bot/message/broadcast', { messages });
}

/** フォロワー数取得 */
export async function getFollowerCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/followers/count',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve((JSON.parse(data) as any).count ?? 0));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
