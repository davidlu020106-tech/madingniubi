# 牛逼马丁不死不休 — 选币系统设计

> 基于对 FMZ 120个策略的深度分析，提炼出的震荡币筛选方案

## 设计理念

选币系统不是一个策略，而是**马丁内核的前置过滤器**：
- 输入：全市场 U本位永续合约
- 输出：Top 3-5 个最适合跑马丁的震荡币
- 评分：5个维度加权 → 震荡适合度分数

---

## 五维评分体系

```
总分 = 振幅(25%) + 震荡纯度(30%) + 波动率(20%) + 成交量(15%) + 趋势排除(10%)
```

### ① 振幅维度 (25分)

| 指标 | 公式 | 满分条件 | 来源 |
|------|------|---------|------|
| 日均振幅 | `avg(High-Low)/Open × 100` | 5%~8% | U本位网格振幅筛选 |
| 振幅稳定性 | `std(振幅)/avg(振幅)` | CV < 0.5 | 改进推导 |
| 震荡质量比 | `avg振幅 / avg|涨跌幅|` | > 1.5 | 改进推导 |

### ② 震荡纯度 (30分，权重最高)

| 指标 | 阈值 | 来源 |
|------|------|------|
| ADX | < 20 = 满分, 20-25 = 一半, > 25 = 淘汰 | 自适应ATR-ADX V2 |
| ADX方向 | 连续3根上升 → 预警降分 | 趋势确认随机震荡策略 |
| 布林带位置 | 价格在30%-70%区间 = 震荡 | 结合布林带与RSI自适应策略 |
| Stochastic穿越 | 近10根K线穿越20/80 ≥ 3次 | 趋势确认随机震荡策略 |

### ③ 波动率维度 (20分)

| 指标 | 满分区间 | 来源 |
|------|---------|------|
| ATR/价格比 | 2%~5% | 自适应范围波动率策略 |
| 排除极端波动 | ATR/价格 > 8% → 淘汰 | 历史波动率区间突破策略 |

### ④ 成交量维度 (15分)

| 指标 | 阈值 | 来源 |
|------|------|------|
| 量萎缩比 | recent/avg < 0.9 | VWAP成交量异常监测 |
| 无异动放量 | vol_ratio < 2.0 | VWAP成交量异常监测 |
| 流动性底线 | 日成交额 > 50万USDT | KDJ+量筛选币种 |

### ⑤ 趋势排除 (10分)

| 指标 | 规则 | 来源 |
|------|------|------|
| 价格突破 | 突破20日区间 → 淘汰 | 趋势确认随机震荡策略 |
| EMA排列 | EMA7 < EMA25 → 长期空头趋势 → 降分 | KDJ+量筛选 |

---

## FMZ JS 实现

文件: `fmz_coin_scanner.js` — 直接复制到FMZ策略编辑器运行

