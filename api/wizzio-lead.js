// api/wizzio-lead.js

const crypto = require('crypto');

module.exports = async (req, res) => {
  // -------- CORS pour Webflow ----------
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

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

    // ---- Vérification des champs obligatoires côté Wizzio ----
    const missing = [];
    if (!lead.nom) missing.push('nom');
    if (!lead.email) missing.push('email');
    if (!lead.telephone1) missing.push('telephone1');

    if (missing.length > 0) {
      return res.status(200).json({
        state: 9,
        message: 'Missing required lead fields: ' + missing.join(', ')
      });
    }

    // On nettoie le téléphone pour garder seulement les chiffres
    const phoneDigits = String(lead.telephone1).replace(/\D/g, '');

    // ---- Lead MINIMAL selon ta sélection de la doc ----
    const wizzioLead = {
      nom: String(lead.nom || ''),
      prenom: String(lead.prenom || ''),
      email: String(lead.email || ''),
      telephone1: Number(phoneDigits),         // Int
      revenus: lead.revenus != null ? Number(lead.revenus) : null, // Float
      impots: lead.impots != null ? Number(lead.impots) : null,   // Float
      complementsInfo: String(lead.complementsInfo || '')
    };

    console.log('Lead envoyé à Wizzio :', JSON.stringify(wizzioLead));

    // ---- 2) Date au format "Y-m-d H:i:s.u" ----
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

    // ---- 3) Signature HMAC SHA1 ----
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();

    const hmac = crypto.createHmac('sha1', secretBytes);
    hmac.update(messageBytes);
    const signature = hmac.digest();
    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signature).toString('base64');

    // ---- 4) Appel à l’API Wizzio ----
    const wizzioRes = await fetch('https://api.wizio.fr/v1/PushLead/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        DateTime: datetime,
        Authorization: authorization
      },
      body: JSON.stringify(wizzioLead)
    });

    const text = await wizzioRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }

    console.log('Wizzio status:', wizzioRes.status);
    console.log('Wizzio raw body:', text);

    if (!wizzioRes.ok || !data) {
      return res.status(200).json({
        state: 9,
        message: 'Importation Lead Error',
        status: wizzioRes.status,
        raw: text
      });
    }

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
