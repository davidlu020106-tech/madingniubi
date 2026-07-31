/* ============================================================
 * 牛逼马丁不死不休 — 震荡币筛选器 v1.0
 * ============================================================
 * 功能: 扫全市场U本位永续合约，5维评分找最适合马丁的震荡币
 * 部署: FMZ策略编辑器 → 新建JS策略 → 粘贴全部 → 运行
 * 输出: 状态栏表格，按震荡适合度降序排列
 * ============================================================ */

var SCAN_DAYS = 30;
var MIN_VOLUME_USDT = 500000;
var AMPL_MIN = 3.0;
var AMPL_MAX = 12.0;

function main() {
    exchange.SetContractType("swap");
    exchange.SetMaxBarLen(1000);
    Log("震荡币筛选器 v1.0 启动，扫描全市场...");

    var info = exchange.IO("api", "GET", "/fapi/v1/exchangeInfo");
    var results = [];

    for (var i = 0; i < info.symbols.length; i++) {
        var ele = info.symbols[i];
        if (ele.contractType != "PERPETUAL" || ele.status != "TRADING" || ele.quoteAsset != "USDT") continue;

        var symbol = ele.baseAsset + "_USDT";
        exchange.SetCurrency(symbol);
        var records = _C(exchange.GetRecords, PERIOD_D1);
        if (!records || records.length < SCAN_DAYS) continue;

        var ticker = _C(exchange.GetTicker);
        var result = _scoreCoin(records, ticker);
        if (result.score > 0) {
            result.symbol = ele.baseAsset;
            results.push(result);
        }
    }

    results.sort(function(a, b) { return b.score - a.score; });

    var table = {
        type: "table",
        title: "震荡币筛选 Top 20",
        cols: ["排名","币种","总分","振幅%","ADX","BB位","量缩","穿越"],
        rows: []
    };

    for (var j = 0; j < Math.min(results.length, 20); j++) {
        var r = results[j], d = r.detail;
        table.rows.push([j+1, r.symbol, r.score, d.avgAmpl, d.adx, d.bbPos, d.volShrink, d.stochCross]);
    }

    LogStatus("`" + JSON.stringify(table) + "`");
    Log("完成! 候选 " + results.length + " 个币种");

    var top3 = results.slice(0, 3);
    if (top3.length > 0) {
        Log("\n=== Top 3 推荐 ===");
        for (var k = 0; k < top3.length; k++) {
            Log(top3[k].symbol + " 得分:" + top3[k].score + " | " + top3[k].breakDown);
        }
    }
}

function _scoreCoin(records, ticker) {
    var len = records.length;
    if (len < 30) return { score: 0, reason: "数据不足" };

    var ampl = _amplitude(records.slice(-SCAN_DAYS));
    var adxR = _adx(records, 14);
    var bbPos = _bbPos(records, 20);
    var stochX = _stochCross(records, 10);
    var vol = _volumeCheck(records);

    if (ampl.avgAmpl < AMPL_MIN || ampl.avgAmpl > AMPL_MAX) return { score: 0 };
    if (adxR.adx > 25) return { score: 0 };
    if (vol.volSpike > 2.0) return { score: 0 };

    var rangeHigh = Math.max.apply(null, records.slice(-20).map(function(r){return r.High;}));
    var rangeLow = Math.min.apply(null, records.slice(-20).map(function(r){return r.Low;}));
    var cur = records[len-1].Close;
    if (cur > rangeHigh * 1.02 || cur < rangeLow * 0.98) return { score: 0 };

    var s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0;

    if (ampl.avgAmpl >= 5 && ampl.avgAmpl <= 8) s1 += 12;
    else if (ampl.avgAmpl >= 3 && ampl.avgAmpl <= 12) s1 += 7;
    if (ampl.amplCV < 0.5) s1 += 8;
    else if (ampl.amplCV < 0.8) s1 += 4;
    if (ampl.qualityRatio > 1.5) s1 += 5;
    else if (ampl.qualityRatio > 1.0) s1 += 2;

    if (adxR.adx < 15) s2 += 15;
    else if (adxR.adx < 20) s2 += 10;
    else s2 += 5;
    if (!adxR.rising) s2 += 5;
    if (bbPos > 0.3 && bbPos < 0.7) s2 += 5;
    else if (bbPos > 0.2 && bbPos < 0.8) s2 += 3;
    if (stochX >= 3) s2 += 5;
    else if (stochX >= 1) s2 += 2;

    var atrPct = ampl.avgAmpl * 1.2;
    if (atrPct >= 2 && atrPct <= 5) s3 += 20;
    else if (atrPct >= 1.5 && atrPct <= 8) s3 += 10;
    else if (atrPct < 8) s3 += 3;

    if (vol.shrinks < 0.9) s4 += 8;
    else if (vol.shrinks < 1.1) s4 += 4;
    if (vol.avgVol * ticker.Last > MIN_VOLUME_USDT) s4 += 7;
    else if (vol.avgVol * ticker.Last > 200000) s4 += 3;

    var ema7 = TA.EMA(records, 7);
    var ema25 = TA.EMA(records, 25);
    if (ema7[len-1] >= ema25[len-1]) s5 += 5;
    if (!adxR.rising) s5 += 5;
    else s5 += 2;

    return {
        score: s1 + s2 + s3 + s4 + s5,
        breakDown: "振幅" + s1 + "+震荡" + s2 + "+波动" + s3 + "+量" + s4 + "+趋势" + s5,
        detail: {
            avgAmpl: _N(ampl.avgAmpl, 2),
            adx: _N(adxR.adx, 1),
            bbPos: _N(bbPos, 2),
            volShrink: _N(vol.shrinks, 2),
            stochCross: stochX
        }
    };
}

