# 台股即時進場分析系統

## 功能
- 🔍 輸入任意台股代碼即時查詢（TWSE 官方 API）
- 📊 RSI / MACD / KD / 布林帶技術指標
- 🎯 AI 進出場分析（需要 Anthropic API Key）
- ▶ 每 10 秒自動刷新現價

## 部署到 Vercel

### 方法一：直接 import GitHub repo（推薦）
1. 將此資料夾推到你的 GitHub repo
2. 前往 vercel.com → New Project → Import Git Repository
3. 選擇此 repo，Vercel 自動偵測 React 設定
4. 點 Deploy，約 1 分鐘完成

### 方法二：Vercel CLI
```bash
npm i -g vercel
vercel --prod
```

## 本地開發
```bash
npm install
npm start
```

## 注意事項
- TWSE API 僅在台灣交易時段（09:00-13:30）提供即時報價
- AI 分析功能需要 Anthropic API Key（可在 console.anthropic.com 取得）
- API Key 僅存在瀏覽器本地，不會上傳到伺服器
