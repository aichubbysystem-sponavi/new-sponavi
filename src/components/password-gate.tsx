"use client";

/**
 * ログインパスワード再入力ゲート（危険操作の追加ロック）
 *
 * 用途: お金がかかる操作（多地点順位計測の一括計測）や
 *       公開・取消不可の操作（一括自動投稿・GBP削除）の実行前に
 *       ログインパスワードの再入力を求める。
 *
 * 仕組み: 検証専用の使い捨てSupabaseクライアント（persistSession:false）で
 *   signInWithPassword を呼び、成功=パスワード一致。メインのセッションには触れない。
 *
 * 使い方:
 *   const { gate, PasswordGateModal } = usePasswordGate();
 *   // 実行前: if (!(await gate("一括自動投稿"))) return;
 *   // JSX末尾: {PasswordGateModal}
 */

import { useState, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// 検証専用クライアント（セッションを保存せず、メインの認証状態を汚さない）
const verifyClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  { auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-pwgate" } }
);

export function usePasswordGate() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const gate = useCallback((actionLabel = "この操作"): Promise<boolean> => {
    setLabel(actionLabel);
    setPw("");
    setErr("");
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    setBusy(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(ok);
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    if (!pw) { setErr("パスワードを入力してください。"); return; }
    setBusy(true);
    setErr("");
    try {
      const email = (await supabase.auth.getUser()).data.user?.email;
      if (!email) {
        setErr("ログイン情報を取得できません。再ログインしてください。");
        setBusy(false);
        return;
      }
      const { error } = await verifyClient.auth.signInWithPassword({ email, password: pw });
      if (error) {
        setErr("パスワードが違います。");
        setBusy(false);
        return;
      }
      finish(true);
    } catch {
      setErr("確認に失敗しました。通信環境を確認してください。");
      setBusy(false);
    }
  }, [busy, pw, finish]);

  const PasswordGateModal = open ? (
    <div
      onMouseDown={() => finish(false)}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12, padding: "24px 26px", width: 380, maxWidth: "90vw",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f3460" }}>操作の確認</h3>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.7, margin: "10px 0 14px" }}>
          <strong style={{ color: "#c0392b" }}>{label}</strong>を実行します。<br />
          続けるにはログインパスワードを入力してください。
        </p>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") finish(false);
          }}
          placeholder="ログインパスワード"
          style={{
            width: "100%", padding: "10px 12px", fontSize: 15, borderRadius: 8,
            border: "1px solid #ccd", boxSizing: "border-box",
          }}
        />
        {err && <p style={{ color: "#c0392b", fontSize: 13, margin: "8px 0 0" }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            onClick={() => finish(false)}
            style={{
              padding: "8px 16px", fontSize: 14, borderRadius: 8, border: "1px solid #ccd",
              background: "#fff", color: "#555", cursor: "pointer",
            }}
          >キャンセル</button>
          <button
            onClick={submit}
            disabled={busy}
            style={{
              padding: "8px 18px", fontSize: 14, fontWeight: 700, borderRadius: 8, border: "none",
              background: busy ? "#999" : "#0f3460", color: "#fff", cursor: busy ? "wait" : "pointer",
            }}
          >{busy ? "確認中..." : "実行"}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { gate, PasswordGateModal };
}
