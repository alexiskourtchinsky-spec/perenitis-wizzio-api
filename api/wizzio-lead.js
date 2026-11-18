// api/wizzio-lead.js
// Les leads partent uniquement vers Finomea (Wizzio retiré).
// Le nom du fichier et l'URL restent identiques pour ne pas casser les LP.

// =====================================================================
// FINOMEA : correspondances formulaires -> champs CRM
// =====================================================================

// Catégorie de produit selon l'objectif choisi (codes envoyés par les LP)
const PRODUCT_BY_GOAL = {
  retraite: 'per',
  impots: 'per',
  transfert: 'per',
  plafonds: 'per',
  immobilier: 'direct_real_estate',
  epargne: 'av'
};
// Catégorie par défaut selon la LP, si l'objectif ne suffit pas
const PRODUCT_BY_SOURCE = {
  lp_per: 'per',
  lp_av: 'av',
  comparateur: 'per',
  comparateur_gate: 'per'
};
const SOURCE_LABEL = {
  lp_per: 'LP Étude PER',
  lp_av: 'LP Assurance vie',
  lp_impots: 'LP Réduction d\'impôt',
  comparateur: 'Comparateur PER (demande produit)',
  comparateur_gate: 'Comparateur PER (accès aux offres)',
  simulateur: 'Simulateur projet',
  parrainage: 'Parrainage'
};

// Activité -> statut professionnel CRM
const ACTIVITY = {
  salarie: { professional_status: 'employee' },
  salarie_ou_fonctionnaire: { professional_status: 'employee' },
  cadre: { professional_status: 'employee', csp_code: 'csp_cadre' },
  fonctionnaire: { professional_status: 'civil_servant' },
  liberal: { professional_status: 'self_employed' },
  independant: { professional_status: 'self_employed' },
  chef_entreprise: { professional_status: 'self_employed', is_business_owner: true },
  entrepreneur: { professional_status: 'self_employed', is_business_owner: true },
  retraite: { professional_status: 'retired', csp_code: 'csp_retraite' },
  sans_activite: { professional_status: 'other', csp_code: 'csp_autre_sans_activite' },
  sans: { professional_status: 'other', csp_code: 'csp_autre_sans_activite' },
  demandeur_emploi: { professional_status: 'unemployed' },
  etudiant: { professional_status: 'student' }
};

function toNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[\s  €]/g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}
function eur(n) {
  return Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' €';
}

// ---------- Ancien format : tout est dans complementsInfo ----------
// Gère les 2 variantes en circulation :
//   "UTM: utm_source=google | utm_medium=cpc"  (LP impôts, LP PER, comparateur)
//   "... || UTM: {"utm_source":"google"}"       (simulateur)
function parseLegacy(complementsInfo) {
  const ci = String(complementsInfo || '');
  const utm = {};
  let goalLine = '';

  ci.split('\n').forEach(line => {
    if (line.startsWith('UTM:') && !line.includes('{')) {
      line.slice(4).split('|').forEach(part => {
        const i = part.indexOf('=');
        if (i > 0) utm[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      });
    } else if (line.startsWith('LP:')) {
      utm.landing_url = line.slice(3).trim();
    } else if (line.startsWith('Objectif:')) {
      goalLine = line.slice(9).trim();
    }
  });

  const json = ci.match(/UTM:\s*(\{[^}]*\})/);
  if (json) {
    try { Object.assign(utm, JSON.parse(json[1])); } catch (e) {}
  }

  if (utm.landing_url) {
    try {
      const url = new URL(utm.landing_url);
      ['gclid', 'gbraid', 'wbraid'].forEach(k => {
        if (!utm.gclid && url.searchParams.get(k)) utm.gclid = url.searchParams.get(k);
      });
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(k => {
        if (!utm[k] && url.searchParams.get(k)) utm[k] = url.searchParams.get(k);
      });
    } catch (e) {}
  }

  // Objectif -> code, à partir du libellé
  const projet = (ci.match(/Projet:\s*([^|\n]+)/) || [])[1] || '';
  const g = (goalLine + ' ' + projet).toLowerCase();
  let goal = '';
  if (/immobili|dans la pierre/.test(g)) goal = 'immobilier';
  else if (/retraite|per\b/.test(g)) goal = 'retraite';
  else if (/imp[oô]t/.test(g)) goal = 'impots';
  else if (/fructifier|[ée]pargn/.test(g)) goal = 'epargne';

  return { utm, goal };
}

