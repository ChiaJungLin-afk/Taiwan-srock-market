// Vercel Serverless Function - 後端股價查詢，解決 CORS 問題
export default async function handler(req, res) {
  // 允許所有來源
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Missing code" });

  // 1) 先試 TWSE 盤中即時
  for (const mkt of ["tse", "otc"]) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${mkt}_${code}.tw&json=1&delay=0&_=${Date.now()}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      const d = data?.msgArray?.[0];
      if (!d) continue;
      const price = parseFloat(d.z) || parseFloat(d.y) || null;
      if (!price) continue;
      return res.json({
        code, name: d.n?.trim() || code,
        price, prev: parseFloat(d.y) || price,
        open: parseFloat(d.o) || null,
        high: parseFloat(d.h) || null,
        low: parseFloat(d.l) || null,
        vol: parseInt(d.v) || null,
        time: d.t || null,
        live: !!parseFloat(d.z),
        source: "TWSE",
      });
    } catch {}
  }

  // 2) 非交易時段 → Yahoo Finance（後端呼叫無 CORS 限制）
  for (const suffix of [".TW", ".TWO"]) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=5d`;
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(6000),
      });
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      const q = data?.chart?.result?.[0]?.indicators?.quote?.[0];
      const closes = q?.close?.filter(Boolean) || [];
      if (meta && closes.length >= 2) {
        const price = closes.at(-1);
        const prev  = closes.at(-2);
        return res.json({
          code,
          name: meta.shortName || meta.longName || code,
          price, prev,
          open: q.open?.at(-1) || null,
          high: q.high?.at(-1) || null,
          low:  q.low?.at(-1)  || null,
          vol:  q.volume?.at(-1) || null,
          time: "最新收盤",
          live: false,
          source: "Yahoo",
        });
      }
    } catch {}
  }

  return res.status(404).json({ error: `找不到股票代碼 ${code}` });
}
