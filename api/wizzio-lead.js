// api/wizzio-lead.js

const crypto = require('crypto');

module.exports = async (req, res) => {
  // -------- CORS (autoriser l'appel depuis ton site Webflow) ----------
  res.setHeader('Access-Control-Allow-Origin', 'https://www.perenitis.fr'); // ou "*" en test
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // -------------------------------------------------------------------
  if (req.method !== 'POST') {
    return res.status(405).json({ state: 9, message: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.WIZZIO_API_KEY;
    const apiSecret = process.env.WIZZIO_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res
        .status(500)
        .json({ state: 9, message: 'Missing Wizzio API credentials' });
    }

    const lead = req.body;

    // Date au format proche du "Y-m-d H:i:s" attendu
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const datetime =
      now.getFullYear() +
      '-' +
      pad(now.getMonth() + 1) +
      '-' +
      pad(now.getDate()) +
      ' ' +
      pad(now.getHours()) +
      ':' +
      pad(now.getMinutes()) +
      ':' +
      pad(now.getSeconds());

    // Signature HMAC comme dans la doc Wizzio
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();
    const hmac = crypto.createHmac('sha1', secretBytes);
    hmac.update(messageBytes);
    const signature = hmac.digest();
    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signature).toString('base64');

    // Appel à l’API Wizzio PushLead
    const wizzioRes = await fetch('https://api.wizio.fr/v1/PushLead/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        'DateTime': datetime,
        'Authorization': authorization
      },
      body: JSON.stringify(lead)
    });

    const data = await wizzioRes.json().catch(() => null);

    if (!wizzioRes.ok || !data) {
      return res
        .status(500)
        .json({ state: 9, message: 'Importation Lead Error', raw: data });
    }

    // On renvoie tel quel la réponse Wizzio au front
    return res.status(200).json(data);
  } catch (err) {
    console.error('Erreur serveur wizzio-lead:', err);
    return res
      .status(500)
      .json({ state: 9, message: 'Server error', error: String(err) });
  }
};
