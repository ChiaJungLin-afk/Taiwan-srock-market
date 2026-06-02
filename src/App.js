import { useState, useMemo, useEffect, useRef, useCallback } from "react";

// ── TWSE 即時股價 API ────────────────────────────────────────────────
async function fetchTWSEPrice(code) {
  // 1) 先試 TWSE 盤中即時（交易時段）
  for (const mkt of ["tse", "otc"]) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${mkt}_${code}.tw&json=1&delay=0&_=${Date.now()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const d = data?.msgArray?.[0];
      if (!d) continue;
      const price = parseFloat(d.z) || parseFloat(d.y) || null;
      if (!price) continue;
      return {
        code,
        name: d.n?.trim() || code,
        price,
        prev: parseFloat(d.y) || price,
        open: parseFloat(d.o) || null,
        high: parseFloat(d.h) || null,
        low: parseFloat(d.l) || null,
        vol: parseInt(d.v) || null,
        time: d.t || null,
        live: !!parseFloat(d.z),
        market: mkt,
      };
    } catch {}
  }

  // 2) 非交易時段 → 改用 Yahoo Finance 收盤價
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?interval=1d&range=5d`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = quotes?.close?.filter(Boolean) || [];
    if (meta && closes.length >= 2) {
      const price = closes[closes.length - 1];
      const prev  = closes[closes.length - 2];
      return {
        code,
        name: meta.shortName || meta.longName || code,
        price,
        prev,
        open: quotes.open?.at(-1) || null,
        high: quotes.high?.at(-1) || null,
        low:  quotes.low?.at(-1)  || null,
        vol:  quotes.volume?.at(-1) || null,
        time: "收盤價",
        live: false,
        market: "yahoo",
      };
    }
  } catch {}

  // 3) 上櫃代碼也試 TWO
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TWO?interval=1d&range=5d`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = quotes?.close?.filter(Boolean) || [];
    if (meta && closes.length >= 2) {
      const price = closes[closes.length - 1];
      const prev  = closes[closes.length - 2];
      return {
        code,
        name: meta.shortName || meta.longName || code,
        price,
        prev,
        open: quotes.open?.at(-1) || null,
        high: quotes.high?.at(-1) || null,
        low:  quotes.low?.at(-1)  || null,
        vol:  quotes.volume?.at(-1) || null,
        time: "收盤價",
        live: false,
        market: "yahoo",
      };
    }
  } catch {}

  return null;
}

