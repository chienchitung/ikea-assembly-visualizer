import Link from "next/link";
import Uploader from "@/components/Uploader";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>把 IKEA 說明書變成互動式組裝指南</h1>
        <p>
          上傳任一 IKEA 家具組裝說明書(PDF / JPG / PNG),系統會自動辨識零件、
          工具、警示符號與步驟順序,重新整理成一步一步、有高亮與方向箭頭的視覺化指南。
        </p>
      </section>

      <Uploader />

      <div className="demo-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="thumb"
          src="/api/guides/kallax/pages/1"
          alt="KALLAX 說明書封面"
        />
        <div style={{ flex: 1 }}>
          <h3>先看示範:KALLAX 層架組(4×3)</h3>
          <p>已解析完成的範例 — 16 個步驟、11 種零件、完整視覺化標註。</p>
        </div>
        <Link className="btn btn-primary" href="/guide/kallax">
          開啟示範指南
        </Link>
      </div>

      <div className="feature-grid">
        <div className="feature">
          <div className="f-icon">🧩</div>
          <h4>自動解析零件與工具</h4>
          <p>辨識零件清單、五金料號與數量,以及需要自備的工具。</p>
        </div>
        <div className="feature">
          <div className="f-icon">🎯</div>
          <h4>逐步視覺化標註</h4>
          <p>每一步高亮重點零件、畫出組裝方向箭頭、標記螺絲位置與局部放大。</p>
        </div>
        <div className="feature">
          <div className="f-icon">⚠️</div>
          <h4>注意事項與防呆</h4>
          <p>整理警示符號、方向要點與常見錯誤,避免裝反重來。</p>
        </div>
        <div className="feature">
          <div className="f-icon">📦</div>
          <h4>結構化輸出</h4>
          <p>產出標準 JSON 指南格式,可再用於教學頁面、流程圖或動畫。</p>
        </div>
      </div>
    </main>
  );
}
