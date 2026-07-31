/* ============================================================
 * 牛逼马丁不死不休 v3.0 — 选币+马丁翻倍 合一版 (FMZ JS)
 * ============================================================
 * 逻辑:
 *   启动 → 扫全市场选震荡币 → 5维评分取第1名
 *   → 在该币上跑马丁翻倍(multiplier=2.0, 10层)
 *   → 回撤40%锁死 / 趋势反转 → 换下一个币
 *   → 每24h重新扫描
 *
 * 部署: FMZ → 新建JS策略 → 粘贴全部 → 配置OKX合约 → 运行
 * ============================================================ */

// ═══════════ 参数 ═══════════
var LEVERAGE     = 5;        // 杠杆
var BASE_AMOUNT  = 10;       // 首单USDT
var MULTIPLIER   = 2.0;      // 加仓倍数
var MAX_LEVEL    = 10;       // 最大层数
var DIST_PCT     = 1.0;      // 加仓触发%
var REBOUND_PCT  = 0.3;      // 反弹确认%
var TARGET_USDT  = 20;       // 止盈USDT
var MAX_DD       = 0.40;     // 回撤锁死
var RESCAN_HOURS = 24;       // 重新扫描间隔(小时)

// 选币参数
var AMPL_MIN = 3, AMPL_MAX = 12, MIN_VOL = 500000;

// ═══════════ 持久化 ═══════════
function load() { return _G("nbmb3") || { level:1, round:0, peak:0, locked:false, extracted:0, coin:"", lastScan:0 }; }
function save(s) { _G("nbmb3", s); }

