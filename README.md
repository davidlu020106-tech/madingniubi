# 牛逼马丁不死不休 💪

马丁内核 + 可插拔模块的量化交易系统

[![震荡币扫描](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml/badge.svg)](https://github.com/davidlu020106-tech/madingniubi/actions/workflows/daily_scan.yml)

## 运行方式

| 文件 | 用途 | 怎么跑 |
|------|------|--------|
| `coin_scanner.js` | **选币器** ★ | `node coin_scanner.js` 或 GitHub Actions 自动跑 |
| `fmz_martin.js` | 马丁策略 | 粘贴到 FMZ 策略编辑器 |
| `fmz_coin_scanner.js` | 选币器(FMZ版) | 粘贴到 FMZ 策略编辑器 |

## 选币 5维评分

`振幅(25) + 震荡纯度(30) + 波动率(20) + 成交量(15) + 趋势(10) = 100分`

- 振幅 3%-12%，ADX < 25，无异动放量 → 候选
- 得分 ≥ 70 → ⭐推荐，≥ 80 → 🔥强烈推荐

## CI 自动扫描

每天北京时间 8:00 和 20:00 自动跑 `coin_scanner.js`，结果在 [Actions](https://github.com/davidlu020106-tech/madingniubi/actions) 页面查看。

## 设计文档

- `docs/coin_screener_design.md` — 5维评分系统完整设计
- `docs/coin_screening_analysis.md` — 120个FMZ策略分析
- `docs/fmz_references.md` — FMZ参考策略索引
