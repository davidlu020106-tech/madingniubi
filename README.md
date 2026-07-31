# 牛逼马丁不死不休 💪

选币+马丁翻倍 合一量化交易系统 — FMZ 一键部署

[![震荡币扫描](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml/badge.svg)](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml)

## 🚀 一键部署

打开 FMZ → 新建策略 → JavaScript → 粘贴 `fmz_combined.js` → 配置 OKX 合约 → 运行

**逻辑**: 启动自动扫全市场选震荡币 → 在最优币上跑马丁翻倍 → 回撤/趋势反转自动换币

## 文件

| 文件 | 说明 |
|------|------|
| **`fmz_combined.js`** | ★ **选币+马丁合一**（FMZ部署） |
| `fmz_double_martin.js` | 马丁翻倍独立版 |
| `fmz_martin.js` | 马丁核心骨架 |
| `coin_scanner.js` | Node.js 选币器（CI） |

## 参数

`5x杠杆 × 2.0倍加仓 × 10层` | 止盈20U | 回撤40%锁死 | 24h重扫描

## 文档

`docs/strategy_design.md` — 策略设计（99+策略分析来源）
