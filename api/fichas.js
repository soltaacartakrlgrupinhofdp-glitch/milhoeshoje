import { timingSafeEqual } from 'node:crypto';
const url=process.env.UPSTASH_REDIS_REST_URL;
const token=process.env.UPSTASH_REDIS_REST_TOKEN;
const ALLOW_BASE='https://allow-gi0i.onrender.com';
const ALLOW_KEY='allow_apikey_ms1ng7i02bp';
const TTL=60*60*24*90;
const ID_RE=/^[-\w]{5,128}$/;

function authorized(req){
 const expected='593120';
 const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!expected||!supplied)return false;
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
async function redis(...args){
 const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(!r.ok)throw new Error('Falha no armazenamento');
 const j=await r.json();if(j.error)throw new Error('Falha no armazenamento');return j.result;
}
async function getFicha(id){
 const data=await redis('GET',`ficha:${id}`);
 if(!data)return null;
 try{return JSON.parse(data)}catch{return null}
}
async function saveFicha(item){
 await redis('SET',`ficha:${item.id}`,JSON.stringify(item),'EX',TTL);
}
// Confirma no gateway antes de marcar como paga (evita que alguém marque fichas falsamente)
async function pagoNoGateway(id,route){
 try{
  const r=await fetch(`${ALLOW_BASE}/api/v2/allowpay-seller/payment-status/${encodeURIComponent(id)}?route=${encodeURIComponent(route||'safepix')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:ALLOW_KEY})});
  if(!r.ok)return false;
  const j=await r.json();
  return ['paid','approved','completed','confirmed','success'].includes(String(j.status||'').toLowerCase());
 }catch{return false}
}

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!url||!token)return res.status(503).json({error:'Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN na Vercel'});
 try{
  if(req.method==='POST'){
   const x=req.body||{};
   // Atualização de status para "pago" enviada pelo site após confirmação do PIX
   if(x.action==='pago'){
    const id=String(x.transaction_id||'');
    if(!ID_RE.test(id))return res.status(400).json({error:'ID inválido'});
    const item=await getFicha(id);
    if(!item)return res.status(404).json({error:'Ficha não encontrada'});
    if(item.status==='pago')return res.status(200).json({ok:true});
    if(!(await pagoNoGateway(id,x.route)))return res.status(409).json({error:'Pagamento não confirmado'});
    item.status='pago';item.pago_em=new Date().toISOString();
    await saveFicha(item);
    return res.status(200).json({ok:true});
   }
   const cpf=String(x.cpf||'').replace(/\D/g,''),tel=String(x.telefone||'').replace(/\D/g,'');
   const qtd=Number(x.quantidade),valor=Number(x.valor),id=String(x.transaction_id||'');
   if(cpf.length!==11||tel.length<10||!Number.isInteger(qtd)||qtd<15||qtd>500||Math.abs(valor-qtd*.49)>.011||!ID_RE.test(id))return res.status(400).json({error:'Dados inválidos'});
   const item={id,cpf,nome:String(x.nome||'').slice(0,120),data_nascimento:String(x.data_nascimento||'').slice(0,30),telefone:tel,quantidade:qtd,valor,status:'pix_gerado',pego:false,criado_em:new Date().toISOString()};
   await saveFicha(item);
   await redis('ZADD','fichas:indices',Date.now(),id);
   return res.status(201).json({ok:true});
  }
  if(!authorized(req))return res.status(401).json({error:'Acesso não autorizado'});
  if(req.method==='GET'){
   const ids=await redis('ZREVRANGE','fichas:indices',0,499)||[];
   const rows=await Promise.all(ids.map(getFicha));
   return res.status(200).json({fichas:rows.filter(Boolean)});
  }
  if(req.method==='PATCH'){
   const x=req.body||{};
   const id=String(x.id||req.query.id||'');
   if(!ID_RE.test(id))return res.status(400).json({error:'ID inválido'});
   const item=await getFicha(id);
   if(!item)return res.status(404).json({error:'Ficha não encontrada'});
   if(typeof x.pego==='boolean'){item.pego=x.pego;item.pego_em=x.pego?new Date().toISOString():null;}
   await saveFicha(item);
   return res.status(200).json({ok:true,ficha:item});
  }
  if(req.method==='DELETE'){
   const id=String(req.query.id||'');if(!ID_RE.test(id))return res.status(400).json({error:'ID inválido'});
   await redis('DEL',`ficha:${id}`);await redis('ZREM','fichas:indices',id);
   return res.status(200).json({ok:true});
  }
  return res.status(405).json({error:'Método não permitido'});
 }catch(e){return res.status(500).json({error:'Erro ao processar ficha'});}
}
