// 測試用：模擬 Firebase Realtime Database 的 REST 介面（給 tools/e2e-sync.mjs 用）
// 模擬 Firebase Realtime Database 的 REST 介面：GET / PUT 一個 .json 路徑
import http from 'http';
const db = new Map();
http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){ res.writeHead(204); return res.end(); }
  const path = req.url.split('?')[0];
  if(req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'});
    // Firebase 對不存在的路徑回傳 null
    return res.end(JSON.stringify(db.has(path)? db.get(path) : null));
  }
  if(req.method==='PUT'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{ db.set(path, JSON.parse(body)); }catch(e){ res.writeHead(400); return res.end('bad json'); }
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(body);   // Firebase 回傳寫入的內容
    });
    return;
  }
  res.writeHead(405); res.end();
}).listen(8100, ()=>console.log('mock firebase on :8100'));
