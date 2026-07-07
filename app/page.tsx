import Link from "next/link";
import Uploader from "@/components/Uploader";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>把 IKEA 說明書變成互動式組裝指南</h1>
        <p>
          上傳任一 IKEA 組裝說明書(PDF / JPG / PNG),AI
          會自動辨識零件、工具、警示與步驟,整理成一步一步、附重點標註與方向箭頭的指南。
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
          <h3>KALLAX 層架組(4×3)示範</h3>
          <p>已解析完成的範例:16 個步驟、11 種零件、完整視覺化標註。</p>
        </div>
        <Link className="btn btn-primary" href="/guide/kallax">
          開啟示範
        </Link>
      </div>

      <section className="picto-section">
        <h2>組裝前,先看看這些</h2>
        <p className="sub">出自 IKEA 原廠說明書的提醒(以 KALLAX 為例)</p>
        <div className="picto-grid">
          <div className="picto-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pictograms/two-people.png" alt="請兩人一起組裝" />
            <div className="cap">
              <b>請兩人一起組裝</b>
              <span>板件大而重,一個人容易受傷或損壞板件。</span>
            </div>
          </div>
          <div className="picto-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pictograms/carpet.png" alt="在地毯上組裝" />
            <div className="cap">
              <b>在地毯或軟墊上組裝</b>
              <span>硬地板會刮傷板面、撞壞板角。</span>
            </div>
          </div>
          <div className="picto-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pictograms/tools.png" alt="準備工具" />
            <div className="cap">
              <b>先備妥工具</b>
              <span>指南會列出每一步需要的工具與五金。</span>
            </div>
          </div>
          <div className="picto-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pictograms/question.png" alt="有疑問時" />
            <div className="cap">
              <b>卡關了?</b>
              <span>對照原始說明書頁面,或聯絡當地 IKEA 客服。</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
