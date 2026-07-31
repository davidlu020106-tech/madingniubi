/* ============================================================
 * 牛逼马丁不死不休 v0.1 — FMZ 主策略骨架
 * ------------------------------------------------------------
 * 语言: JavaScript (FMZ 平台原生支持，最全功能)
 * 部署: FMZ 策略编辑器直接粘贴运行
 * 
 * 当前版本: 只有马丁核心循环骨架
 * 后续加: 选币筛选 / 翻倍提取 / 风控信号 / 震荡识别
 * ============================================================ */

// ─── 马丁参数（FMZ 策略参数面板会显示） ───
var baseAmount = 10;        // 基础下单量 (USDT)
var multiplier = 1.5;       // 加仓倍数
var maxLevel = 5;           // 最大加仓层数
var targetProfit = 20;      // 单轮目标利润 (USDT)
var distancePercent = 0.5;  // 挂单距离百分比 (0.5%)
var leverage = 5;           // 杠杆倍数

// ─── 全局状态（用 _G 持久化，重启不丢） ───
var state = {
    level: 1,               // 当前加仓层数
    roundCount: 0,          // 已完成轮次
    totalInvested: 0,       // 本轮累计投入
};

function getState() {
    var saved = _G("martinState");
    if (!saved) {
        saved = {
            level: 1,
            roundCount: 0,
            totalInvested: 0
        };
    }
    return saved;
}

function saveState(s) {
    _G("martinState", s);
}

function resetState() {
    _G("martinState", null);
}

// ─── 获取账户权益 ───
function getEquity() {
    var acc = _C(exchange.GetAccount);
    return acc.Balance;
}

// ─── 撤掉所有挂单 ───
function cancelAll() {
    while (true) {
        var orders = _C(exchange.GetOrders);
        if (orders.length == 0) {
            break;
        }
        for (var i = 0; i < orders.length; i++) {
            exchange.CancelOrder(orders[i].Id, orders[i]);
            Sleep(200);
        }
        Sleep(200);
    }
}

// ─── 统一下单（开仓/平仓） ───
function trade(direction, price, amount) {
    exchange.SetDirection(direction);
    if (direction == "buy") {
        return exchange.Buy(price, amount);
    } else if (direction == "closebuy") {
        return exchange.Sell(price, amount);
    } else if (direction == "sell") {
        return exchange.Sell(price, amount);
    } else if (direction == "closesell") {
        return exchange.Buy(price, amount);
    }
}

// ─── 主循环 ───
function main() {
    // 初始化合约
    exchange.SetContractType("swap");
    exchange.SetPrecision(2, 2);
    exchange.SetMarginLevel(leverage);

    Log("牛逼马丁不死不休 v0.1 启动");
    Log("参数: baseAmount=", baseAmount, " multiplier=", multiplier,
        " maxLevel=", maxLevel, " targetProfit=", targetProfit);

    var st = getState();
    var initialEquity = getEquity();
    Log("初始权益: ", initialEquity, " 当前层数: ", st.level);

    while (true) {
        var ticker = _C(exchange.GetTicker);
        var price = ticker.Last;
        var pos = _C(exchange.GetPosition);

        if (pos.length == 0) {
            // ─── 无持仓：开第一单 ───
            var distance = price * distancePercent / 100;
            Log("开第一单: 买入 ", baseAmount, " @ ", _N(price - distance, 2));
            trade("buy", price - distance, baseAmount);
            st.level = 1;
            saveState(st);
        } else {
            // ─── 有持仓：检查是否止盈或加仓 ───
            var p = pos[0];
            var profit = p.Profit;

            if (profit >= targetProfit) {
                // 达到目标 → 平仓，本轮结束
                Log("🎯 目标利润达成! 盈利 ", _N(profit, 2), " USDT, 平仓");
                trade("closebuy", price, p.Amount);
                st.roundCount++;
                st.totalInvested = 0;
                saveState(st);
                LogProfit(getEquity() - initialEquity + (st.roundCount > 1 ? 0 : 0));
            } else if (st.level < maxLevel) {
                // 浮亏 → 加仓（马丁核心）
                var lossDistance = price * distancePercent / 100;
                var addAmount = baseAmount * Math.pow(multiplier, st.level);
                Log("📉 浮亏 ", _N(profit, 2), "，马丁加仓第", st.level + 1, "层: ",
                    addAmount, " @ ", _N(price - lossDistance, 2));
                trade("buy", price - lossDistance, addAmount);
                st.level++;
                st.totalInvested += addAmount;
                saveState(st);
            } else {
                // 已达最大层数 → 等止盈或外部信号
                Log("⚠️ 已达最大层数 ", maxLevel, "，等待止盈/信号");
            }
        }

        Sleep(5000); // 5秒一轮
    }
}

// ─── 策略停止时清理 ───
function onexit() {
    Log("策略停止，撤销所有挂单");
    cancelAll();
}
