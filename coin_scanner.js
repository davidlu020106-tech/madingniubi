#!/usr/bin/env node
/* ============================================================
 * 牛逼马丁不死不休 — 震荡币筛选器 (Node.js + OKX API)
 * ============================================================
 * 调用 OKX 公开 API（无需密钥），5维评分找最适合马丁的震荡币
 * 用法: node coin_scanner.js
 * CI:   GitHub Actions 每天自动跑，输出漂亮的 markdown 报告
 * ============================================================ */

const SCAN_DAYS = 30, MIN_VOLUME = 500000, AMPL_MIN = 3, AMPL_MAX = 12;
const MAX_COIN_PRICE = 500, MARTIN_LEVERAGE = 5, MARTIN_LEVELS = 8;
const BLACKLIST = new Set(['BTC','ETH','BCH','LTC','LINK','UNI','DOT','XRP','ADA','AVAX','ATOM','FIL','ETC']);

const https = require('https');

// ─── OKX HTTP 请求 ───
function okxGet(path) {
  return new Promise(resolve => {
    let done = false;
    let timer = setTimeout(() => { if(!done){done=true;resolve(null);} }, 10000);
    let req = https.get('https://www.okx.com'+path, {headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}}, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{if(!done){done=true;clearTimeout(timer);try{resolve(JSON.parse(d))}catch{resolve(null)}}});
    });
    req.on('error',()=>{if(!done){done=true;clearTimeout(timer);resolve(null);}});
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 1. 振幅 ───
function amplitude(records) {
  let sumA = 0, sumC = 0, amps = [];
  for (let r of records) {
    let a = (r.high - r.low) / r.open * 100;
    let c = Math.abs((r.close - r.open) / r.open * 100);
    amps.push(a); sumA += a; sumC += c;
  }
  let avg = sumA / records.length, avgC = sumC / records.length;
  let v = amps.reduce((s,a) => s + (a-avg)**2, 0) / records.length;
  return { avgAmpl: avg, amplCV: Math.sqrt(v)/(avg||1), quality: avgC>0.01 ? avg/avgC : avg/0.01 };
}

// ─── 2. ADX ───
function adx(records, period=14) {
  let len = records.length, tr=[], pdm=[], mdm=[];
  if (len < period+1) return {adx:50,rising:false};
  for (let i=1; i<len; i++) {
    let up = records[i].high-records[i-1].high, down = records[i-1].low-records[i].low;
    pdm.push(up>down&&up>0?up:0); mdm.push(down>up&&down>0?down:0);
    tr.push(Math.max(records[i].high-records[i].low, Math.abs(records[i].high-records[i-1].close), Math.abs(records[i].low-records[i-1].close)));
  }
  let _rma = (arr,p) => { let r=[arr.slice(0,p).reduce((a,b)=>a+b)/p], a=1/p; for(let i=p;i<arr.length;i++)r.push(a*arr[i]+(1-a)*r[r.length-1]); return r; };
  let atrA=_rma(tr,period), pA=_rma(pdm,period), mA=_rma(mdm,period), dx=[];
  for(let i=0;i<atrA.length;i++) { let pi=100*pA[i]/atrA[i], mi=100*mA[i]/atrA[i]; dx.push(100*Math.abs(pi-mi)/(pi+mi)); }
  let aA=_rma(dx,period), a=aA[aA.length-1], rs=aA.length>=3&&aA[aA.length-1]>aA[aA.length-2]&&aA[aA.length-2]>aA[aA.length-3];
  return {adx:a,rising:rs};
}

// ─── 3. 布林带位置 ───
function bbPos(records, period=20) {
  let closes = records.map(r=>r.close), len=closes.length;
  if (len<period) return 0.5;
  let m = closes.slice(-period).reduce((a,b)=>a+b)/period;
  let v = closes.slice(-period).reduce((s,c)=>s+(c-m)**2,0)/period, std=Math.sqrt(v);
  let u=m+2*std, l=m-2*std;
  return u>l ? (closes[len-1]-l)/(u-l) : 0.5;
}

// ─── 4. Stochastic 穿越 ───
function stochCross(records, lookback=10) {
  let k=[], len=records.length;
  for (let i=13;i<len;i++) {
    let sl=records.slice(i-13,i+1), hi=Math.max(...sl.map(r=>r.high)), lo=Math.min(...sl.map(r=>r.low));
    k.push((records[i].close-lo)/(hi-lo)*100);
  }
  let sma=(arr,p)=>{let r=[];for(let i=0;i<=arr.length-p;i++)r.push(arr.slice(i,i+p).reduce((a,b)=>a+b)/p);return r;};
  let ks=sma(k,3), cnt=0, chk=Math.min(lookback,ks.length-1);
  for(let i=Math.max(0,ks.length-chk-1);i<ks.length-1;i++) if((ks[i]<20&&ks[i+1]>=20)||(ks[i]>80&&ks[i+1]<=80))cnt++;
  return cnt;
}

