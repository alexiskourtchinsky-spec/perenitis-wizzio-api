// api/wizzio-lead.js

const crypto = require('crypto');

module.exports = async (req, res) => {
  // -------- CORS : on ouvre largement (test) ----------
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

    // 1) Lead Wizzio avec LES NOMS EXACTS de ta doc
    const wizzioLead = {
      civilite: Number(lead.civilite) || 0,
      nom: lead.nom || '',
      prenom: lead.prenom || '',
      adresse: lead.adresse || '',
      codePostal: lead.codePostal || '',
      ville: lead.ville || '',
      telephone1: lead.telephone1 || '',
      telephone2: lead.telephone2 || '',
      email: lead.email || '',
      typeLogement: Number(lead.typeLogement) || 0,
      situationFam: Number(lead.situationFam) || 0,
      nbEnfants: Number(lead.nbEnfants) || 0,
      anneeNaissance: lead.anneeNaissance ? Number(lead.anneeNaissance) : null,
      revenus: Number(lead.revenus) || 0,
      charges: Number(lead.charges) || 0,
      impots: Number(lead.impots) || 0,
      capital: Number(lead.capital) || 0,
      epargne: Number(lead.epargne) || 0,
      domaine: Number(lead.domaine) || 500,
      // ⚠️ doc = complementsInfo
      complementsInfo: lead.complementsInfo || '',
      credits: Number(lead.credits) || 0,
      // ⚠️ doc = ndCredits
      ndCredits: Number(lead.ndCredits) || 0,
      creditMensualites: Number(lead.creditMensualites) || 0,
      creditsConso: Number(lead.creditsConso) || 0,
      nbCreditsConso: Number(lead.nbCreditsConso) || 0,
      creditConsoMensualites: Number(lead.creditConsoMensualites) || 0,
      creditBesoinTreso: Number(lead.creditBesoinTreso) || 0,
      optin: Number(lead.optin) || 0,
      dateRdv: lead.dateRdv || null,
      heureRdv: lead.heureRdv || null
    };

    console.log('Lead envoyé à Wizzio :', JSON.stringify(wizzioLead));

    // 2) Date au format "Y-m-d H:i:s.u"
    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const pad6 = n => String(n).padStart(6, '0'); // microsecondes

    const datetime =
      now.getFullYear() +
      '-' + pad2(now.getMonth() + 1) +
      '-' + pad2(now.getDate()) +
      ' ' + pad2(now.getHours()) +
      ':' + pad2(now.getMinutes()) +
      ':' + pad2(now.getSeconds()) +
      '.' + pad6(now.getMilliseconds() * 1000); // ms -> µs

    // 3) Signature HMAC SHA1
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();

    const hmac = crypto.createHmac('sha1', secretBytes);
    hmac.update(messageBytes);
    const signature = hmac.digest();
    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signature).toString('base64');

    // 4) Appel à l’API Wizzio
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

    // Si tout va bien, Wizzio doit renvoyer un state = 1
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
