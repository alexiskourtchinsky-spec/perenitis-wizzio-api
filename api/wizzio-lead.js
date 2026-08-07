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

    // ==== NOUVEAU : Push en parallèle vers le CRM Finomea ====
    // On ne bloque pas la réponse au client si Finomea échoue.
    (async () => {
      try {
        const finomeaApiKey = process.env.FINOMEA_API_KEY;
        const finomeaUrl = process.env.FINOMEA_IMPORT_URL;

        if (!finomeaApiKey || !finomeaUrl) {
          console.warn('Finomea: variables d\'environnement manquantes, envoi ignoré');
          return;
        }

        // DEBUG TEMPORAIRE - à retirer une fois le problème résolu
        console.log('Finomea DEBUG - longueur clé:', finomeaApiKey.length);
        console.log('Finomea DEBUG - premiers caractères:', finomeaApiKey.slice(0, 4));
        console.log('Finomea DEBUG - derniers caractères:', finomeaApiKey.slice(-4));
        console.log('Finomea DEBUG - url:', finomeaUrl);

        const finomeaPayload = [
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

        const finomeaRes = await fetch(finomeaUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': finomeaApiKey
          },
          body: JSON.stringify(finomeaPayload)
        });

        const finomeaText = await finomeaRes.text();
        console.log('Finomea status:', finomeaRes.status);
        console.log('Finomea raw body:', finomeaText);

        if (finomeaRes.status === 207) {
          console.warn('Finomea: succès partiel, voir errors dans la réponse');
        } else if (!finomeaRes.ok) {
          console.error('Finomea: échec de l\'import', finomeaRes.status, finomeaText);
        }
      } catch (finomeaErr) {
        console.error('Erreur réseau vers Finomea:', finomeaErr);
      }