// ─── 5. 成交量 ───
function volCheck(records) {
  let vols=records.map(r=>r.vol), len=vols.length;
  let rec=vols.slice(-5).reduce((a,b)=>a+b)/5, full=vols.slice(-20).reduce((a,b)=>a+b)/20;
  let spike=vols[len-1]/(vols.slice(-11,-1).reduce((a,b)=>a+b)/10||1);
  return {shrinks:rec/(full||1), volSpike:spike, avgVol:full};
}

// ─── 6. 趋势排除 ───
function trendCheck(records) {
  let r20=records.slice(-20), hi=Math.max(...r20.map(r=>r.high)), lo=Math.min(...r20.map(r=>r.low));
  let cur=records[records.length-1].close;
  return {breakout:cur>hi*1.02||cur<lo*0.98};
}

// ─── 7. 综合评分 ───
function score(records, ticker) {
  if (records.length<30) return null;
  let amp=amplitude(records.slice(-SCAN_DAYS)), adxR=adx(records), bb=bbPos(records), sx=stochCross(records), vol=volCheck(records), tr=trendCheck(records);
  if (amp.avgAmpl<AMPL_MIN||amp.avgAmpl>AMPL_MAX||adxR.adx>25||vol.volSpike>2||tr.breakout) return null;

  let last=records.length-1;
  let ema7=ema(records,7), ema25=ema(records,25);
  let bullish = ema7[last] >= ema25[last]; // EMA多头排列

  // ── ① 振幅 (25) ──
  let s1=0;
  if (amp.avgAmpl>=5&&amp.avgAmpl<=8)s1+=12; else if(amp.avgAmpl>=3&&amp.avgAmpl<=12)s1+=7;
  if(amp.amplCV<0.5)s1+=8; else if(amp.amplCV<0.8)s1+=4;
  if(amp.quality>1.5)s1+=5; else if(amp.quality>1)s1+=2;

  // ── ② 震荡纯度 (30) ── 收紧：ADX更细分
  let s2=0;
  if(adxR.adx<12)s2+=18; else if(adxR.adx<15)s2+=12; else if(adxR.adx<20)s2+=7; else s2+=3;
  if(!adxR.rising)s2+=5; else if(adxR.adx<15)s2+=2;
  if(bb>0.3&&bb<0.7)s2+=5; else if(bb>0.2&&bb<0.8)s2+=3;
  if(sx>=4)s2+=5; else if(sx>=2)s2+=3; else if(sx>=1)s2+=1;

  // ── ③ 波动率 (20) ──
  let s3=0;
  let atrPct=amp.avgAmpl*1.2;
  if(atrPct>=3&&atrPct<=5)s3+=20; else if(atrPct>=2.5&&atrPct<=6)s3+=14; else if(atrPct>=2&&atrPct<=7)s3+=8; else s3+=3;

  // ── ④ 成交量 (15) ──
  let s4=0;
  if(vol.shrinks<0.85)s4+=8; else if(vol.shrinks<0.95)s4+=5; else if(vol.shrinks<1.1)s4+=2;
  if(vol.avgVol*ticker.last>MIN_VOLUME)s4+=7; else if(vol.avgVol*ticker.last>200000)s4+=3;

  // ── ⑤ 方向适合度 (10) ── 空头排列不给分
  let s5=0;
  if(bullish)s5+=6;
  if(!adxR.rising)s5+=4; else if(adxR.adx<12)s5+=2;

  // ── 风险标签 ──
  let warnings = [];
  if(!bullish) warnings.push('空头排列');
  if(atrPct<2) warnings.push('波幅薄');
  if(adxR.rising&&adxR.adx>15) warnings.push('ADX上升');
  if(vol.volSpike>1.5) warnings.push('量异动');

  return {
    symbol:ticker.instId.replace('-USDT-SWAP',''),
    score:s1+s2+s3+s4+s5,
    amp:_f(amp.avgAmpl,1), adx:_f(adxR.adx,1), bb:_f(bb,2), volS:_f(vol.shrinks,2), stochX:sx,
    bullish, warnings,
    raw:{amp:s1,osc:s2,vol:s3,vol2:s4,dir:s5}
  };
}

function ema(arr, p) { let a=2/(p+1), r=[arr[0].close]; for(let i=1;i<arr.length;i++)r.push(a*arr[i].close+(1-a)*r[i-1]); return r; }
function _f(n,d) { return n.toFixed(d); }