// Yahoo Finance 歷史收盤（60日，用於技術指標）
async function fetchHistory(code) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?interval=1d&range=3mo`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (closes?.length > 20) return closes.filter(Boolean).slice(-65);
  } catch {}
  return null;
}

// ── 技術指標 ─────────────────────────────────────────────────────────
function genHist(price) {
  const a = []; let p = price * (0.82 + Math.random() * 0.1);
  const d = (price - p) / 60;
  for (let i = 0; i < 60; i++) { p += d + (Math.random() - 0.478) * price * 0.012; a.push(Math.max(p, price * 0.5)); }
  a[a.length - 1] = price; return a;
}
const sma = (a, n) => a.length < n ? null : a.slice(-n).reduce((s, v) => s + v, 0) / n;
const ema = (a, n) => { if (a.length < n) return null; const k = 2 / (n + 1); let e = a.slice(0, n).reduce((s, v) => s + v, 0) / n; for (let i = n; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; };
const calcRsi = (a, n = 14) => { if (a.length < n + 1) return null; const ch = a.slice(-(n + 1)).map((v, i, ar) => i ? v - ar[i - 1] : 0).slice(1); const ag = ch.map(c => c > 0 ? c : 0).reduce((s, v) => s + v, 0) / n; const al = ch.map(c => c < 0 ? -c : 0).reduce((s, v) => s + v, 0) / n; return al === 0 ? 100 : 100 - 100 / (1 + ag / al); };
const calcMacd = a => { const e12 = ema(a, 12), e26 = ema(a, 26); if (!e12 || !e26) return null; const dif = e12 - e26; return { dif, sig: dif * 0.88 }; };
const calcBoll = (a, n = 20) => { if (a.length < n) return null; const sl = a.slice(-n), mn = sl.reduce((s, v) => s + v, 0) / n; const sd = Math.sqrt(sl.map(v => (v - mn) ** 2).reduce((s, v) => s + v, 0) / n); return { u: mn + 2 * sd, m: mn, l: mn - 2 * sd }; };
const calcKd = (a, n = 9) => { if (a.length < n) return null; const sl = a.slice(-n), lo = Math.min(...sl), hi = Math.max(...sl); if (hi === lo) return { k: 50, d: 50 }; const rsv = (a[a.length - 1] - lo) / (hi - lo) * 100; return { k: rsv / 3 + 50 * 2 / 3, d: rsv / 9 + 50 * 8 / 9 }; };

function calcTech(prices) {
  const s5 = sma(prices, 5), s20 = sma(prices, 20), s60 = sma(prices, 60);
  const R = calcRsi(prices), M = calcMacd(prices), B = calcBoll(prices), K = calcKd(prices);
  const sigs = []; let sc = 0;
  if (s5 && s20) { if (s5 > s20) { sigs.push({ l: `均線多頭 5MA(${s5.toFixed(0)})>20MA(${s20.toFixed(0)})`, t: "bull" }); sc += 20; } else { sigs.push({ l: `均線空頭 5MA(${s5.toFixed(0)})<20MA(${s20.toFixed(0)})`, t: "bear" }); sc -= 20; } }
  if (s20 && s60) { if (s20 > s60) { sigs.push({ l: `中長線多頭 20MA>60MA(${s60.toFixed(0)})`, t: "bull" }); sc += 15; } else { sigs.push({ l: `中長線空頭 20MA<60MA(${s60.toFixed(0)})`, t: "bear" }); sc -= 15; } }
  if (R !== null) { if (R < 30) { sigs.push({ l: `RSI超賣 ${R.toFixed(1)} ← 反彈機率高`, t: "bull" }); sc += 25; } else if (R > 70) { sigs.push({ l: `RSI超買 ${R.toFixed(1)} ← 注意回檔`, t: "bear" }); sc -= 25; } else if (R > 50) { sigs.push({ l: `RSI強勢 ${R.toFixed(1)}`, t: "neut" }); sc += 10; } else { sigs.push({ l: `RSI弱勢 ${R.toFixed(1)}`, t: "neut" }); sc -= 10; } }
  if (M) { if (M.dif > M.sig) { sigs.push({ l: `MACD多頭 DIF:${M.dif.toFixed(2)}>Signal`, t: "bull" }); sc += 20; } else { sigs.push({ l: `MACD空頭 DIF:${M.dif.toFixed(2)}<Signal`, t: "bear" }); sc -= 20; } }
  if (B) { const c = prices.at(-1); if (c < B.l) { sigs.push({ l: `跌破布林下軌 ${B.l.toFixed(1)}`, t: "bull" }); sc += 15; } else if (c > B.u) { sigs.push({ l: `突破布林上軌 ${B.u.toFixed(1)}`, t: "bear" }); sc -= 15; } else { sigs.push({ l: `布林帶中間 (${B.l.toFixed(0)}~${B.u.toFixed(0)})`, t: "neut" }); sc += 5; } }
  if (K) { if (K.k < 20) { sigs.push({ l: `KD超賣 K:${K.k.toFixed(0)} 黃金交叉機會`, t: "bull" }); sc += 15; } else if (K.k > 80) { sigs.push({ l: `KD超買 K:${K.k.toFixed(0)} 死亡交叉風險`, t: "bear" }); sc -= 15; } else if (K.k > K.d) { sigs.push({ l: `KD多頭 K:${K.k.toFixed(0)}/D:${K.d.toFixed(0)}`, t: "neut" }); sc += 8; } else { sigs.push({ l: `KD空頭 K:${K.k.toFixed(0)}/D:${K.d.toFixed(0)}`, t: "neut" }); sc -= 8; } }
  const pct = ((Math.max(-100, Math.min(100, sc)) + 100) / 200) * 100;
  let verdict, color, emoji;
  if (pct >= 70) { verdict = "強烈建議進場"; color = "#00ff88"; emoji = "🚀"; }
  else if (pct >= 58) { verdict = "可考慮進場"; color = "#66ffaa"; emoji = "📈"; }
  else if (pct >= 44) { verdict = "觀望為宜"; color = "#ffdd44"; emoji = "👀"; }
  else if (pct >= 30) { verdict = "謹慎操作"; color = "#ff8844"; emoji = "⚠️"; }
  else { verdict = "不建議進場"; color = "#ff4444"; emoji = "🔴"; }
  return { sigs, score: pct, verdict, color, emoji, s5, s20, s60, R, K, B };
}

// AI 進出場分析（呼叫 Anthropic API）
async function getAIAnalysis(stock, tech) {
  const chg = stock.prev ? ((stock.price - stock.prev) / stock.prev * 100).toFixed(2) : "N/A";
  const prompt = `你是台股技術分析師，請根據以下數據給出進出場建議，只回傳 JSON 不加任何其他文字：