// Origine CRM = clé API utilisée. Une ligne par canal payant.
// Si la variable d'environnement d'un canal n'existe pas encore dans Vercel,
// le lead part avec la clé du site (rien ne casse).
const CHANNELS = [
  {
    name: 'Google Ads',
    envKey: 'FINOMEA_KEY_GOOGLE_ADS',
    match: utm => !!utm.gclid || /^(google|google_ads|googleads|adwords)$/i.test((utm.utm_source || '').trim())
  },
  {
    name: 'Meta Ads',
    envKey: 'FINOMEA_KEY_META',
    // fbclid seul ne suffit pas : Facebook l'ajoute aussi sur les posts gratuits
    match: utm => /^(facebook|fb|instagram|ig|meta|facebook_ads|meta_ads)$/i.test((utm.utm_source || '').trim())
  }
];

// Canaux définis par la page elle-même (prioritaires sur les UTM)
const SOURCE_CHANNELS = {
  parrainage: { name: 'Parrainage', envKey: 'FINOMEA_KEY_PARRAINAGE' }
};

function detectChannel(utm, source) {
  return SOURCE_CHANNELS[source] || CHANNELS.find(c => c.match(utm)) || null;
}

// ---------- Construction de la ligne Finomea ----------
function buildFinomeaRow(lead, complementsInfo) {
  const crm = lead.crm && typeof lead.crm === 'object' ? lead.crm : null;
  const legacy = parseLegacy(complementsInfo);
  const utm = { ...legacy.utm, ...((crm && crm.utm) || {}) };
  const source = (crm && crm.source) || '';
  // Format structuré : on ne devine jamais l'objectif à partir du texte
  const goal = crm ? (crm.goal || '') : legacy.goal;

  const phoneRaw = String(lead.telephone1 || '').trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '');

  const row = {
    first_name: (lead.prenom || '').trim(),
    last_name: (lead.nom || '').trim(),
    email: lead.email || undefined,
    // Toujours en string (leur backend appelle .lstrip() dessus) ; "0" = vide côté LP
    // Le "+" est conservé (+33…, +262…), sinon Finomea ne reconnaît pas l'indicatif
    phone: phoneDigits.length >= 9 ? (phoneRaw.startsWith('+') ? '+' : '') + phoneDigits : undefined,
    campaign: utm.utm_campaign || undefined,
    product_category: PRODUCT_BY_GOAL[goal] || PRODUCT_BY_SOURCE[source] || undefined,
    consent_prospecting: !(crm && crm.consent === false)
  };

  const dealNotes = [];
  const clientNotes = [];

  if (crm) {
    // --- Nouveau format structuré ---
    const act = ACTIVITY[crm.activity];
    if (act) Object.assign(row, act);

    const income = toNum(crm.income_annual);
    const tax = toNum(crm.tax_paid);
    const monthly = toNum(crm.monthly_saving);
    if (monthly) row.monthly_savings_capacity = monthly;
    if (income) row.income_comments = `Revenu annuel déclaré : ${eur(income)}`;
    if (tax) row.tax_comments = `Impôt payé déclaré : ${eur(tax)}`;

    if (crm.age_range) clientNotes.push(`Âge : ${crm.age_range}`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(crm.birth_date || '')) row.birth_date = crm.birth_date;
    if (crm.birth_year) clientNotes.push(`Année de naissance : ${crm.birth_year}`);
    if (crm.marital) clientNotes.push(`Situation familiale : ${crm.marital}`);
    if (crm.children_count !== undefined && crm.children_count !== '') {
      clientNotes.push(`Enfants à charge : ${crm.children_count}`);
    }

    dealNotes.push(`Source : ${SOURCE_LABEL[source] || source || 'Site'}`);
    if (crm.goal_label) dealNotes.push(`Objectif : ${crm.goal_label}`);
    if (crm.product) dealNotes.push(`Produit demandé : ${crm.product}`);
    if (crm.amount_label) dealNotes.push(`Montant à placer : ${crm.amount_label}`);
    if (crm.activity_label) dealNotes.push(`Activité : ${crm.activity_label}`);
    if (income) dealNotes.push(`Revenu annuel déclaré : ${eur(income)}`);
    if (tax) dealNotes.push(`Impôt payé déclaré : ${eur(tax)}`);
    if (monthly) dealNotes.push(`Épargne mensuelle disponible : ${eur(monthly)}`);
    const initial = toNum(crm.initial_invest);
    if (initial) dealNotes.push(`Versement initial envisagé : ${eur(initial)}`);
    if (crm.horizon_years) dealNotes.push(`Horizon : ${crm.horizon_years} ans`);
    if (crm.credit_years) dealNotes.push(`Durée de crédit souhaitée : ${crm.credit_years} ans`);
    const down = toNum(crm.down_payment);
    if (down) dealNotes.push(`Apport : ${eur(down)}`);
    if (crm.simulation) dealNotes.push(`Simulation : ${crm.simulation}`);
    if (crm.sponsor && (crm.sponsor.firstname || crm.sponsor.lastname)) {
      const sp = crm.sponsor;
      const who = [sp.firstname, sp.lastname].filter(Boolean).join(' ');
      const contact = [sp.email, sp.phone].filter(Boolean).join(' · ');
      dealNotes.push(`Recommandé par : ${who}${contact ? ' (' + contact + ')' : ''}`);
      dealNotes.push('Offre parrainage : 100 € pour le parrain et le filleul après souscription');
      clientNotes.push(`Parrainé par ${who}${sp.email ? ' (' + sp.email + ')' : ''}`);
    }
  } else {
    // --- Ancien format : on garde le texte tel quel ---
    if (complementsInfo) dealNotes.push(complementsInfo);
    if (Number(lead.revenus)) dealNotes.push(`Revenus déclarés : ${eur(Number(lead.revenus))}`);
    if (Number(lead.impots)) dealNotes.push(`Impôt déclaré : ${eur(Number(lead.impots))}`);
  }

  // Attribution, toujours en fin de notes d'affaire
  if (crm) {
    const parts = ['partner', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid']
      .filter(k => utm[k]).map(k => `${k}=${utm[k]}`);
    if (parts.length) dealNotes.push(`UTM : ${parts.join(' | ')}`);
    if (utm.landing_url) dealNotes.push(`LP : ${utm.landing_url}`);
    if (utm.referrer) dealNotes.push(`Ref : ${utm.referrer}`);
  }

  if (dealNotes.length) row.deal_notes = dealNotes.join('\n');
  if (clientNotes.length) row.notes = clientNotes.join('\n');

  return { row, channel: detectChannel(utm, source) };
}

