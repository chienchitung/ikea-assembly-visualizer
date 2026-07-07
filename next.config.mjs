/** @type {import('next').NextConfig} */
const nextConfig = {
  // @napi-rs/canvas 帶原生 .node 二進位檔,pdfjs-dist 內部用動態 require 載入
  // worker —— 兩者都不能被 webpack 打包,必須用 Node 原生 require() 在執行期
  // 直接載入,否則 build 會噴 "Module parse failed" 或執行期找不到二進位檔。
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  experimental: {
    serverActions: {
      bodySizeLimit: "40mb",
    },
  },
};

export default nextConfig;
