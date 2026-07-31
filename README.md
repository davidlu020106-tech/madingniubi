# 牛逼马丁不死不休 💪

快速翻倍 + 接受爆仓 + 信号止损 — 马丁量化交易系统

[![震荡币扫描](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml/badge.svg)](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml)

## 文件速查

| 文件 | 用途 | 在哪跑 |
|------|------|--------|
| `coin_scanner.js` | ✅ 选币器（5维评分） | `node` / GitHub Actions |
| `fmz_double_martin.js` | ✅ **翻倍马丁策略**（新） | FMZ 策略编辑器 |
| `fmz_martin.js` | 马丁核心骨架 | FMZ |
| `fmz_coin_scanner.js` | 选币器(FMZ版) | FMZ |

## 策略设计

**三层架构**: 入场信号(MACD+KDJ) → 马丁翻倍(multiplier=2.0,10层) → 信号终止(回撤40%+均线反转)

详见 `docs/strategy_design.md`

## CI

每天 8:00/20:00 自动扫描 → [Actions](https://github.com/davidlu020106-tech/madingniubi/actions)
