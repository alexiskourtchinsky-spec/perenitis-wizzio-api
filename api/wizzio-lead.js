// api/wizzio-lead.js
// Petite API Node pour pousser un lead dans Wizzio

const crypto = require('crypto');

module.exports = async (req, res) => {
  // CORS : on autorise tous les domaines pour simplifier
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ state: 9, message: 'Method not allowed' });
  }

  try {
    // Récupération du body JSON
    let body = req.body;
    if (!body || typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch (e) {
        body = {};
      }
    }

    const apiKey = process.env.WIZZIO_API_KEY;
    const apiSecret = process.env.WIZZIO_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res
        .status(500)
        .json({ state: 9, message: 'API credentials not configured' });
    }

    // Génération de l’auth Wizzio
    const datetime = new Date().toISOString().replace('Z', '');
    const messageBytes = (apiSecret + apiKey + datetime).toLowerCase();
    const secretBytes = apiSecret.toLowerCase();

    const signature = crypto
      .createHmac('sha1', secretBytes)
      .update(messageBytes)
      .digest('hex');

    const authorization =
      'WAP:' + apiKey + ':' + Buffer.from(signature).toString('base64');

    // Construction du lead exactement selon ta doc
    const lead = {
      civilite: body.civilite ?? 0,
      nom: body.nom || '',
      prenom: body.prenom || '',
      adresse: body.adresse || '',
      codePostal: body.codePostal || '',
      ville: body.ville || '',
      telephone1: body.telephone1 || '',
      telephone2: body.telephone2 || '',
      email: body.email || '',
      typeLogement: body.typeLogement ?? 0,
      situationFam: body.situationFam ?? 0,
      nbEnfants: body.nbEnfants ?? 0,
      anneeNaissance: body.anneeNaissance ?? null,
      revenus: body.revenus ?? 0,
      charges: body.charges ?? 0,
      impots: body.impots ?? 0,
      capital: body.capital ?? 0,
      epargne: body.epargne ?? 0,
      domaine: body.domaine ?? 500,
      complementsInfo: body.complementsInfo || '',
      credits: body.credits ?? 0,
      ndCredits: body.ndCredits ?? 0,
      creditMensualites: body.creditMensualites ?? 0,
      creditsConso: body.creditsConso ?? 0,
      nbCreditsConso: body.nbCreditsConso ?? 0,
      creditConsoMensualites: body.creditConsoMensualites ?? 0,
      creditBesoinTreso: body.creditBesoinTreso ?? 0,
      optin: body.optin ?? 1,
      dateRdv: body.dateRdv || null,
      heureRdv: body.heureRdv || null
    };

    // Appel Wizzio
    const response = await fetch('https://api.wizio.fr/v1/PushLead/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        'DateTime': datetime,
        'Authorization': authorization
      },
      body: JSON.stringify(lead)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.state !== 1) {
      console.error('Erreur Wizzio', data);
      return res
        .status(500)
        .json(data || { state: 9, message: 'Importation Lead Error' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ state: 9, message: 'Importation Lead Error', error: String(err) });
  }
};
