// /api/switchbot.js
export const config = { runtime: "edge" };

// CORSヘッダ
function cors(origin) {
  const o = origin || "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// JSONレスポンスヘルパ
function json(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors(origin),
    },
  });
}

// SwitchBot用署名作成（v1.1）
async function buildHeadersV11(token, secret) {
  const t = Date.now();
  const nonce = crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(token + t + nonce);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, data);
  const bytes = new Uint8Array(sigBuf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const sign = btoa(bin).toUpperCase();

  return {
    Authorization: token,
    sign,
    t: String(t),
    nonce,
    "Content-Type": "application/json",
  };
}

export default async function handler(req) {
  const ORIGIN = process.env.CORS_ORIGIN || "*";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(ORIGIN) });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, ORIGIN);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" }, ORIGIN);
  }

  let { emotion, deviceId, times } = body || {};
  times = Number(times) || 1;
  emotion = emotion || "";

  const token = (process.env.SWITCHBOT_TOKEN || "").trim();
  if (!token) {
    return json(500, { ok: false, error: "missing_switchbot_token" }, ORIGIN);
  }

  // DEVICE_MAP_JSON / DEVICE_EMOTION_JSON のどちらでもOK
  const rawMap =
    process.env.DEVICE_MAP_JSON ||
    process.env.DEVICE_EMOTION_JSON ||
    "{}";

  let map = {};
  try {
    map = JSON.parse(rawMap);
  } catch {
    map = {};
  }

  const known_keys = Object.keys(map);

  // emotion から map を引く（大文字小文字ゆるく）
  let resolvedId = deviceId || null;
  if (!resolvedId && emotion) {
    const target = String(emotion).toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (String(k).toLowerCase() === target) {
        resolvedId = v;
        break;
      }
    }
  }

  if (!resolvedId) {
    return json(
      400,
      {
        ok: false,
        error: "device_id_not_found",
        emotion,
        deviceId,
        known_keys,
      },
      ORIGIN
    );
  }

  // v1.1 or v1.0 を選択
  const secret =
    (process.env.SWITCHBOT_SECRET || process.env.SWITCHBOT_CLIENT_SECRET || "").trim();

  let urlBase = "https://api.switch-bot.com";
  let apiPath;
  let headers;

  if (secret) {
    // v1.1（署名付き）
    apiPath = `/v1.1/devices/${encodeURIComponent(resolvedId)}/commands`;
    headers = await buildHeadersV11(token, secret);
  } else {
    // v1.0（トークンのみ）
    apiPath = `/v1.0/devices/${encodeURIComponent(resolvedId)}/commands`;
    headers = {
      Authorization: token,
      "Content-Type": "application/json",
    };
  }

  const url = urlBase + apiPath;

  const commandBody = {
    command: "press",
    parameter: "default",
    commandType: "command",
  };

  let lastResponse = null;

  try {
    for (let i = 0; i < times; i++) {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(commandBody),
      });

      const text = await r.text();
      let jsonBody;
      try {
        jsonBody = JSON.parse(text);
      } catch {
        jsonBody = { raw: text };
      }

      lastResponse = {
        status: r.status,
        body: jsonBody,
      };

      // 2回押しのときにちょっと間を空ける
      if (i < times - 1) {
        await new Promise((res) => setTimeout(res, 800));
      }
    }

    return json(
      200,
      {
        ok: true,
        emotion,
        deviceId: resolvedId,
        times,
        known_keys,
        last: lastResponse,
      },
      ORIGIN
    );
  } catch (e) {
    return json(
      500,
      {
        ok: false,
        error: "switchbot_request_failed",
        message: String(e),
        emotion,
        deviceId: resolvedId,
        known_keys,
      },
      ORIGIN
    );
  }
}