async function sendToFinomea(row, apiKey, url) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'Accept-Encoding': 'identity'
    },
    body: JSON.stringify([row])
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  console.log('Finomea status:', r.status, '| body:', text);
  const errors = (data && data.errors) || [];
  const ok = r.ok && data && errors.length === 0;
  return { ok, status: r.status, data, errors };
}

// Renvoie { state: 1 } si le lead est bien dans Finomea (format attendu par les LP)
async function pushToFinomea(lead, complementsInfo) {
  const finomeaUrl = process.env.FINOMEA_IMPORT_URL;
  const { row, channel } = buildFinomeaRow(lead, complementsInfo);

  const channelKey = channel && process.env[channel.envKey];
  const apiKey = channelKey || process.env.FINOMEA_API_KEY;
  const originName = channelKey ? channel.name : 'Site';
  if (channel && !channelKey) {
    console.warn(`Finomea: ${channel.envKey} absente dans Vercel, lead ${channel.name} envoyé avec la clé du site`);
  }

  if (!apiKey || !finomeaUrl) {
    console.error('Finomea: variables d\'environnement manquantes');
    return { state: 9, message: 'Configuration serveur incomplète' };
  }

  console.log(
    'Finomea origine:', originName,
    '| campaign:', row.campaign || '(vide)',
    '| format:', lead.crm ? 'structuré' : 'ancien'
  );
  console.log('Finomea payload:', JSON.stringify(row));

  let result = await sendToFinomea(row, apiKey, finomeaUrl);

  // Téléphone refusé par Finomea : on renvoie sans le champ phone (gardé en notes)
  // plutôt que de perdre le lead
  if (!result.ok && row.phone && /phone|t[ée]l[ée]phone/i.test(JSON.stringify(result.errors))) {
    console.warn('Finomea: téléphone refusé, nouvel essai sans le champ phone');
    const retryRow = { ...row, deal_notes: [row.deal_notes, `Téléphone saisi (refusé par le CRM) : ${row.phone}`].filter(Boolean).join('\n') };
    delete retryRow.phone;
    result = await sendToFinomea(retryRow, apiKey, finomeaUrl);
  }

  if (result.ok) {
    return { state: 1, message: 'OK', finomea: result.data };
  }
  console.error('Finomea: échec de l\'import', result.status, JSON.stringify(result.errors));
  return { state: 9, message: 'Importation Lead Error' };
}

// =====================================================================
// HANDLER
// =====================================================================
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
    const lead = req.body || {};
    const result = await pushToFinomea(lead, lead.complementsInfo || '');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Erreur serveur wizzio-lead:', err);
    return res.status(200).json({ state: 9, message: 'Server error' });
  }
};

module.exports.buildFinomeaRow = buildFinomeaRow;
