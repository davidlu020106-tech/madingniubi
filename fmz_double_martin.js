/* ============================================================
 * 牛逼马丁不死不休 — 翻倍策略 v2.0 (FMZ JavaScript)
 * ============================================================
 * 设计来源: 99+ FMZ策略深度分析
 *   - 杠杆化马丁(multiplier=2.0, 10层) + MACD-KDJ双确认入场
 *   - 数字货币期货马丁框架 + 暴力马丁的分仓思路
 *   - 回撤40%锁死 + 均线反转信号全平
 *
 * 部署: FMZ策略编辑器 → 新建JS策略 → 粘贴 → 配置交易所 → 运行
 * ============================================================ */

// ═══════════════════════════════════════════════════════════
// 参数（FMZ参数面板可调）
// ═══════════════════════════════════════════════════════════
var LEVERAGE = 5;           // 杠杆倍数 (3-5安全, 10激进)
var BASE_AMOUNT = 10;       // 第一单USDT
var MULTIPLIER = 2.0;       // 加仓倍数 (2.0=翻倍加仓)
var MAX_LEVEL = 10;         // 最大层数 (10层≈扛10%回撤)
var DISTANCE_PCT = 1.0;     // 加仓触发距离% (跌1%触发)
var REBOUND_PCT = 0.3;      // 反弹确认% (反弹0.3%才加仓)
var TARGET_PROFIT = 20;     // 止盈目标USDT
var MAX_DRAWDOWN = 0.40;    // 回撤锁死 40%
var FUND_SPLIT = 3;         // 资金分3份

// ═══════════════════════════════════════════════════════════
// 全局状态（_G持久化，重启不丢）
// ═══════════════════════════════════════════════════════════
function loadState() {
    return _G("nbmb") || {
        level: 1,            // 当前层数
        round: 0,            // 完成轮次
        peakEquity: 0,       // 历史峰值权益
        locked: false,       // 回撤锁死标志
        fundIndex: 0,        // 当前第几份资金
        totalExtracted: 0,   // 累计提取利润
    };
}
function saveState(st) { _G("nbmb", st); }

// ═══════════════════════════════════════════════════════════
// 技术指标（FMZ有TA库但保险起见自己算）
// ═══════════════════════════════════════════════════════════
function EMA(records, period) {
    var a = 2 / (period + 1);
    var ema = [records[0].Close];
    for (var i = 1; i < records.length; i++) {
        ema.push(a * records[i].Close + (1 - a) * ema[i - 1]);
    }
    return ema;
}

function MACD(records) {
    var ema12 = EMA(records, 12), ema26 = EMA(records, 26);
    var dif = [], dea = [], macd = [];
    for (var i = 0; i < ema12.length; i++) {
        dif.push(ema12[i] - ema26[i]);
    }
    var a = 2 / 10; // dea周期=9
    dea[0] = dif[0];
    for (var j = 1; j < dif.length; j++) {
        dea.push(a * dif[j] + (1 - a) * dea[j - 1]);
        macd.push(2 * (dif[j] - dea[j]));
    }
    return { dif: dif, dea: dea, macd: macd };
}

function KDJ(records, period) {
    period = period || 9;
    var k = [], d = [], j = [], len = records.length;
    if (len < period) return { k: [], d: [], j: [] };
    k[period - 1] = 50; d[period - 1] = 50;
    for (var i = period; i < len; i++) {
        var slice = records.slice(i - period + 1, i + 1);
        var hh = Math.max.apply(null, slice.map(function(r) { return r.High; }));
        var ll = Math.min.apply(null, slice.map(function(r) { return r.Low; }));
        var rsv = (records[i].Close - ll) / (hh - ll) * 100;
        k[i] = 2 / 3 * k[i - 1] + 1 / 3 * rsv;
        d[i] = 2 / 3 * d[i - 1] + 1 / 3 * k[i];
        j[i] = 3 * k[i] - 2 * d[i];
    }
    return { k: k, d: d, j: j };
}