```javascript
/* ============================================================
 * 牛逼马丁不死不休 — 震荡币筛选器 v1.0
 * ------------------------------------------------------------
 * 功能: 扫全市场U本位永续合约，按5维评分找最适合马丁的震荡币
 * 输出: FMZ状态栏表格，按震荡适合度排序
 * 部署: FMZ策略编辑器 → 新建JavaScript策略 → 粘贴运行
 * ============================================================ */

// ─── 参数 ───
var SCAN_DAYS = 30;          // 回溯天数
var MIN_VOLUME_USDT = 500000; // 最小日成交额(USDT)
var AMPL_MIN = 3.0;          // 最低日均振幅%
var AMPL_MAX = 12.0;         // 最高日均振幅%

// ─── 1. 振幅计算 ───
function calcAmplitude(records) {
    var totalAmpl = 0, totalChange = 0;
    var ampls = [], changes = [];
    
    for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var ampl = (r.High - r.Low) / r.Open * 100;
        var change = (r.Close - r.Open) / r.Open * 100;
        ampls.push(ampl);
        changes.push(change);
        totalAmpl += ampl;
        totalChange += Math.abs(change);
    }
    
    var avgAmpl = totalAmpl / records.length;
    var avgChange = totalChange / records.length;
    
    // 振幅稳定性(CV)
    var amplStd = 0;
    for (var i = 0; i < ampls.length; i++) {
        amplStd += Math.pow(ampls[i] - avgAmpl, 2);
    }
    amplStd = Math.sqrt(amplStd / ampls.length);
    var cv = avgAmpl > 0 ? amplStd / avgAmpl : 999;
    
    // 震荡质量比 = 振幅 / 净涨跌幅（越大越纯震荡）
    var qualityRatio = avgChange > 0.01 ? avgAmpl / avgChange : avgAmpl / 0.01;
    
    return {
        avgAmpl: avgAmpl,
        amplCV: cv,
        qualityRatio: qualityRatio
    };
}

// ─── 2. ADX 计算 (Wilder方法) ───
function calcADX(records, period) {
    period = period || 14;
    var len = records.length;
    if (len < period + 1) return { adx: 50, rising: false };
    
    var tr = [], plusDM = [], minusDM = [];
    for (var i = 1; i < len; i++) {
        var upMove = records[i].High - records[i-1].High;
        var downMove = records[i-1].Low - records[i].Low;
        plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
        minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
        tr.push(Math.max(
            records[i].High - records[i].Low,
            Math.abs(records[i].High - records[i-1].Close),
            Math.abs(records[i].Low - records[i-1].Close)
        ));
    }
    
    function rma(arr, p) {
        var result = [], alpha = 1 / p;
        result[0] = arr.slice(0, p).reduce(function(a,b){return a+b;}, 0) / p;
        for (var j = p; j < arr.length; j++) {
            result.push(alpha * arr[j] + (1 - alpha) * result[result.length - 1]);
        }
        return result;
    }
    
    var atrRma = rma(tr, period);
    var plusRma = rma(plusDM, period);
    var minusRma = rma(minusDM, period);
    var dxArr = [];
    
    for (var k = 0; k < atrRma.length; k++) {
        var plusDI = 100 * plusRma[k] / atrRma[k];
        var minusDI = 100 * minusRma[k] / atrRma[k];
        dxArr.push(100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI));
    }
    
    var adxArr = rma(dxArr, period);
    var adx = adxArr[adxArr.length - 1];
    var adxRising = false;
    if (adxArr.length >= 3) {
        adxRising = adxArr[adxArr.length-1] > adxArr[adxArr.length-2] &&
                    adxArr[adxArr.length-2] > adxArr[adxArr.length-3];
    }
    
    return { adx: adx, rising: adxRising };
}

// ─── 3. 布林带位置判断 ───
function calcBollingerPosition(records, period) {
    period = period || 20;
    var len = records.length;
    if (len < period) return 0.5;
    
    var closes = records.map(function(r){return r.Close;});
    var sum = closes.slice(-period).reduce(function(a,b){return a+b;}, 0);
    var mean = sum / period;
    
    var variance = 0;
    for (var i = len - period; i < len; i++) {
        variance += Math.pow(closes[i] - mean, 2);
    }
    var std = Math.sqrt(variance / period);
    
    var upper = mean + 2 * std;
    var lower = mean - 2 * std;
    var current = closes[len - 1];
    
    if (upper <= lower) return 0.5;
    return (current - lower) / (upper - lower); // 0=下轨, 1=上轨, 0.5=中间
}

// ─── 4. Stochastic穿越统计 ───
function calcStochasticCrossCount(records, period, smoothK, smoothD) {
    period = period || 14;
    smoothK = smoothK || 3;
    smoothD = smoothD || 3;
    
    var len = records.length;
    if (len < period + 10) return 0;
    
    var kvals = [];
    for (var i = period - 1; i < len; i++) {
        var slice = records.slice(i - period + 1, i + 1);
        var highest = Math.max.apply(null, slice.map(function(r){return r.High;}));
        var lowest = Math.min.apply(null, slice.map(function(r){return r.Low;}));
        var rawK = (records[i].Close - lowest) / (highest - lowest) * 100;
        kvals.push(rawK);
    }
    
    // 平滑
    function sma(arr, p) {
        var result = [];
        for (var i = 0; i <= arr.length - p; i++) {
            var s = 0;
            for (var j = 0; j < p; j++) s += arr[i + j];
            result.push(s / p);
        }
        return result;
    }
    
    var kSmooth = sma(kvals, smoothK);
    var crossCount = 0;
    var checkLen = Math.min(10, kSmooth.length - 1);
    
    for (var i = kSmooth.length - checkLen; i < kSmooth.length - 1; i++) {
        if ((kSmooth[i] < 20 && kSmooth[i+1] >= 20) ||
            (kSmooth[i] > 80 && kSmooth[i+1] <= 80)) {
            crossCount++;
        }
    }
    
    return crossCount;
}

// ─── 5. 成交量检查 ───
function calcVolumeScore(records) {
    var len = records.length;
    var volumes = records.map(function(r){return r.Volume;});
    
    var recentVol = volumes.slice(-5).reduce(function(a,b){return a+b;}, 0) / 5;
    var fullVol = volumes.slice(-20).reduce(function(a,b){return a+b;}, 0) / 20;
    var shrinksRatio = recentVol / fullVol;  // < 1 表示量萎缩
    
    var curVol = volumes[len - 1];
    var prevAvg = volumes.slice(-11, -1).reduce(function(a,b){return a+b;}, 0) / 10;
    var volSpike = curVol / prevAvg; // > 2 表示异动放量
    
    return {
        shrinksRatio: shrinksRatio,
        volSpike: volSpike,
        avgDailyVol: fullVol
    };
}

// ─── 6. 趋势排除 ───
function calcTrendExclusion(records) {
    var len = records.length;
    var recent = records.slice(-20);
    var rangeHigh = Math.max.apply(null, recent.map(function(r){return r.High;}));
    var rangeLow = Math.min.apply(null, recent.map(function(r){return r.Low;}));
    var current = records[len-1].Close;
    
    var breakoutUp = current > rangeHigh * 1.02;
    var breakoutDown = current < rangeLow * 0.98;
    
    var ema7 = TA.EMA(records, 7);
    var ema25 = TA.EMA(records, 25);
    var bearishTrend = ema7[len-1] < ema25[len-1];
    
    return {
        breakout: breakoutUp || breakoutDown,
        bearishTrend: bearishTrend
    };
}

// ─── 7. 综合评分 ───
function scoreCoin(records, ticker) {
    var len = records.length;
    if (len < 30) return { score: 0, reason: "数据不足" };
    
    var ampl = calcAmplitude(records.slice(-SCAN_DAYS));
    var adxResult = calcADX(records, 14);
    var bbPos = calcBollingerPosition(records, 20);
    var stochCross = calcStochasticCrossCount(records, 14, 3, 3);
    var vol = calcVolumeScore(records, 20);
    var trend = calcTrendExclusion(records);
    
    // ── 硬排除 ──
    if (ampl.avgAmpl < AMPL_MIN || ampl.avgAmpl > AMPL_MAX) return { score: 0, reason: "振幅" + _N(ampl.avgAmpl,1) + "%不达标" };
    if (adxResult.adx > 25) return { score: 0, reason: "ADX="+_N(adxResult.adx,1)+" 趋势太强" };
    if (trend.breakout) return { score: 0, reason: "突破20日区间" };
    if (vol.volSpike > 2.0) return { score: 0, reason: "异动放量" };
    
    // ── 五维评分 ──
    var s1 = 0; // 振幅 (25)
    if (ampl.avgAmpl >= 5 && ampl.avgAmpl <= 8) s1 += 12;
    else if (ampl.avgAmpl >= 3 && ampl.avgAmpl <= 12) s1 += 7;
    if (ampl.amplCV < 0.5) s1 += 8;
    else if (ampl.amplCV < 0.8) s1 += 4;
    if (ampl.qualityRatio > 1.5) s1 += 5;
    else if (ampl.qualityRatio > 1.0) s1 += 2;
    
    var s2 = 0; // 震荡纯度 (30)
    if (adxResult.adx < 15) s2 += 15;
    else if (adxResult.adx < 20) s2 += 10;
    else s2 += 5;
    if (!adxResult.rising) s2 += 5;
    if (bbPos > 0.3 && bbPos < 0.7) s2 += 5;
    else if (bbPos > 0.2 && bbPos < 0.8) s2 += 3;
    if (stochCross >= 3) s2 += 5;
    else if (stochCross >= 1) s2 += 2;
    
    var s3 = 0; // 波动率 (20)
    if (!ticker || !ticker.Last) return { score: 0, reason: "无行情" };
    // ATR估算 = avgAmpl的日振幅可作为日ATR近似
    var atrPct = ampl.avgAmpl * 1.2; // 日振幅≈1.2×日ATR
    if (atrPct >= 2 && atrPct <= 5) s3 += 20;
    else if (atrPct >= 1.5 && atrPct <= 8) s3 += 10;
    else if (atrPct < 8) s3 += 3;
    
    var s4 = 0; // 成交量 (15)
    if (vol.shrinksRatio < 0.9) s4 += 8;
    else if (vol.shrinksRatio < 1.1) s4 += 4;
    if (vol.avgDailyVol * ticker.Last > MIN_VOLUME_USDT) s4 += 7;
    else if (vol.avgDailyVol * ticker.Last > 200000) s4 += 3;
    
    var s5 = 0; // 趋势排除 (10)
    if (!trend.bearishTrend) s5 += 5;
    if (!adxResult.rising) s5 += 5;
    else s5 += 2;
    
    var total = s1 + s2 + s3 + s4 + s5;
    return {
        score: total,
        breakDown: "振幅" + s1 + "+震荡" + s2 + "+波动" + s3 + "+量" + s4 + "+趋势" + s5,
        detail: {
            avgAmpl: _N(ampl.avgAmpl, 2),
            amplCV: _N(ampl.amplCV, 2),
            adx: _N(adxResult.adx, 1),
            adxRising: adxResult.rising,
            bbPos: _N(bbPos, 2),
            stochCross: stochCross,
            volShrink: _N(vol.shrinksRatio, 2),
            volSpike: _N(vol.volSpike, 2)
        }
    };
}

// ─── 主循环 ───
function main() {
    exchange.SetContractType("swap");
    exchange.SetMaxBarLen(1000);
    
    Log("震荡币筛选器启动，扫描中...");
    
    var info = exchange.IO("api", "GET", "/fapi/v1/exchangeInfo");
    var results = [];
    
    for (var i = 0; i < info.symbols.length; i++) {
        var ele = info.symbols[i];
        if (ele.contractType != "PERPETUAL" || ele.status != "TRADING" || ele.quoteAsset != "USDT") {
            continue;
        }
        
        var symbol = ele.baseAsset + "_USDT";
        exchange.SetCurrency(symbol);
        var records = _C(exchange.GetRecords, PERIOD_D1);
        
        if (!records || records.length < 30) continue;
        
        var ticker = _C(exchange.GetTicker);
        var result = scoreCoin(records, ticker);
        
        if (result.score > 0) {
            result.symbol = ele.baseAsset;
            results.push(result);
        }
    }
    
    // 按得分排序
    results.sort(function(a, b) { return b.score - a.score; });
    
    // 输出表格
    var table = {
        type: "table",
        title: "震荡币筛选结果 (Top 20)",
        cols: ["排名","币种","总分","评分明细","振幅%","ADX","BB位置","量萎缩","Stoch穿越"],
        rows: []
    };
    
    for (var i = 0; i < Math.min(results.length, 20); i++) {
        var r = results[i];
        var d = r.detail;
        table.rows.push([
            i + 1,
            r.symbol,
            r.score,
            r.breakDown,
            d.avgAmpl,
            d.adx,
            d.bbPos,
            d.volShrink,
            d.stochCross
        ]);
    }
    
    LogStatus("`" + JSON.stringify(table) + "`\n");
    Log("筛选完成，共 " + results.length + " 个候选币种");
}
```