// ═══════════ 指标 ═══════════
function EMA(arr, p) { let a=2/(p+1), r=[arr[0].Close]; for(let i=1;i<arr.length;i++) r.push(a*arr[i].Close+(1-a)*r[r.length-1]); return r; }
function MACD(arr) { let e12=EMA(arr,12),e26=EMA(arr,26), dif=[],dea=[],macd=[]; for(let i=0;i<e12.length;i++)dif.push(e12[i]-e26[i]); let a=2/10;dea[0]=dif[0];for(let j=1;j<dif.length;j++){dea.push(a*dif[j]+(1-a)*dea[j-1]);macd.push(2*(dif[j]-dea[j]));} return{dif,dea,macd}; }
function KDJ(arr,p){ p=p||9;let k=[],d=[],j=[],len=arr.length;if(len<p)return{k,d,j};k[p-1]=50;d[p-1]=50;for(let i=p;i<len;i++){let sl=arr.slice(i-p+1,i+1),hh=Math.max(...sl.map(r=>r.High)),ll=Math.min(...sl.map(r=>r.Low)),rsv=(arr[i].Close-ll)/(hh-ll)*100;k[i]=2/3*k[i-1]+1/3*rsv;d[i]=2/3*d[i-1]+1/3*k[i];j[i]=3*k[i]-2*d[i];}return{k,d,j};}
function cross(a,b,idx){return a[idx]>b[idx]&&a[idx-1]<=b[idx-1];}
function ampScore(recs) { let amps=[],sumA=0,sumC=0; for(let r of recs){let a=(r.High-r.Low)/r.Open*100,c=Math.abs((r.Close-r.Open)/r.Open*100);amps.push(a);sumA+=a;sumC+=c;} let avg=sumA/recs.length,avgC=sumC/recs.length,va=amps.reduce((s,a)=>(a-avg)**2+s,0)/recs.length; return{avgAmpl:avg,cv:Math.sqrt(va)/(avg||1),qual:avgC>0.01?avg/avgC:avg/0.01}; }
function adx(arr,p){ p=p||14;let len=arr.length,tr=[],pdm=[],mdm=[];if(len<p+1)return{adx:50,rising:false};for(let i=1;i<len;i++){let u=arr[i].High-arr[i-1].High,d=arr[i-1].Low-arr[i].Low;pdm.push(u>d&&u>0?u:0);mdm.push(d>u&&d>0?d:0);tr.push(Math.max(arr[i].High-arr[i].Low,Math.abs(arr[i].High-arr[i-1].Close),Math.abs(arr[i].Low-arr[i-1].Close)));}let rma=(a,p)=>{let r=[a.slice(0,p).reduce((s,x)=>s+x)/p],al=1/p;for(let i=p;i<a.length;i++)r.push(al*a[i]+(1-al)*r[r.length-1]);return r;};let aa=rma(tr,p),pa=rma(pdm,p),ma=rma(mdm,p),dx=[];for(let i=0;i<aa.length;i++){let pi=100*pa[i]/aa[i],mi=100*ma[i]/aa[i];dx.push(100*Math.abs(pi-mi)/(pi+mi));}let ax=rma(dx,p),a=ax[ax.length-1],rs=ax.length>=3&&ax[ax.length-1]>ax[ax.length-2]&&ax[ax.length-2]>ax[ax.length-3];return{adx:a,rising:rs};}
function bbPos(arr,p){ p=p||20;let cl=arr.map(r=>r.Close),len=cl.length;if(len<p)return 0.5;let m=cl.slice(-p).reduce((s,x)=>s+x)/p,v=cl.slice(-p).reduce((s,x)=>{
let d=x-m;return s+d*d;},0)/p,s=Math.sqrt(v),u=m+2*s,l=m-2*s;return u>l?(cl[len-1]-l)/(u-l):0.5;}
function stochX(arr){ let k=[],len=arr.length;for(let i=13;i<len;i++){let sl=arr.slice(i-13,i+1),hh=Math.max(...sl.map(r=>r.High)),ll=Math.min(...sl.map(r=>r.Low));k.push((arr[i].Close-ll)/(hh-ll)*100);}let sma=(a,p)=>{let r=[];for(let i=0;i<=a.length-p;i++)r.push(a.slice(i,i+p).reduce((s,x)=>s+x)/p);return r;},ks=sma(k,3),cnt=0;for(let i=Math.max(0,ks.length-11);i<ks.length-1;i++)if((ks[i]<20&&ks[i+1]>=20)||(ks[i]>80&&ks[i+1]<=80))cnt++;return cnt;}
function volCheck(arr){let vs=arr.map(r=>r.Volume),len=vs.length,rec=vs.slice(-5).reduce((s,x)=>s+x)/5,full=vs.slice(-20).reduce((s,x)=>s+x)/20,spike=vs[len-1]/(vs.slice(-11,-1).reduce((s,x)=>s+x)/10||1);return{shrink:rec/(full||1),spike,avg:full};}

// ═══════════ 5维选币评分 ═══════════
function scoreCoin(records) {
  if(records.length<30)return null;
  let a=ampScore(records.slice(-30)),ax=adx(records),bb=bbPos(records),sx=stochX(records),v=volCheck(records);
  if(a.avgAmpl<AMPL_MIN||a.avgAmpl>AMPL_MAX||ax.adx>25||v.spike>2)return null;
  // 突破检测
  let r20=records.slice(-20),hi=Math.max(...r20.map(r=>r.High)),lo=Math.min(...r20.map(r=>r.Low)),cur=records[records.length-1].Close;
  if(cur>hi*1.02||cur<lo*0.98)return null;
  // 多头排列
  let ema7=EMA(records,7),ema25=EMA(records,25),last=records.length-1,bull=ema7[last]>=ema25[last];
  let s1=0,s2=0,s3=0,s4=0,s5=0;
  if(a.avgAmpl>=5&&a.avgAmpl<=8)s1+=12;else if(a.avgAmpl>=3)s1+=7;
  if(a.cv<0.5)s1+=8;else if(a.cv<0.8)s1+=4;
  if(a.qual>1.5)s1+=5;else if(a.qual>1)s1+=2;
  if(ax.adx<12)s2+=18;else if(ax.adx<15)s2+=12;else if(ax.adx<20)s2+=7;else s2+=3;
  if(!ax.rising)s2+=5;else if(ax.adx<15)s2+=2;
  if(bb>0.3&&bb<0.7)s2+=5;else if(bb>0.2&&bb<0.8)s2+=3;
  if(sx>=4)s2+=5;else if(sx>=2)s2+=3;else if(sx>=1)s2+=1;
  let atrPct=a.avgAmpl*1.2;
  if(atrPct>=3&&atrPct<=5)s3+=20;else if(atrPct>=2.5)s3+=14;else if(atrPct>=2)s3+=8;else s3+=3;
  if(v.shrink<0.85)s4+=8;else if(v.shrink<0.95)s4+=5;else if(v.shrink<1.1)s4+=2;
  let tkr=_C(exchange.GetTicker);
  if(v.avg*(tkr?tkr.Last:records[last].Close)>MIN_VOL)s4+=7;else if(v.avg*(tkr?tkr.Last:records[last].Close)>200000)s4+=3;
  if(bull)s5+=6;if(!ax.rising)s5+=4;else if(ax.adx<12)s5+=2;
  return {score:s1+s2+s3+s4+s5, amp:a.avgAmpl.toFixed(1), adx:ax.adx.toFixed(1), bull};
}

