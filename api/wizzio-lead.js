// api/wizzio-lead.js

const crypto = require('crypto');

module.exports = async (req, res) => {
  // -------- CORS : on ouvre largement en test ----------
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // On ne veut que du POST ici
  if (req.method !== 'POST') {
    return res.status(405).json({ state: 9, message: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.WIZZIO_API_KEY;
    const apiSecret = process.env.WIZZIO_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res
        .status(200)
        .json({ state: 9, message: 'Missing Wizzio API credentials' });
    }

    const lead = req.body || {};

    // -------- Date au format "Y-m-d H:i:s.u" (comme dans la doc PHP)  ----------
    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const pad6 = n => String(n).padStart(6, '0'); // microsecondes

    const datetime =
      now.getFullYear() +
      '-' +
      pad2(now.getMonth() + 1) +
      '-' +
      pad2(now.getDate()) +
      ' ' +
      pad2(now.getHours()) +
      ':' +
      pad2(now.getMinutes()) +
      ':' +
      pad2(now.getSeconds()) +
      '.' +
      pad6(now.getMilliseconds() * 1000); // ms -> µs

    // -------- Signature HMAC SHA1 comme dans la doc ----------
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();

    const hmac = crypto.createHmac('sha1', secretBytes);
    hmac.update(messageBytes);
    const signature = hmac.digest();
    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signature).toString('base64');

    // -------- Appel Wizzio PushLead ----------
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

    const text = await wizzioRes.text(); // on lit le texte une seule fois
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }

    // Logs pour debug (tu les verras dans Vercel > Logs)
    console.log('Wizzio status:', wizzioRes.status);
    console.log('Wizzio raw body:', text);

    // Si Wizzio renvoie un code HTTP d’erreur ou du JSON non valide :
    if (!wizzioRes.ok || !data) {
      return res.status(200).json({
        state: 9,
        message: 'Importation Lead Error',
        status: wizzioRes.status,
        raw: text
      });
    }

    // OK : on renvoie tel quel la réponse Wizzio
    return res.status(200).json(data);
  } catch (err) {
    console.error('Erreur serveur wizzio-lead:', err);
    return res.status(200).json({
      state: 9,
      message: 'Server error',
      error: String(err)
    });
  }
};
