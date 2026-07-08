"use client";

import { useEffect, useRef, useState } from "react";
import { IconKey } from "./icons";

/**
 * 右上角的 Gemini API 金鑰設定。
 *
 * 隱私設計:金鑰只存在使用者瀏覽器的 localStorage,永遠不會寫入伺服器的
 * 任何儲存 —— 只有在按下「上傳解析」時,才隨那一次請求以 header 送到
 * 本站後端、在記憶體中轉交給 Google Gemini API,用完即丟。
 */

export const GEMINI_KEY_STORAGE = "gemini-api-key";
export const GEMINI_MODEL_STORAGE = "gemini-model";

export const GEMINI_MODELS: { id: string; label: string }[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash(快速,預設)" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro(複雜文件較準確)" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro(預覽版,最強)" },
];

export default function ApiKeySettings() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(GEMINI_MODELS[0].id);
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKey(localStorage.getItem(GEMINI_KEY_STORAGE) ?? "");
    setModel(localStorage.getItem(GEMINI_MODEL_STORAGE) ?? GEMINI_MODELS[0].id);
    setSaved(!!localStorage.getItem(GEMINI_KEY_STORAGE));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const save = () => {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
      localStorage.setItem(GEMINI_MODEL_STORAGE, model);
      setSaved(true);
    } else {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
      setSaved(false);
    }
    setOpen(false);
  };

  const clear = () => {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    setKey("");
    setSaved(false);
  };

  return (
    <div className="apikey-wrap" ref={panelRef}>
      <button
        className={"btn btn-secondary apikey-btn" + (saved ? " has-key" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconKey size={16} />
        API 金鑰
        {saved && <span className="key-dot" aria-label="已設定" />}
      </button>

      {open && (
        <div className="apikey-panel" role="dialog" aria-label="Gemini API 金鑰設定">
          <label className="apikey-label" htmlFor="gemini-key">
            Google Gemini API 金鑰
          </label>
          <div className="apikey-input-row">
            <input
              id="gemini-key"
              type={reveal ? "text" : "password"}
              value={key}
              placeholder="AIza..."
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="button"
              className="reveal-btn"
              onClick={() => setReveal((v) => !v)}
              title={reveal ? "隱藏" : "顯示"}
            >
              {reveal ? "隱藏" : "顯示"}
            </button>
          </div>

          <label className="apikey-label" htmlFor="gemini-model">
            解析模型
          </label>
          <select
            id="gemini-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <p className="apikey-note">
            金鑰僅儲存在此瀏覽器(localStorage),伺服器不保存;解析時才隨該次請求送出使用。可到{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>{" "}
            免費取得。
          </p>

          <div className="apikey-actions">
            {saved && (
              <button className="btn btn-secondary" onClick={clear}>
                清除
              </button>
            )}
            <button className="btn btn-primary" onClick={save}>
              儲存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