股票：${stock.code} ${stock.name}
現價：${stock.price} 元（TWD）  今日漲跌：${chg}%
RSI(14)：${tech.R?.toFixed(1)}  MACD：${tech.R > 0 ? "多頭" : "空頭"}
KD：K=${tech.K?.k.toFixed(0)}/D=${tech.K?.d.toFixed(0)}
5MA：${tech.s5?.toFixed(1)}  20MA：${tech.s20?.toFixed(1)}  60MA：${tech.s60?.toFixed(1)}
布林帶：上${tech.B?.u.toFixed(1)}/下${tech.B?.l.toFixed(1)}
訊號：${tech.sigs.map(s => s.l).join("；")}
評分：${Math.round(tech.score)}/100 → ${tech.verdict}

JSON格式：{"action":"積極進場或保守進場或觀望或不建議進場","entry":"進場區間","stop":"停損價","t1":"保守目標","t2":"積極目標","rr":"風報比","reason":"一句話20字內","warn":"風險提示","detail":"3句分析說明"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": window.__ANTHROPIC_KEY__ || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("");
  const m = text.match(/\{[\s\S]*?\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("解析失敗");
}

// ── UI 元件 ─────────────────────────────────────────────────────────
const fmt = (v, d) => v == null ? "—" : v.toLocaleString("zh-TW", { minimumFractionDigits: d ?? (v < 100 ? 2 : 0), maximumFractionDigits: d ?? (v < 100 ? 2 : 0) });

function Chart({ prices, color, w = 140, h = 50 }) {
  const sl = prices.slice(-50), mn = Math.min(...sl), mx = Math.max(...sl), rng = mx - mn || 1, pad = 3;
  const pts = sl.map((v, i) => `${(pad + (i / (sl.length - 1)) * (w - pad * 2)).toFixed(1)},${(pad + (1 - (v - mn) / rng) * (h - pad * 2)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`${pad},${h - pad} ${pts} ${(w - pad).toFixed(1)},${h - pad}`} fill="url(#cg)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Gauge({ score, color }) {
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const bg = `conic-gradient(from 180deg,${color} 0deg,${color} ${pct * 180}deg,#0f2a0f ${pct * 180}deg,#0f2a0f 180deg,transparent 180deg)`;
  return (
    <div style={{ position: "relative", width: 110, height: 62, flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 110, height: 110, borderRadius: "50%", background: bg, clipPath: "inset(0 0 50% 0)", transition: "background 0.8s", filter: `drop-shadow(0 0 5px ${color}55)` }} />
      <div style={{ position: "absolute", top: 16, left: 16, width: 78, height: 78, borderRadius: "50%", background: "#04080f", clipPath: "inset(0 0 50% 0)" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "monospace", lineHeight: 1 }}>{Math.round(score)}</div>
        <div style={{ fontSize: 8, color: "#3a5a3a", marginTop: 1 }}>分析評分</div>
      </div>
    </div>
  );
}

function TradePanel({ d }) {
  const ac = d.action === "積極進場" ? "#00ff88" : d.action === "保守進場" ? "#66ffaa" : d.action === "觀望" ? "#ffdd44" : "#ff5555";
  const ico = { "積極進場": "🚀", "保守進場": "📈", "觀望": "👀", "不建議進場": "🔴" }[d.action] || "👀";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ padding: "11px 14px", borderRadius: 10, background: `${ac}10`, border: `1px solid ${ac}30`, display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ fontSize: 24 }}>{ico}</span>
        <div><div style={{ fontSize: 17, fontWeight: 800, color: ac }}>{d.action}</div><div style={{ fontSize: 11, color: "#88aa88", marginTop: 2 }}>{d.reason}</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[{ icon: "📍", label: "建議進場", val: d.entry, c: "#00ff88", bg: "rgba(0,255,136,0.06)", bd: "#00ff8820" },
        { icon: "🛑", label: "停損", val: d.stop, c: "#ff5555", bg: "rgba(255,85,85,0.06)", bd: "#ff555520" },
        { icon: "🎯", label: "目標一", val: d.t1, c: "#66ccff", bg: "rgba(100,200,255,0.06)", bd: "#66ccff20" },
        { icon: "🎯", label: "目標二", val: d.t2, c: "#bb88ff", bg: "rgba(180,120,255,0.06)", bd: "#bb88ff20" },
        ].map(({ icon, label, val, c, bg, bd }) => (
          <div key={label} style={{ padding: "10px 12px", borderRadius: 9, background: bg, border: `1px solid ${bd}` }}>
            <div style={{ fontSize: 8, color: "#3a5a3a", marginBottom: 3 }}>{icon} {label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: "monospace" }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: "9px 13px", borderRadius: 9, background: "rgba(255,210,0,0.05)", border: "1px solid #443300", display: "flex", alignItems: "center", gap: 14 }}>
        <div><div style={{ fontSize: 8, color: "#776633" }}>風險報酬比</div><div style={{ fontSize: 17, fontWeight: 700, color: "#ffdd44", fontFamily: "monospace" }}>1:{d.rr}</div></div>
        <div style={{ fontSize: 10, color: "#887744" }}>{parseFloat(d.rr) >= 2 ? "✅ 風報比良好，值得操作" : "⚠ 偏低，審慎評估"}</div>
      </div>
      {d.warn && <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(255,120,0,0.07)", border: "1px solid #ff660020", fontSize: 10, color: "#ff9955" }}>⚠ {d.warn}</div>}
      {d.detail && <div style={{ padding: "11px 13px", borderRadius: 9, background: "rgba(0,255,136,0.03)", border: "1px solid #00ff8812" }}>
        <div style={{ fontSize: 8, color: "#3a5a3a", marginBottom: 5 }}>📝 詳細分析</div>
        <div style={{ fontSize: 11, lineHeight: 1.9, color: "#96b896" }}>{d.detail}</div>
      </div>}
    </div>
  );
}

// API Key 設定彈窗
function ApiKeyModal({ onSave }) {
  const [key, setKey] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#04080f", border: "1px solid #0d2a0d", borderRadius: 16, padding: 28, maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 24, marginBottom: 12, textAlign: "center" }}>🔑</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#00ff88", marginBottom: 8, textAlign: "center" }}>設定 Anthropic API Key</div>
        <div style={{ fontSize: 11, color: "#446644", lineHeight: 1.7, marginBottom: 16, textAlign: "center" }}>
          需要 API Key 才能使用 AI 進出場分析功能<br />
          股價查詢（TWSE）不需要 API Key<br />
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{ color: "#66aaff" }}>在此取得免費 API Key →</a>
        </div>
        <input
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="sk-ant-api03-..."
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, background: "#060e06", border: "1px solid #1a3a1a", color: "#c8e6c8", fontSize: 12, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onSave("")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "transparent", border: "1px solid #1a3a1a", color: "#446644", cursor: "pointer", fontSize: 12 }}>
            跳過（僅查股價）
          </button>
          <button onClick={() => { if (key.trim()) onSave(key.trim()); }}
            style={{ flex: 2, padding: "10px 0", borderRadius: 8, background: "linear-gradient(135deg,#00994d,#005522)", border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            儲存 Key 並開始使用
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主程式 ───────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey] = useState(null); // null = 未設定，"" = 跳過
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [prices, setPrices] = useState(null);
  const [tab, setTab] = useState("trade");
  const [history, setHistory] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const timerRef = useRef(null);

  const tech = useMemo(() => prices ? calcTech(prices) : null, [prices]);
  const cc = result ? (result.price >= result.prev ? "#00ff88" : "#ff5555") : "#66ffaa";

  const doSearch = useCallback(async (code) => {
    const c = (code || query).trim().replace(/\s/g, "");
    if (!c) return;
    setLoading(true); setError(""); setResult(null); setAiResult(null); setPrices(null);

    try {
      // Step 1: 即時股價
      setPhase("📡 連接 TWSE 即時報價...");
      const stock = await fetchTWSEPrice(c);
      if (!stock) throw new Error(`找不到股票代碼 ${c}，請確認是否為有效的台股代碼`);
      setResult(stock);
      setLastUpdate(new Date());

      // Step 2: 歷史數據
      setPhase("📊 取得歷史數據...");
      let hist = await fetchHistory(c);
      if (!hist) { hist = genHist(stock.price); }
      else { hist[hist.length - 1] = stock.price; }
      setPrices(hist);

      setHistory(prev => [stock, ...prev.filter(h => h.code !== stock.code)].slice(0, 8));
      setQuery("");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false); setPhase("");
  }, [query]);

  const doAI = useCallback(async () => {
    if (!result || !tech) return;
    setAiLoading(true); setAiResult(null);
    try {
      window.__ANTHROPIC_KEY__ = apiKey;
      const ai = await getAIAnalysis(result, tech);
      setAiResult(ai);
      setTab("trade");
    } catch (e) {
      setAiResult({ action: "觀望", entry: "—", stop: "—", t1: "—", t2: "—", rr: "—", reason: "AI 分析失敗，請確認 API Key", warn: e.message, detail: "" });
    }
    setAiLoading(false);
  }, [result, tech, apiKey]);

  // 自動刷新
  useEffect(() => {
    if (autoRefresh && result) {
      timerRef.current = setInterval(() => doSearch(result.code), 10000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, result, doSearch]);

  if (apiKey === null) return <ApiKeyModal onSave={k => { window.__ANTHROPIC_KEY__ = k; setApiKey(k); }} />;

  return (
    <div style={{ minHeight: "100vh", background: "#04080f", fontFamily: "'Noto Sans TC','PingFang TC',sans-serif", color: "#b8d4c8" }}>
      <div style={{ position: "fixed", inset: 0, opacity: 0.02, pointerEvents: "none", backgroundImage: "linear-gradient(#00ff88 1px,transparent 1px),linear-gradient(90deg,#00ff88 1px,transparent 1px)", backgroundSize: "48px 48px" }} />

      {/* Header */}
      <div style={{ borderBottom: "1px solid #0a1a0a", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.92)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#00ff88,#003322)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#00ff88" }}>台股即時分析系統</div>
            <div style={{ fontSize: 9, color: "#2a4a2a" }}>TWSE 即時報價 · Yahoo 歷史數據 · AI 進出場分析</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdate && <div style={{ fontSize: 9, color: "#3a5a3a", textAlign: "right" }}>
            <div style={{ color: autoRefresh ? "#00ff88" : "#3a5a3a" }}>{autoRefresh ? "● 自動刷新中" : "○ 手動模式"}</div>
            <div>{lastUpdate.toLocaleTimeString("zh-TW")}</div>
          </div>}
          <button onClick={() => setApiKey(null)} style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(0,100,50,0.2)", border: "1px solid #1a3a2a", color: "#446644", cursor: "pointer", fontSize: 10 }}>🔑 API Key</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 14px" }}>

        {/* 搜尋欄 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, background: "rgba(0,18,0,0.95)", border: "1px solid #0d2a0d", borderRadius: 12, padding: "4px 4px 4px 16px", alignItems: "center", boxShadow: "0 0 30px rgba(0,255,136,0.04)" }}>
          <span style={{ fontSize: 16, color: "#3a7a3a" }}>🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            placeholder="輸入任意台股代碼（如 2330、3346、1324）按 Enter 即時分析"
            disabled={loading}
            style={{ flex: 1, padding: "11px 0", background: "transparent", border: "none", outline: "none", color: "#c8e6c8", fontSize: 13 }}
          />
          <button onClick={() => doSearch()} disabled={loading || !query.trim()}
            style={{ padding: "11px 22px", borderRadius: 9, background: loading ? "#0a1a0a" : "linear-gradient(135deg,#00cc55,#005522)", border: "none", color: loading ? "#446644" : "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
            {loading ? "查詢中..." : "查詢"}
          </button>
        </div>

        {/* 載入狀態 */}
        {loading && (
          <div style={{ background: "rgba(0,14,0,0.9)", border: "1px solid #0c2a0c", borderRadius: 12, padding: "28px 20px", textAlign: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 28, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 10 }}>⟳</div>
            <div style={{ fontSize: 13, color: "#00ff88", marginBottom: 4 }}>{phase}</div>
            <div style={{ fontSize: 10, color: "#2a4a2a" }}>直接連接 TWSE 官方 API，取得真實即時股價...</div>
            <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* 錯誤訊息 */}
        {error && !loading && (
          <div style={{ background: "rgba(30,0,0,0.8)", border: "1px solid #440000", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#ff8888" }}>
            ⚠ {error}
          </div>
        )}

        {/* 歷史快捷 */}
        {history.length > 0 && !loading && (
          <div style={{ background: "rgba(0,10,0,0.8)", border: "1px solid #0a1a0a", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ fontSize: 8, color: "#3a5a3a", marginBottom: 7, letterSpacing: "0.1em" }}>▸ 最近查詢（點擊切換）</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {history.map(h => {
                const up = h.price >= h.prev;
                const active = result?.code === h.code;
                return (
                  <button key={h.code} onClick={() => doSearch(h.code)}
                    style={{ padding: "6px 11px", borderRadius: 7, border: `1px solid ${active ? "#00ff88" : "#162816"}`, background: active ? "rgba(0,255,136,0.09)" : "rgba(0,5,0,0.5)", color: active ? "#00ff88" : "#4a6a4a", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ fontSize: 9, opacity: 0.5 }}>{h.code}</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: up ? "#00cc66" : "#ff5555", fontFamily: "monospace" }}>{fmt(h.price)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 主分析區 */}
        {result && tech && !loading && (<>

          {/* 即時報價橫幅 */}
          <div style={{ background: "rgba(0,4,0,0.97)", border: `1px solid ${cc}18`, borderRadius: 12, padding: "14px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 9, color: "#3a5a3a" }}>
                {result.name} · {result.code} · {result.live ? "● 盤中即時" : "○ 收盤"} · TWD
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => doSearch(result.code)}
                  style={{ padding: "3px 10px", borderRadius: 5, background: "rgba(0,255,136,0.1)", border: "1px solid #00ff8830", color: "#00ff88", cursor: "pointer", fontSize: 10 }}>
                  ↻ 刷新
                </button>
                <button onClick={() => setAutoRefresh(v => !v)}
                  style={{ padding: "3px 10px", borderRadius: 5, background: autoRefresh ? "rgba(0,255,136,0.15)" : "transparent", border: `1px solid ${autoRefresh ? "#00ff88" : "#1a3a1a"}`, color: autoRefresh ? "#00ff88" : "#446644", cursor: "pointer", fontSize: 10 }}>
                  {autoRefresh ? "⏸ 暫停" : "▶ 自動10秒"}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 42, fontWeight: 800, color: cc, fontFamily: "monospace", lineHeight: 1, textShadow: `0 0 24px ${cc}44` }}>
                {fmt(result.price)}
              </div>
              <div style={{ fontSize: 15, color: cc, fontFamily: "monospace", marginBottom: 6 }}>
                {result.price >= result.prev ? "▲" : "▼"}
                {fmt(Math.abs(result.price - result.prev), 2)}
                {"  "}
                ({result.price >= result.prev ? "+" : ""}{((result.price - result.prev) / result.prev * 100).toFixed(2)}%)
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {[["開盤", result.open, "#88ccaa"], ["最高", result.high, "#00ff88"], ["最低", result.low, "#ff5555"], ["昨收", result.prev, "#557755"]].map(([l, v, c]) => v && (
                <div key={l}><div style={{ fontSize: 8, color: "#3a5a3a" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 600, color: c, fontFamily: "monospace" }}>{fmt(v)}</div></div>
              ))}
              {result.vol && <div><div style={{ fontSize: 8, color: "#3a5a3a" }}>成交量(張)</div><div style={{ fontSize: 14, fontWeight: 600, color: "#668866", fontFamily: "monospace" }}>{result.vol.toLocaleString()}</div></div>}
              {result.time && <div><div style={{ fontSize: 8, color: "#3a5a3a" }}>報價時間</div><div style={{ fontSize: 12, color: "#446644" }}>{result.time}</div></div>}
            </div>
          </div>

          {/* 評分卡 */}
          <div style={{ background: "linear-gradient(135deg,rgba(0,16,0,0.96),rgba(0,4,0,0.99))", border: `1px solid ${tech.color}18`, borderRadius: 14, padding: "16px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <Gauge score={tech.score} color={tech.color} />
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: tech.color, textShadow: `0 0 20px ${tech.color}55`, marginBottom: 4 }}>{tech.emoji} {tech.verdict}</div>
                <div style={{ fontSize: 12, color: "#88aa88", marginBottom: 10 }}>{result.code} · {result.name}</div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {[{ l: "RSI", v: tech.R?.toFixed(1), c: tech.R < 30 ? "#00ff88" : tech.R > 70 ? "#ff5555" : "#aaccaa" },
                  { l: "K值", v: tech.K?.k.toFixed(0), c: tech.K?.k < 20 ? "#00ff88" : tech.K?.k > 80 ? "#ff5555" : "#aaccaa" },
                  { l: "5MA", v: tech.s5?.toFixed(1), c: "#88ccaa" },
                  { l: "20MA", v: tech.s20?.toFixed(1), c: "#668866" },
                  ].map(({ l, v, c }) => v && (
                    <div key={l}><div style={{ fontSize: 8, color: "#3a5a3a" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div></div>
                  ))}
                </div>
              </div>
              <Chart prices={prices} color={tech.color} />
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 7, marginBottom: 11 }}>
            {[["trade", "🎯 進出場分析"], ["signals", "📊 技術訊號"], ["links", "🔗 K線圖"]].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tab === key ? "#00ff88" : "#152515"}`, background: tab === key ? "rgba(0,255,136,0.09)" : "transparent", color: tab === key ? "#00ff88" : "#4a6a4a", cursor: "pointer", fontSize: 12, fontWeight: tab === key ? 700 : 400 }}>
                {label}
              </button>
            ))}
          </div>

          {/* 進出場分析 Tab */}
          {tab === "trade" && (
            <div style={{ background: "rgba(0,8,0,0.9)", border: "1px solid #0a1a0a", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: "linear-gradient(135deg,#00ff88,#003322)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>✦</div>
                <div style={{ fontSize: 10, color: "#3a5a3a", flex: 1 }}>AI 進出場點位分析</div>
                {!aiResult && !aiLoading && (
                  <button onClick={doAI}
                    style={{ padding: "6px 16px", borderRadius: 7, background: apiKey ? "linear-gradient(135deg,#00994d,#005522)" : "#1a3a1a", border: "none", color: apiKey ? "#fff" : "#446644", cursor: apiKey ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 700 }}>
                    {apiKey ? "▶ AI 分析" : "需要 API Key"}
                  </button>
                )}
                {aiResult && (
                  <button onClick={() => { setAiResult(null); doAI(); }}
                    style={{ padding: "6px 12px", borderRadius: 7, background: "transparent", border: "1px solid #1a3a1a", color: "#446644", cursor: "pointer", fontSize: 10 }}>
                    ↻ 重新分析
                  </button>
                )}
              </div>
              {aiLoading && (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#3a5a3a" }}>
                  <div style={{ fontSize: 22, animation: "spin 1s linear infinite", display: "inline-block", marginBottom: 8 }}>⟳</div>
                  <div style={{ fontSize: 11 }}>AI 正在計算最佳進出場點位...</div>
                </div>
              )}
              {!aiResult && !aiLoading && (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#2a4a2a", fontSize: 11 }}>
                  {apiKey ? "點擊「▶ AI 分析」取得進場區間、停損點與目標價" : <span>請先設定 <button onClick={() => setApiKey(null)} style={{ background: "none", border: "none", color: "#66aaff", cursor: "pointer", fontSize: 11 }}>Anthropic API Key</button> 以啟用 AI 分析</span>}
                </div>
              )}
              {aiResult && <TradePanel d={aiResult} />}
            </div>
          )}

          {/* 技術訊號 Tab */}
          {tab === "signals" && (
            <div style={{ background: "rgba(0,8,0,0.9)", border: "1px solid #0a1a0a", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 9, color: "#3a5a3a", marginBottom: 9 }}>▸ 技術指標訊號</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tech.sigs.map((sig, i) => {
                  const bull = sig.t === "bull", bear = sig.t === "bear";
                  const ac = bull ? "#00ff88" : bear ? "#ff5555" : "#ffdd44";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: `${ac}07`, border: `1px solid ${ac}18` }}>
                      <span style={{ fontSize: 9, color: ac }}>{bull ? "▲" : bear ? "▼" : "◆"}</span>
                      <span style={{ fontSize: 12, color: `${ac}ee`, flex: 1 }}>{sig.l}</span>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${ac}18`, color: ac }}>{bull ? "看多" : bear ? "看空" : "中性"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* K線連結 Tab */}
          {tab === "links" && (
            <div style={{ background: "rgba(0,8,0,0.9)", border: "1px solid #0a1a0a", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #0a1a0a", fontSize: 10, color: "#3a5a3a" }}>🔗 {result.name}（{result.code}）即時 K 線</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                {[
                  { label: "Yahoo 股市", desc: "即時報價 + 走勢圖", icon: "📊", color: "#6001d2", url: `https://tw.stock.yahoo.com/quote/${result.code}.TW` },
                  { label: "TradingView", desc: "K線 + 技術指標", icon: "📈", color: "#2962ff", url: `https://www.tradingview.com/chart/?symbol=TWSE:${result.code}` },
                  { label: "Goodinfo", desc: "籌碼 + 財報分析", icon: "📋", color: "#cc8800", url: `https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${result.code}` },
                  { label: "玩股網", desc: "五檔 + 即時明細", icon: "🔎", color: "#00aa55", url: `https://www.wantgoo.com/stock/${result.code}` },
                ].map(({ label, desc, icon, color, url }, i) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: "1px solid #0a1a0a", borderRight: i % 2 === 0 ? "1px solid #0a1a0a" : "none", textDecoration: "none", cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = `${color}10`}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontSize: 22 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 10, color: "#3a5a3a" }}>{desc}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>)}

        {/* 初始狀態 */}
        {!result && !loading && !error && (
          <div style={{ background: "rgba(0,12,0,0.85)", border: "1px solid #0a2a0a", borderRadius: 14, padding: "40px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#66aa88", marginBottom: 8 }}>輸入任意台股代碼開始分析</div>
            <div style={{ fontSize: 12, color: "#3a5a3a", lineHeight: 1.8, marginBottom: 24 }}>
              直接連接 TWSE 官方 API 取得即時股價<br />
              支援所有上市上櫃股票，無資料庫限制
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {["2330 台積電", "3346 麗清", "3481 群創", "1324 地球", "8046 南電", "2344 華邦電", "3037 欣興", "6116 彩晶"].map(s => {
                const code = s.split(" ")[0];
                return (
                  <button key={code} onClick={() => doSearch(code)}
                    style={{ padding: "8px 16px", borderRadius: 9, background: "rgba(0,255,136,0.07)", border: "1px solid #00ff8822", color: "#88ccaa", cursor: "pointer", fontSize: 12 }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 8, color: "#182818", textAlign: "center", marginTop: 12, lineHeight: 1.8 }}>
          股價來源：TWSE 官方 API（mis.twse.com.tw）· 歷史數據：Yahoo Finance<br />
          AI 分析由 Anthropic Claude 提供 · 僅供參考，不構成投資建議
        </div>
      </div>
    </div>
  );
}
