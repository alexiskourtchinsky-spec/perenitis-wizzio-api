// api/wizzio-lead.js
const crypto = require('crypto');

module.exports = async (req, res) => {
  // CORS large pour ton site Webflow
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

    // 1) Construction du payload Wizio avec SEULEMENT les champs souhaités
    const complementsInfo = lead.complementsInfo || '';
    const wizzioLead = {
      civilite: 0, // M. par défaut
      nom: lead.nom || '',
      prenom: lead.prenom || '',
      telephone1: lead.telephone1 || '',
      email: lead.email || '',
      revenus: Number(lead.revenus) || 0,
      impots: Number(lead.impots) || 0,
      domaine: 500, // défiscalisation
      // On envoie les deux variantes à cause de leur doc incohérente
      complementsInfo,
      complementsInfos: complementsInfo
    };

    console.log('Lead envoyé à Wizzio :', JSON.stringify(wizzioLead));

    // ==== NOUVEAU : Push en parallèle vers le CRM Kyia ====
    // On ne bloque pas la réponse au client si Kyia échoue.
    (async () => {
      try {
        const kyiaApiKey = process.env.CRM_API_KEY;
        const kyiaUrl = process.env.CRM_IMPORT_URL;

        if (!kyiaApiKey || !kyiaUrl) {
          console.warn('Kyia: variables d\'environnement manquantes, envoi ignoré');
          return;
        }

        const kyiaPayload = [
          {
            first_name: lead.prenom || '',
            last_name: lead.nom || '',
            email: lead.email || undefined,
            phone: lead.telephone1 || undefined,
            status: 'lead',
            type: 'per',
            notes: complementsInfo || undefined,
            consent_sms: true,
            consent_email: true
          }
        ];

        const kyiaRes = await fetch(kyiaUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': kyiaApiKey
          },
          body: JSON.stringify(kyiaPayload)
        });

        const kyiaText = await kyiaRes.text();
        console.log('Kyia status:', kyiaRes.status);
        console.log('Kyia raw body:', kyiaText);

        if (kyiaRes.status === 207) {
          console.warn('Kyia: succès partiel, voir errors dans la réponse');
        } else if (!kyiaRes.ok) {
          console.error('Kyia: échec de l\'import', kyiaRes.status, kyiaText);
        }
      } catch (kyiaErr) {
        console.error('Erreur réseau vers Kyia:', kyiaErr);
      }
    })();
    // ==== FIN NOUVEAU ====

    // 2) Datetime au format "Y-m-d H:i:s.u" (YYYY-MM-DD HH:MM:SS.MICROS)
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

    // 3) Signature HMAC SHA1 comme dans leur EXEMPLE PHP
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();
    const signatureHex = crypto
      .createHmac('sha1', secretBytes)
      .update(messageBytes)
      .digest('hex'); // ⇐ hexadécimal, comme hash_hmac en PHP

    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signatureHex, 'utf8').toString('base64');

    // 4) Appel à l'API Wizio
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
    } catch {
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
