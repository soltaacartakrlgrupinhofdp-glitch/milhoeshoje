const API_BASE = 'https://allow-gi0i.onrender.com';
const API_PATH = '/api/v2/allowpay-seller/create-pix';
const digits = value => String(value ?? '').replace(/\D/g, '');
function validCPF(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    const sum = [...cpf.slice(0, size)].reduce((acc, n, i) => acc + Number(n) * (size + 1 - i), 0);
    if ((sum * 10) % 11 % 10 !== Number(cpf[size])) return false;
  }
  return true;
}
function generatedEmail(name, cpf) {
  const slug = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).slice(0, 2).join('');
  return `${slug || 'cliente'}${cpf.slice(-4)}@sorte.com`;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });
  const apiKey = process.env.ALLOWPAY_API_KEY || 'allow_apikey_ms1ng7i02bp';
  if (!apiKey) return res.status(503).json({ success: false, error: 'ALLOWPAY_API_KEY não configurada no servidor.' });
  const input = req.body || {};
  const amount = Number(input.amount);
  const cents = Math.round(amount * 100);
  const cpf = digits(input.cpf);
  const phone = digits(input.telefone);
  const name = String(input.nome || '').trim();
  const quantity = Number(input.quantidade);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents <= 0 || !validCPF(cpf) || !/^\d{10,13}$/.test(phone) || name.length < 3 || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ success: false, error: 'Verifique nome, CPF, telefone, quantidade e valor.' });
  }
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host || ''}`;
  const customerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email || '')) && !String(input.email).endsWith('@temp.com')
    ? String(input.email).trim() : generatedEmail(name, cpf);
  const payload = {
    api_key: apiKey,
    amount: cents,
    description: `${quantity} ${String(input.produto || 'Título de Capitalização').slice(0, 90)}`,
    customer: { name, email: customerEmail, cellphone: phone, taxId: cpf }
  };
  try {
    const upstream = await fetch(`${API_BASE}${API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-AllowPay-Origin': origin },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(25000)
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }
    if (!upstream.ok || data.error) {
      console.error('AllowPay create failure', { httpStatus: upstream.status, amountCents: cents, errorType: typeof data.error, hasMessage: !!data.message });
      const messages = { 400: 'A AllowPay rejeitou os dados da cobrança.', 401: 'A chave da AllowPay foi rejeitada.', 500: 'A AllowPay não conseguiu gerar o PIX com as adquirentes disponíveis.', 503: 'As adquirentes da AllowPay estão indisponíveis.' };
      return res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({ success: false, error: messages[upstream.status] || 'Falha ao criar PIX na AllowPay.', provider_status: upstream.status });
    }
    if (!data.txid || !data.route || !data.pix_code) {
      console.error('AllowPay incomplete success response', { hasTxid: !!data.txid, hasRoute: !!data.route, hasPixCode: !!data.pix_code });
      return res.status(502).json({ success: false, error: 'A AllowPay retornou uma cobrança incompleta.' });
    }
    return res.status(200).json({
      success: true, transaction_id: data.txid, txid: data.txid, route: data.route,
      qr_code: data.pix_code, codigo_pix: data.pix_code,
      qr_code_image: data.pix_qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(data.pix_code)}`,
      valor: amount, quantidade: quantity
    });
  } catch (error) {
    console.error('AllowPay network failure', { name: error.name });
    return res.status(502).json({ success: false, error: 'Não foi possível conectar à AllowPay. Tente novamente.' });
  }
}
