// /api/switchbot.js
export const config = { runtime: "edge" };

const ok = (data, origin) =>
  new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

const err = (status, message, extra, origin) =>
  new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

export default async (req) => {
  const ORIGIN = process.env.CORS_ORIGIN || "*";

  // CORS (preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(ORIGIN) });
  }
  if (req.method !== "POST") {
    return err(405, "Method Not Allowed", null, ORIGIN);
  }

  const token = process.env.SWITCHBOT_TOKEN;
  if (!token) return err(500, "server misconfig: no token", null, ORIGIN);

  const map = JSON.parse(process.env.DEVICE_MAP_JSON || "{}");

  let body;
  try {
    body = await req.json();
  } catch {
    return err(400, "invalid json", null, ORIGIN);
  }

  const {
    participantId,       // 参加者ID → DEVICE_MAP_JSON で解決
    deviceId: directId,  // 直接デバイスID指定もOK
    commandKey = "press",
    times = 1,           // 1回押し（ON相当） / 2回押し（OFF相当）
  } = body || {};

  const deviceId = directId || (participantId ? map[participantId] : null);
  if (!deviceId) return err(400, "device id not found", { participantId }, ORIGIN);

  const url = `https://api.switch-bot.com/v1.1/devices/${encodeURIComponent(
    deviceId
  )}/commands`;

  const results = [];
  for (let i = 0; i < Number(times); i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: token, // ← SwitchBotは "Bearer " なしでOK
        "Content-Type": "application/json; charset=utf8",
      },
      body: JSON.stringify({
        command: commandKey, // "press"
        parameter: "default",
        commandType: "command",
      }),
    });

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    results.push({ status: r.status, body: json });

    // 成功コードは statusCode === 100
    if (!r.ok || json?.statusCode !== 100) {
      return err(200, "switchbot_error", { tries: i + 1, results }, ORIGIN);
    }

    // 連打間隔（必要なら 1000ms に上げてもOK）
    await new Promise((res) => setTimeout(res, 600));
  }

  return ok({ tries: times, results }, ORIGIN);
};

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,authorization",
  };
}
