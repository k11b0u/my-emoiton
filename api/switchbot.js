// /api/switchbot.js
export const config = { runtime: "edge" };

/**
 * 必須 環境変数:
 * - SWITCHBOT_TOKEN         : SwitchBotの長いトークン（"Bearer "は付けない）
 * - DEVICE_EMOTION_JSON     : {"tension":"E16...","relax":"E16...","depress":"D23..."} など（文字列のJSON）
 * 任意 環境変数:
 * - DEVICE_MAP_JSON         : {"hiro":"E16..."} など（participantId→deviceId のマップ／文字列のJSON）
 * - CORS_ORIGIN             : 例 "https://yourapp.vercel.app"（省略時 "*"）
 *
 * リクエスト(JSON):
 * { emotion?: "tension"|"relax"|"depress",
 *   deviceId?: string,
 *   participantId?: string,
 *   commandKey?: "press" | 他のSwitchBotコマンド,
 *   times?: number }  // デフォルト1。2にすると「2回押し（OFF相当）」などができる
 *
 * 優先順位: deviceId > emotion > participantId
 */

export default async (req) => {
  const ORIGIN = process.env.CORS_ORIGIN || "*";

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(ORIGIN) });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method Not Allowed" }, ORIGIN);
  }

  // env
  const token = process.env.SWITCHBOT_TOKEN;
  if (!token) return json(500, { ok: false, error: "server misconfig: no token" }, ORIGIN);

  const EMO_MAP = safeParse(process.env.DEVICE_EMOTION_JSON);
  const PID_MAP = safeParse(process.env.DEVICE_MAP_JSON);

  // body
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" }, ORIGIN);
  }

  const {
    deviceId: directId,
    emotion,             // "tension" | "relax" | "depress"
    participantId,       // 旧来のID→deviceId 変換にも対応
    commandKey = "press",
    times = 1,
  } = body || {};

  // 解決（優先度: deviceId > emotion > participantId）
  const fromEmotion = emotion ? EMO_MAP?.[emotion] : null;
  const fromPid     = participantId ? PID_MAP?.[participantId] : null;
  const deviceId    = directId || fromEmotion || fromPid;

  if (!deviceId) {
    return json(400, { ok: false, error: "device id not found", emotion, participantId }, ORIGIN);
  }

  // SwitchBot API 呼び出し
  const url = `https://api.switch-bot.com/v1.1/devices/${encodeURIComponent(deviceId)}/commands`;
  const results = [];

  for (let i = 0; i < Number(times); i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        // NOTE: ここは "Authorization": token（そのまま）。"Bearer " を付けないでOK
        "Authorization": token,
        "Content-Type": "application/json; charset=utf8",
      },
      body: JSON.stringify({
        command: commandKey,
        parameter: "default",
        commandType: "command",
      }),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    results.push({ status: r.status, body: data });

    // SwitchBot公式の成功は body.statusCode === 100
    if (!r.ok || data?.statusCode !== 100) {
      // 200で返しつつ ok:false にしておくとフロントで同一処理しやすい
      return json(200, { ok: false, error: "switchbot_error", tries: i + 1, results }, ORIGIN);
    }

    // ダブルプレスの間隔
    await wait(600);
  }

  return json(200, { ok: true, tries: Number(times), results }, ORIGIN);
};

/* ---------- helpers ---------- */
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
  };
}
function json(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}
function safeParse(s) {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
