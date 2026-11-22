const BANK = { bank: '우체국', account: '70349602250336', holder: '윤석중' };
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...corsHeaders } });
const fail = (message, status=400) => json({ ok:false, error:message }, status);
const uid = () => crypto.randomUUID();
const clean = (v, max=500) => String(v ?? '').trim().slice(0,max);
const phoneOK = v => /^01[016789]\d{7,8}$/.test(String(v).replace(/\D/g,''));
const validStatus = new Set(['pending_transfer','transfer_reported','payment_confirmed','preparing','shipped','completed','cancelled']);

async function sign(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function makeToken(secret) {
  const payload = btoa(JSON.stringify({ exp: Date.now()+8*60*60*1000, nonce: uid() }));
  return payload+'.'+await sign(payload,secret);
}
async function isAdmin(request, env) {
  if (!env.AUTH_SECRET) return false;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i,'');
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sig !== await sign(payload,env.AUTH_SECRET)) return false;
  try { return JSON.parse(atob(payload)).exp > Date.now(); } catch { return false; }
}
const requireAdmin = async (req,env) => await isAdmin(req,env);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null,{headers:corsHeaders});
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return fail('데이터베이스가 아직 연결되지 않았습니다.',503);

    if (path === '/api/health' && request.method === 'GET') return json({ok:true, service:'jumoney-ticket-api', bank:BANK});

    if (path === '/api/products' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id,name,brand,model,capacity,condition_label,description,image_url,price,stock FROM products WHERE active=1 AND stock>0 ORDER BY created_at DESC').all();
      return json({ok:true, products:rows.results || []});
    }

    if (path === '/api/orders' && request.method === 'POST') {
      let b; try { b=await request.json(); } catch { return fail('주문 정보 형식이 올바르지 않습니다.'); }
      const name=clean(b.name,80), phone=clean(b.phone,20).replace(/\D/g,''), address=clean(b.address,300), memo=clean(b.memo,500);
      const items=Array.isArray(b.items)?b.items.slice(0,20):[];
      if (!name || !phoneOK(phone) || !items.length || !address) return fail('이름, 연락처, 배송지, 상품을 확인해 주세요.');
      const normalized=[];
      for (const item of items) {
        const product=await env.DB.prepare('SELECT id,name,price,stock,active FROM products WHERE id=?').bind(clean(item.id,80)).first();
        const qty=Math.max(1,Math.min(5,Number.parseInt(item.quantity,10)||1));
        if (!product || !product.active || product.stock<qty) return fail('상품 재고가 부족하거나 판매 종료된 상품이 있습니다. 상품 목록을 새로고침해 주세요.',409);
        normalized.push({id:product.id,name:product.name,price:product.price,quantity:qty});
      }
      const total=normalized.reduce((s,x)=>s+x.price*x.quantity,0);
      if (!Number.isSafeInteger(total) || total<=0) return fail('주문 금액을 확인해 주세요.');
      const code='JM'+Date.now().toString().slice(-8)+Math.floor(Math.random()*90+10);
      const id=uid();
      // Conditional INSERT and stock update run in one atomic D1 batch. Stock is reserved at order creation.
      const statements=[];
      for (const item of normalized) {
        statements.push(env.DB.prepare(`UPDATE products SET stock=stock-? WHERE id=? AND active=1 AND stock>=?`).bind(item.quantity,item.id,item.quantity));
      }
      // If any stock update failed, the order is not inserted; rollback is not guaranteed across separate D1 batches,
      // so verify all stock reservations and compensate if a race is detected.
      const reserveResults=await env.DB.batch(statements);
      const allReserved=reserveResults.every(r => (r.meta?.changes ?? 0)===1);
      if (!allReserved) {
        for (let i=0;i<normalized.length;i++) if ((reserveResults[i]?.meta?.changes ?? 0)===1) await env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(normalized[i].quantity,normalized[i].id).run();
        return fail('동시에 주문이 접수되어 재고가 변경되었습니다. 다시 확인해 주세요.',409);
      }
      try {
        await env.DB.prepare('INSERT INTO orders(id,order_code,buyer_name,buyer_phone,buyer_address,buyer_memo,total_amount,status,items_json) VALUES(?,?,?,?,?,?,?,\'pending_transfer\',?)').bind(id,code,name,phone,address,memo,total,JSON.stringify(normalized)).run();
      } catch (e) {
        for (const item of normalized) await env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(item.quantity,item.id).run();
        throw e;
      }
      return json({ok:true, order:{code,total,status:'pending_transfer',bank:BANK,items:normalized}, message:'주문이 접수되었습니다. 계좌이체 후 입금자명을 등록해 주세요. 입금 확인 전에는 결제 완료가 아닙니다.'},201);
    }

    if (path.startsWith('/api/orders/') && path.endsWith('/report-transfer') && request.method==='POST') {
      const code=clean(path.split('/')[3],40); let b; try{b=await request.json()}catch{return fail('입금 정보가 올바르지 않습니다.');}
      const phone=clean(b.phone,20).replace(/\D/g,''), deposit=clean(b.depositName,80);
      if(!phoneOK(phone)||!deposit) return fail('주문 연락처와 입금자명을 입력해 주세요.');
      const r=await env.DB.prepare("UPDATE orders SET deposit_name=?,status='transfer_reported',updated_at=CURRENT_TIMESTAMP WHERE order_code=? AND buyer_phone=? AND status='pending_transfer'").bind(deposit,code,phone).run();
      if(!(r.meta?.changes)) return fail('주문을 찾지 못했거나 이미 입금 정보가 등록된 주문입니다.',404);
      return json({ok:true,message:'입금자명이 접수되었습니다. 실제 입금 확인 후 관리자가 주문을 승인합니다.'});
    }

    if (path.startsWith('/api/orders/lookup/') && request.method==='GET') {
      const code=clean(path.split('/').pop(),40), phone=clean(url.searchParams.get('phone'),20).replace(/\D/g,'');
      if(!phoneOK(phone)) return fail('연락처를 확인해 주세요.');
      const row=await env.DB.prepare('SELECT order_code,buyer_name,total_amount,status,items_json,created_at,updated_at FROM orders WHERE order_code=? AND buyer_phone=?').bind(code,phone).first();
      if(!row) return fail('주문 정보를 찾을 수 없습니다.',404);
      return json({ok:true,order:{...row,items:JSON.parse(row.items_json)}});
    }

    if (path === '/api/sales' && request.method==='POST') {
      let b;try{b=await request.json()}catch{return fail('신청 내용이 올바르지 않습니다.');}
      const brand=clean(b.brand,40),model=clean(b.model,100),capacity=clean(b.capacity,30),condition=clean(b.condition,100),phone=clean(b.phone,20).replace(/\D/g,''),ownership=clean(b.ownership,100),memo=clean(b.memo,1000);
      if(!brand||!model||!phoneOK(phone)||!ownership) return fail('필수 항목을 확인해 주세요.');
      const id=uid();
      await env.DB.prepare('INSERT INTO phone_sales(id,brand,model,capacity,condition_label,contact_phone,ownership,memo) VALUES(?,?,?,?,?,?,?,?)').bind(id,brand,model,capacity,condition,phone,ownership,memo).run();
      return json({ok:true,applicationId:id,message:'휴대폰 판매 신청이 접수되었습니다. 담당자가 확인 후 연락드립니다.'},201);
    }

    if (path === '/api/admin/login' && request.method==='POST') {
      if(!env.ADMIN_PASSWORD || !env.AUTH_SECRET) return fail('관리자 비밀번호와 인증 비밀키 설정이 필요합니다.',503);
      let b;try{b=await request.json()}catch{return fail('로그인 정보를 확인해 주세요.');}
      if(clean(b.password,200)!==env.ADMIN_PASSWORD) return fail('관리자 비밀번호가 올바르지 않습니다.',401);
      return json({ok:true,token:await makeToken(env.AUTH_SECRET)});
    }

    if (path.startsWith('/api/admin/')) {
      if(!(await requireAdmin(request,env))) return fail('관리자 인증이 필요합니다.',401);
      if(path==='/api/admin/products' && request.method==='GET') {
        const rows=await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC').all(); return json({ok:true,products:rows.results||[]});
      }
      if(path==='/api/admin/products' && request.method==='POST') {
        let b;try{b=await request.json()}catch{return fail('상품 정보가 올바르지 않습니다.');}
        const name=clean(b.name,120),price=Number(b.price),stock=Number(b.stock);
        if(!name||!Number.isSafeInteger(price)||price<0||!Number.isInteger(stock)||stock<0) return fail('상품명, 가격, 재고를 확인해 주세요.');
        const id=uid();
        await env.DB.prepare('INSERT INTO products(id,name,brand,model,capacity,condition_label,description,image_url,price,stock,active) VALUES(?,?,?,?,?,?,?,?,?,?,1)').bind(id,name,clean(b.brand,50),clean(b.model,100),clean(b.capacity,30),clean(b.condition,100),clean(b.description,1000),clean(b.imageUrl,1000),price,stock).run();
        return json({ok:true,id},201);
      }
      if(path.startsWith('/api/admin/products/') && request.method==='PUT') {
        const id=clean(path.split('/').pop(),80);let b;try{b=await request.json()}catch{return fail('상품 정보가 올바르지 않습니다.');}
        const price=Number(b.price),stock=Number(b.stock);if(!clean(b.name,120)||!Number.isSafeInteger(price)||price<0||!Number.isInteger(stock)||stock<0)return fail('상품명, 가격, 재고를 확인해 주세요.');
        const r=await env.DB.prepare('UPDATE products SET name=?,brand=?,model=?,capacity=?,condition_label=?,description=?,image_url=?,price=?,stock=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(clean(b.name,120),clean(b.brand,50),clean(b.model,100),clean(b.capacity,30),clean(b.condition,100),clean(b.description,1000),clean(b.imageUrl,1000),price,stock,b.active===false?0:1,id).run();
        return r.meta?.changes?json({ok:true}):fail('상품을 찾을 수 없습니다.',404);
      }
      if(path.startsWith('/api/admin/products/') && request.method==='DELETE') {
        const id=clean(path.split('/').pop(),80);const r=await env.DB.prepare('UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run();return r.meta?.changes?json({ok:true}):fail('상품을 찾을 수 없습니다.',404);
      }
      if(path==='/api/admin/orders' && request.method==='GET') {
        const rows=await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();return json({ok:true,orders:(rows.results||[]).map(x=>({...x,items:JSON.parse(x.items_json)}))});
      }
      if(path.startsWith('/api/admin/orders/') && request.method==='PUT') {
        const code=clean(path.split('/').pop(),40);let b;try{b=await request.json()}catch{return fail('주문 상태가 올바르지 않습니다.');}
        const status=clean(b.status,40);if(!validStatus.has(status))return fail('허용되지 않은 주문 상태입니다.');
        const order=await env.DB.prepare('SELECT status,items_json FROM orders WHERE order_code=?').bind(code).first();if(!order)return fail('주문을 찾을 수 없습니다.',404);
        if(order.status==='cancelled' && status!=='cancelled')return fail('취소된 주문은 상태를 되돌릴 수 없습니다.');
        const r=await env.DB.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE order_code=? AND status<>?').bind(status,code,status).run();
        if(status==='cancelled' && (r.meta?.changes||0)>0){
          const items=JSON.parse(order.items_json);
          for(const item of items) await env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(item.quantity,item.id).run();
        }
        return json({ok:true,changes:r.meta?.changes||0});
      }
      if(path==='/api/admin/sales' && request.method==='GET') {
        const rows=await env.DB.prepare('SELECT * FROM phone_sales ORDER BY created_at DESC LIMIT 200').all();return json({ok:true,sales:rows.results||[]});
      }
      if(path.startsWith('/api/admin/sales/') && request.method==='PUT') {
        const id=clean(path.split('/').pop(),80);let b;try{b=await request.json()}catch{return fail('신청 상태가 올바르지 않습니다.');}
        const status=clean(b.status,40);if(!['received','contacted','inspection','offer_sent','accepted','rejected','paid'].includes(status))return fail('허용되지 않은 신청 상태입니다.');
        const r=await env.DB.prepare('UPDATE phone_sales SET status=? WHERE id=?').bind(status,id).run();return r.meta?.changes?json({ok:true}):fail('신청을 찾을 수 없습니다.',404);
      }
      return fail('지원하지 않는 관리자 API입니다.',404);
    }
    return fail('API 경로를 찾을 수 없습니다.',404);
  }
};