function crossOver(a, b, idx) {
    return a[idx] > b[idx] && a[idx - 1] <= b[idx - 1];
}

function crossUnder(a, b, idx) {
    return a[idx] < b[idx] && a[idx - 1] >= b[idx - 1];
}

// ═══════════════════════════════════════════════════════════
// 入场信号（MACD+KDJ双确认 → 保证首轮成功率）
// ═══════════════════════════════════════════════════════════
function entrySignal(records) {
    var len = records.length;
    if (len < 30) return { signal: false, reason: "数据不足" };

    var macd = MACD(records);
    var kdj = KDJ(records, 9);
    var ema7 = EMA(records, 7), ema25 = EMA(records, 25);
    var last = len - 1;

    var macdGolden = crossOver(macd.dif, macd.dea, last);  // MACD金叉
    var kdjGolden  = kdj.k && crossOver(kdj.k, kdj.d, last) || false; // KDJ金叉
    var bullish = ema7[last] > ema25[last];                 // 多头排列

    if (macdGolden && kdjGolden && bullish) {
        return { signal: true, reason: "MACD+KDJ双金叉+多头排列", confidence: "高" };
    }
    if (macdGolden && bullish) {
        return { signal: true, reason: "MACD金叉+多头排列", confidence: "中" };
    }
    return { signal: false, reason: "信号不满足" };
}

// ═══════════════════════════════════════════════════════════
// 终止信号（趋势反转 / 回撤锁死）
// ═══════════════════════════════════════════════════════════
function stopSignal(records, st, currentEquity) {
    var len = records.length, last = len - 1;

    // 1. 回撤锁死
    if (st.peakEquity > 0) {
        var dd = (st.peakEquity - currentEquity) / st.peakEquity;
        if (dd >= MAX_DRAWDOWN) {
            return { stop: true, reason: "回撤" + (dd * 100).toFixed(0) + "%触发锁死!", lock: true };
        }
    }

    // 2. 均线反转
    var ema7 = EMA(records, 7), ema25 = EMA(records, 25);
    if (ema7[last] < ema25[last]) {
        // 死叉 = 趋势转空
        return { stop: true, reason: "EMA7<EMA25 空头趋势反转!", lock: false };
    }

    // 3. 波动率尖峰（可选）
    // TODO: ATR×5触发暂停

    return { stop: false, reason: "", lock: false };
}

// ═══════════════════════════════════════════════════════════
// 账户操作
// ═══════════════════════════════════════════════════════════
function getEquity() {
    var acc = _C(exchange.GetAccount);
    return acc ? acc.Balance : -1;
}

function cancelAll() {
    while (true) {
        var orders = _C(exchange.GetOrders);
        if (!orders || orders.length === 0) break;
        for (var i = 0; i < orders.length; i++) {
            exchange.CancelOrder(orders[i].Id, orders[i]);
            Sleep(200);
        }
        Sleep(200);
    }
}

function myTrade(dir, price, amount) {
    exchange.SetDirection(dir);
    if (dir === "buy") return exchange.Buy(price, amount);
    if (dir === "closebuy") return exchange.Sell(price, amount);
    if (dir === "sell") return exchange.Sell(price, amount);
    if (dir === "closesell") return exchange.Buy(price, amount);
}