---

## 参数速查表

| 参数 | 值 | 说明 |
|------|-----|------|
| 振幅区间 | 3%-12% | 硬过滤 |
| 理想振幅 | 5%-8% | 满分区间 |
| ADX上限 | 25 | 超过=排除 |
| ADX理想 | < 15 | 满分 |
| ATR/价格 | 2%-5% | 满分区间 |
| 量萎缩比 | < 0.9 | 震荡特征 |
| 量异动 | < 2.0× | 无异动 |
| 日成交额 | > 50万U | 流动性底线 |
| Stochastic穿越 | ≥ 3次/10根 | 震荡确认 |

---

## 保留策略列表

### 最有价值的10个参考

1. U本位网格振幅筛选 (3KB) — 振幅扫描框架
2. 动态波幅捕捉RSI-布林带策略 (10KB) — 动态中线创新
3. 结合布林带与RSI的自适应震荡趋势交易策略 (7KB) — 三重共振
4. 自适应ATR-ADX趋势策略V2 (8KB) — ADX阈值
5. 趋势确认随机震荡策略 (20KB) — ADX+Stochastic
6. 自适应范围波动率趋势跟踪交易策略 (7KB) — Keltner通道
7. 历史波动率区间突破交易策略 (9KB) — 波动率分位
8. VWAP交易策略与成交量异常监测 (17KB) — 量异常检测
9. KDJ+量筛选币种 (14KB) — 流动性过滤
10. 布林带结合超级趋势的智能波动区间交易策略 (9KB) — BB+SuperTrend