// ═══════════ 扫全市场 ═══════════
function scanMarket() {
  Log("🔍 扫描全市场震荡币...");
  let info = exchange.IO("api","GET","/api/v5/public/instruments?instType=SWAP");
  if(!info||!info.data){Log("❌ 获取合约列表失败");return[];}
  let results=[],swaps=info.data.filter(s=>s.instId.endsWith("-USDT-SWAP"));
  for(let i=0;i<swaps.length;i++){
    let id=swaps[i].instId, sym=id.replace("-USDT-SWAP","");
    exchange.SetCurrency(sym+"_USDT");
    let recs=_C(exchange.GetRecords,PERIOD_D1);
    if(!recs||recs.length<30)continue;
    let r=scoreCoin(recs);
    if(r){r.symbol=sym;results.push(r);}
    if((i+1)%50===0)Log("  ..."+ (i+1)+"/"+swaps.length);
  }
  results.sort((a,b)=>b.score-a.score);
  Log("✅ 扫描完成: "+results.length+"个候选, Top5:");
  for(let i=0;i<Math.min(5,results.length);i++){
    let r=results[i],dir=r.bull?"🟢":"🔴";
    Log("  "+(i+1)+". "+dir+" "+r.symbol+" ("+r.score+"分) 振幅"+r.amp+"% ADX"+r.adx);
  }
  return results;
}

// ═══════════ 入场信号 ═══════════
function entrySignal(records) {
  let len=records.length;if(len<30)return false;
  let macd=MACD(records),kdj=KDJ(records,9),e7=EMA(records,7),e25=EMA(records,25),last=len-1;
  return cross(macd.dif,macd.dea,last) && cross(kdj.k,kdj.d,last) && e7[last]>=e25[last];
}

// ═══════════ 终止信号 ═══════════
function stopSignal(records, st, eq) {
  if(st.peak>0&& (st.peak-eq)/st.peak >= MAX_DD) return {stop:true,lock:true,reason:"回撤"+(100*(st.peak-eq)/st.peak).toFixed(0)+"%"};
  let e7=EMA(records,7),e25=EMA(records,25),last=records.length-1;
  if(e7[last]<e25[last]) return {stop:true,lock:false,reason:"EMA空头反转"};
  return {stop:false,lock:false,reason:""};
}

// ═══════════ 交易操作 ═══════════
function getEq(){let a=_C(exchange.GetAccount);return a?a.Balance:-1;}
function cancelAll(){while(true){let os=_C(exchange.GetOrders);if(!os||os.length===0)break;for(let o of os){exchange.CancelOrder(o.Id,o);Sleep(200);}Sleep(200);}}
function trade(dir,price,amt){exchange.SetDirection(dir);if(dir==="buy")return exchange.Buy(price,amt);if(dir==="closebuy")return exchange.Sell(price,amt);}

