const API_BASE = 'https://allow-gi0i.onrender.com';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Método não permitido' });
  const apiKey = process.env.ALLOWPAY_API_KEY;
  if (!apiKey) return res.status(503).json({ success: false, error: 'ALLOWPAY_API_KEY não configurada.' });
  const { transaction_id: txid, route } = req.body || {};
  if (typeof txid !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(txid) || typeof route !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(route)) {
    return res.status(400).json({ success: false, error: 'É necessário enviar txid e route originais da cobrança.' });
  }
  try {
    const response = await fetch(`${API_BASE}/api/v2/allowpay-seller/payment-status/${encodeURIComponent(txid)}?route=${encodeURIComponent(route)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      console.error('AllowPay status failure', { httpStatus: response.status, hasError: !!data.error });
      return res.status(response.ok ? 502 : response.status).json({ success: false, error: 'Não foi possível consultar o status na AllowPay.' });
    }
    const statuses = { approved: 'paid', waiting_payment: 'pending', expired: 'expired', declined: 'failed', canceled: 'canceled', refunded: 'refunded', chargeback: 'chargeback' };
    const rawStatus = String(data.status || '').toLowerCase();
    return res.status(200).json({ success: true, transaction_id: txid, route, status: statuses[rawStatus] || 'unknown', allowpay_status: rawStatus, source: data.source || null, last_check: new Date().toISOString() });
  } catch (error) {
    console.error('AllowPay status network failure', { name: error.name });
    return res.status(502).json({ success: false, error: 'Falha de comunicação ao consultar o PIX.' });
  }
}