// ─── 主程序 ───
async function main() {
  console.log('🔍 牛逼马丁震荡币筛选器 v1.0');
  console.log('正在从 OKX 获取全市场行情...\n');

  let tickers = await okxGet('/api/v5/market/tickers?instType=SWAP');
  if (!tickers || !tickers.data) { console.error('❌ 获取行情失败'); process.exit(1); }

  let swaps = tickers.data.filter(t => t.instId.endsWith('-USDT-SWAP'))
    .sort((a,b) => (+b.vol24h) - (+a.vol24h));
  console.log(`📡 共 ${swaps.length} 个USDT永续合约，全量扫描...\n`);

  let results = [];
  for (let i = 0; i < swaps.length; i++) {
    let instId = swaps[i].instId, symbol = instId.replace('-USDT-SWAP','');
    if (BLACKLIST.has(symbol)) continue;
    if (+swaps[i].last > MAX_COIN_PRICE) continue;
    // ticker预筛选: 24h振幅明显不达标的直接跳过
    let hi24 = +swaps[i].high24h, lo24 = +swaps[i].low24h, op24 = +swaps[i].open24h;
    if (hi24 && lo24 && op24) {
      let ampl24 = (hi24-lo24)/op24*100;
      if (ampl24 < 1.0 || ampl24 > 18) continue;  // 放宽: 1-18%都看
    }
    let candles = await okxGet(`/api/v5/market/candles?instId=${instId}&bar=1D&limit=35`);
    if (!candles || !candles.data || candles.data.length < 30) continue;
    let records = candles.data.reverse().map(c => ({ open:+c[1], high:+c[2], low:+c[3], close:+c[4], vol:+c[5] }));
    let last = +swaps[i].last || records[records.length-1].close;
    let r = score(records, {instId, last});
    if (r) { results.push(r); }
    if ((i+1) % 30 === 0) console.log(`  📊 ${i+1}/${swaps.length} (${results.length}候选)`);
    await sleep(100);
  }

  results.sort((a,b)=>b.score-a.score);
  if (results.length===0) { console.log('❌ 无候选'); process.exit(0); }

  function printCoin(r, rank) {
    let ampl=+r.amp, price=+swaps.find(s=>s.instId.includes(r.symbol))?.last||50;
    let addPct=(ampl*0.15).toFixed(2), tpPct=(ampl*0.3).toFixed(2);
    let mult=1.1, totalAmt=0, amt=10;
    for(let l=0;l<8;l++){totalAmt+=amt;amt*=mult;}
    let lev,levNote;
    if(+r.adx<10&&ampl>=5){lev=20;levNote='20x激进翻倍';}
    else if(+r.adx<12&&ampl>=4){lev=15;levNote='15x快速翻倍';}
    else if(+r.adx<15&&ampl>=3){lev=10;levNote='10x标准';}
    else if(+r.adx<20){lev=8;levNote='8x谨慎';}
    else{lev=5;levNote='5x保守';}
    let marginTotal=(totalAmt/lev).toFixed(0);
    let liqEst=(price*(1-ampl*1.5/100)).toFixed(4);
    let emoji = r.score>=70?'🔥':r.score>=55?'⭐':'';
    console.log(`\n### ${rank}. ${emoji} ${r.symbol} — ${r.score}分 ${r.bullish?'🟢做多':'🔴做空'}`);
    console.log(`| 参数 | 建议值 | 说明 |`);
    console.log(`|------|--------|------|`);
    console.log(`| 方向 | ${r.bullish?'🟢做多':'🔴做空'} | EMA排列 |`);
    console.log(`| 跌加仓 | ${addPct}% | 振幅${r.amp}% × 0.15 |`);
    console.log(`| 止盈 | ${tpPct}% | 振幅${r.amp}% × 0.3 |`);
    console.log(`| 杠杆 | **${lev}x** | ${levNote} |`);
    console.log(`| 首单保证金 | ~${(10/lev).toFixed(1)}U | 10U名义/${lev}x |`);
    console.log(`| 8层总保证金 | ~${marginTotal}U | ∑10×1.1^层/${lev}x |`);
    console.log(`| 预估强平 | ~${liqEst} | 当前价×${(1-ampl*1.5/100).toFixed(2)} |`);
    console.log(`| ADX | ${r.adx} | <25震荡✅ | 振幅${r.amp}% |`);
    return {symbol:r.symbol,score:r.score,dir:r.bullish?'做多':'做空',addPct,tpPct,lev,marginTotal};
  }

  let top = results.slice(0,3);
  console.log(`\n## 🔥 OKX马丁 — 今日Top3 (${results.length}候选)\n`);
  let summaries = [];
  for (let i=0;i<top.length;i++) summaries.push(printCoin(top[i],i+1));
  console.log(`\n> ${results.length}候选 | 加仓倍数1.1× | 排除大市值 | 振幅1-18%\n`);

  // GitHub Summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    let fs=require('fs'), s='';
    s += `## 🔥 OKX马丁 Top3 (${results.length}候选)\\n\\n`;
    for (let i=0;i<top.length;i++) {
      let sum=summaries[i];
      s += `**${i+1}. ${sum.symbol}** ${sum.score}分 ${sum.dir} | 跌${sum.addPct}%止盈${sum.tpPct}% | ${sum.lev}x ~${sum.marginTotal}U\\n\\n`;
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, s);
  }
}

main().catch(console.error);