function _amplitude(records) {
    var amps = [], sumAmpl = 0, sumChange = 0;
    for (var i = 0; i < records.length; i++) {
        var a = (records[i].High - records[i].Low) / records[i].Open * 100;
        var c = Math.abs((records[i].Close - records[i].Open) / records[i].Open * 100);
        amps.push(a);
        sumAmpl += a;
        sumChange += c;
    }
    var avgA = sumAmpl / records.length;
    var avgC = sumChange / records.length;
    var stdA = 0;
    for (var i = 0; i < amps.length; i++) stdA += (amps[i] - avgA) * (amps[i] - avgA);
    return { avgAmpl: avgA, amplCV: Math.sqrt(stdA / records.length) / avgA, qualityRatio: avgC > 0.01 ? avgA / avgC : avgA / 0.01 };
}

function _adx(records, period) {
    var len = records.length, tr = [], pdm = [], mdm = [];
    for (var i = 1; i < len; i++) {
        var up = records[i].High - records[i-1].High, down = records[i-1].Low - records[i].Low;
        pdm.push(up > down && up > 0 ? up : 0);
        mdm.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(records[i].High - records[i].Low, Math.abs(records[i].High - records[i-1].Close), Math.abs(records[i].Low - records[i-1].Close)));
    }
    function _rma(arr, p) { var r = [], a = 1/p; r[0] = arr.slice(0,p).reduce(function(a,b){return a+b;},0)/p; for (var j = p; j < arr.length; j++) r.push(a*arr[j]+(1-a)*r[r.length-1]); return r; }
    var atrArr = _rma(tr, period), pArr = _rma(pdm, period), mArr = _rma(mdm, period), dx = [];
    for (var k = 0; k < atrArr.length; k++) dx.push(100 * Math.abs(100*pArr[k]/atrArr[k] - 100*mArr[k]/atrArr[k]) / (100*pArr[k]/atrArr[k] + 100*mArr[k]/atrArr[k]));
    var adxArr = _rma(dx, period), a = adxArr[adxArr.length-1], rising = adxArr.length>=3 && adxArr[adxArr.length-1] > adxArr[adxArr.length-2] && adxArr[adxArr.length-2] > adxArr[adxArr.length-3];
    return { adx: a, rising: rising };
}

function _bbPos(records, period) {
    var closes = records.map(function(r){return r.Close;}), len = closes.length, sum = 0;
    for (var i = len - period; i < len; i++) sum += closes[i];
    var mean = sum / period, va = 0;
    for (var i = len - period; i < len; i++) va += (closes[i] - mean) * (closes[i] - mean);
    var std = Math.sqrt(va / period), u = mean + 2*std, l = mean - 2*std;
    if (u <= l) return 0.5;
    return (closes[len-1] - l) / (u - l);
}

function _stochCross(records, lookback) {
    var len = records.length, kvals = [];
    for (var i = 13; i < len; i++) {
        var slice = records.slice(i-13, i+1), h = slice.reduce(function(a,b){return Math.max(a,b.High);},0), l = slice.reduce(function(a,b){return Math.min(a,b.Low);}, Number.MAX_VALUE);
        kvals.push((records[i].Close - l) / (h - l) * 100);
    }
    function _sma(arr, p) { var r = []; for (var i = 0; i <= arr.length-p; i++) { var s = 0; for (var j = 0; j < p; j++) s += arr[i+j]; r.push(s/p); } return r; }
    var kS = _sma(kvals, 3), cnt = 0, chk = Math.min(lookback, kS.length-1);
    for (var i = Math.max(0, kS.length-chk-1); i < kS.length-1; i++) {
        if ((kS[i] < 20 && kS[i+1] >= 20) || (kS[i] > 80 && kS[i+1] <= 80)) cnt++;
    }
    return cnt;
}

function _volumeCheck(records) {
    var vols = records.map(function(r){return r.Volume;}), len = vols.length;
    var rec = vols.slice(-5).reduce(function(a,b){return a+b;},0)/5;
    var full = vols.slice(-20).reduce(function(a,b){return a+b;},0)/20;
    var spike = vols[len-1] / (vols.slice(-11,-1).reduce(function(a,b){return a+b;},0)/10);
    return { shrinks: rec/full, volSpike: spike, avgVol: full };
}