// ═══════════════════════════════════════════════════════════
// 主循环
// ═══════════════════════════════════════════════════════════
function main() {
    exchange.SetContractType("swap");
    exchange.SetMarginLevel(LEVERAGE);
    exchange.SetPrecision(2, 2);

    var st = loadState();
    var initialEquity = getEquity();
    if (st.peakEquity === 0) st.peakEquity = initialEquity;

    Log("🚀 牛逼马丁翻倍策略 v2.0");
    Log("杠杆=" + LEVERAGE + "x 倍率=" + MULTIPLIER + "x 层数=" + MAX_LEVEL + " 回撤锁=" + (MAX_DRAWDOWN * 100) + "%");
    Log("当前第" + st.fundIndex + "份资金 第" + st.round + "轮 层数" + st.level);

    // 检查回撤锁死状态
    if (st.locked) {
        Log("⚠️ 已被回撤锁死! 等待解锁...");
        // 这里是永久锁死，除非手动重置 _G
        while (true) { Sleep(60000); }
    }

    while (true) {
        var ticker = _C(exchange.GetTicker);
        var price = ticker.Last;
        var pos = _C(exchange.GetPosition);
        var records = _C(exchange.GetRecords, PERIOD_M5);
        var equity = getEquity();

        // 更新峰值
        if (equity > st.peakEquity) st.peakEquity = equity;

        // ─── 检查终止信号 ───
        var stop = stopSignal(records, st, equity);
        if (stop.stop) {
            Log("🛑 终止信号: " + stop.reason);
            cancelAll();
            if (pos.length > 0) {
                myTrade(pos[0].Type === 0 ? "closebuy" : "closesell", price, pos[0].Amount);
            }
            if (stop.lock) {
                st.locked = true;
                saveState(st);
                Log("🔒 系统已锁死");
                while (true) { Sleep(60000); }
            }
            st.level = 1;
            saveState(st);
            continue;
        }

        // ─── 无持仓 → 等入场信号 ───
        if (pos.length === 0) {
            var signal = entrySignal(records);
            if (signal.signal) {
                Log("🎯 入场信号: " + signal.reason);
                var dist = price * DISTANCE_PCT / 100;
                myTrade("buy", price - dist, BASE_AMOUNT);
                st.level = 1;
                saveState(st);
            }
        }

        // ─── 有多仓 → 马丁管理 ───
        if (pos.length > 0 && pos[0].Type === 0) {
            var p = pos[0];
            var profit = p.Profit;

            // 止盈
            if (profit >= TARGET_PROFIT) {
                Log("💰 止盈! 盈利" + profit.toFixed(2) + "USDT");
                myTrade("closebuy", price, p.Amount);
                st.round++;
                st.level = 1;

                // 检查翻倍
                if (equity >= initialEquity * 2) {
                    var extracted = initialEquity + (equity - initialEquity) * 0.5;
                    st.totalExtracted += extracted;
                    Log("🎉 翻倍! 建议提取" + extracted.toFixed(2) + "USDT");
                    // FMZ上可调 exchange.IO 划转
                }

                LogProfit(equity - initialEquity);
                saveState(st);
                continue;
            }

            // 加仓条件: 跌了DISTANCE_PCT%，然后反弹REBOUND_PCT%
            var addPrice = p.Price - p.Price * DISTANCE_PCT / 100;
            var reboundPrice = price; // 当前价就是反弹价
            var lowestSince = _G("nbmb_lowest") || price;
            if (price < lowestSince) _G("nbmb_lowest", price);
            if (price > lowestSince * (1 + REBOUND_PCT / 100) && price <= addPrice && st.level < MAX_LEVEL) {
                var addAmount = BASE_AMOUNT * Math.pow(MULTIPLIER, st.level);
                Log("📉 马丁加仓 第" + (st.level + 1) + "层: " + addAmount.toFixed(2) + " USDT @ " + price.toFixed(4));
                cancelAll(); // 撤销之前的止盈单
                myTrade("buy", price, addAmount);
                st.level++;
                _G("nbmb_lowest", price);
                saveState(st);
                continue;
            }

            // 挂止盈单
            var takeProfitPrice = p.Price + p.Price * TARGET_PROFIT / 100;
            var orders = _C(exchange.GetOrders);
            var hasTP = orders.some(function(o) { return o.Type === 1; }); // 1=SELL
            if (!hasTP) {
                myTrade("closebuy", Math.max(takeProfitPrice, price + TARGET_PROFIT), p.Amount);
            }
        }

        saveState(st);
        Sleep(5000);
    }
}

function onexit() {
    Log("退出，撤销所有挂单");
    cancelAll();
}