// ═══════════ 主循环 ═══════════
function main() {
  exchange.SetContractType("swap");
  exchange.SetMarginLevel(LEVERAGE);
  exchange.SetPrecision(2,2);

  var st = load(), eq = getEq();
  if(st.peak===0)st.peak=eq;

  Log("🚀 牛逼马丁 v3.0 (选币+翻倍一体)");
  Log("参数: "+LEVERAGE+"x杠杆 ×"+MULTIPLIER+"倍 "+MAX_LEVEL+"层 | 回撤锁"+MAX_DD*100+"%");

  // 回撤锁死
  if(st.locked){Log("🔒 已锁死! 手动重置_G('nbmb3',null)");while(true)Sleep(60000);}

  // 选币
  var now = new Date().getTime()/1000;
  if(!st.coin || now-st.lastScan > RESCAN_HOURS*3600){
    var candidates = scanMarket();
    if(candidates.length>0){
      st.coin = candidates[0].symbol;
      st.lastScan = now;
      Log("🎯 选中: "+st.coin+" ("+candidates[0].score+"分)");
      save(st);
    } else {
      Log("⚠️ 无候选币，1小时后重试");
      Sleep(3600000);
      st.lastScan = 0;
      save(st);
      return;
    }
  }

  // 切换币种
  exchange.SetCurrency(st.coin+"_USDT");
  Log("📊 当前币种: "+st.coin+" | 第"+st.round+"轮 | 层数"+st.level);

  while(true){
    var ticker=_C(exchange.GetTicker), price=ticker.Last, pos=_C(exchange.GetPosition), recs=_C(exchange.GetRecords,PERIOD_M5), eq2=getEq();
    if(eq2>st.peak)st.peak=eq2;

    // 终止信号
    var stop=stopSignal(recs,st,eq2);
    if(stop.stop){
      Log("🛑 "+stop.reason);cancelAll();
      if(pos.length>0)trade("closebuy",price,pos[0].Amount);
      if(stop.lock){st.locked=true;save(st);Log("🔒 锁死!");while(true)Sleep(60000);}
      st.level=1;st.coin="";save(st);
      break;
    }

    // 无持仓→等信号
    if(pos.length===0){
      if(entrySignal(recs)){
        Log("🎯 MACD+KDJ双金叉,入场!");
        trade("buy",price-price*DIST_PCT/100,BASE_AMOUNT);
        st.level=1;save(st);
      }
    }

    // 多仓→马丁管理
    if(pos.length>0&&pos[0].Type===0){
      let p=pos[0];
      if(p.Profit>=TARGET_USDT){
        Log("💰 止盈+"+p.Profit.toFixed(2)+"USDT");
        trade("closebuy",price,p.Amount);
        st.round++;st.level=1;
        LogProfit(eq2-getEq());
        save(st);
        // 检查翻倍
        if(eq2>=st.peak*2){
          Log("🎉 翻倍! 建议提取利润");
        }
        continue;
      }
      // 加仓:跌1%+反弹0.3%
      let addAt=p.Price*(1-DIST_PCT/100),lowest=_G("nbmb_low")||price;
      if(price<lowest)_G("nbmb_low",price);
      if(price>lowest*(1+REBOUND_PCT/100)&&price<=addAt&&st.level<MAX_LEVEL){
        let amt=BASE_AMOUNT*Math.pow(MULTIPLIER,st.level);
        Log("📉 加仓L"+ (st.level+1)+": "+amt.toFixed(1)+"USDT");
        cancelAll();trade("buy",price,amt);
        st.level++;_G("nbmb_low",price);save(st);
        continue;
      }
      // 挂止盈
      var orders=_C(exchange.GetOrders);
      if(!orders.some(o=>o.Type===1)){
        trade("closebuy",Math.max(p.Price+TARGET_USDT,price+TARGET_USDT),p.Amount);
      }
    }

    save(st);
    Sleep(5000);

    // 每24h重扫
    if(new Date().getTime()/1000-st.lastScan>RESCAN_HOURS*3600){Log("⏰ 重新扫描...");break;}
  }
  // 回到开头重扫
  main();
}

function onexit(){Log("退出,撤单");cancelAll();}
