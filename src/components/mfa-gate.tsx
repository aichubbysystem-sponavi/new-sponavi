"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/**
 * 社長(president)向けの2段階認証(TOTP)ゲート。
 * - 未登録なら enroll（QRコード表示 → Authenticator登録 → 6桁で確定）
 * - 登録済みなら challenge（6桁入力）
 * verify成功で AAL2 に昇格し onVerified() を呼ぶ。
 */
export default function MfaGate({ onVerified }: { onVerified: () => void }) {
  const [phase, setPhase] = useState<"loading" | "enroll" | "challenge">("loading");
  const [qrSvg, setQrSvg] = useState("");        // enroll時のQRコード(SVG)
  const [secret, setSecret] = useState("");      // 手入力用シークレット
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 初期化: 既存factorの有無で enroll / challenge を決める
  const init = useCallback(async () => {
    setError("");
    try {
      const { data: factorsData, error: listErr } = await supabase.auth.mfa.listFactors();
      if (listErr) throw listErr;
      const verified = factorsData?.totp?.find((f) => (f.status as string) === "verified");
      if (verified) {
        setFactorId(verified.id);
        setPhase("challenge");
        return;
      }
      // 未確定のfactorが残っていたら掃除してから作り直す
      const unverified = factorsData?.totp?.find((f) => (f.status as string) === "unverified");
      if (unverified) {
        await supabase.auth.mfa.unenroll({ factorId: unverified.id }).catch(() => {});
      }
      const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `spotlight-${Date.now()}`,
      });
      if (enrollErr) throw enrollErr;
      setFactorId(enrollData.id);
      setQrSvg(enrollData.totp.qr_code);
      setSecret(enrollData.totp.secret);
      setPhase("enroll");
    } catch (e: any) {
      setError(`初期化に失敗しました: ${e?.message || "不明なエラー"}`);
    }
  }, []);

  useEffect(() => { init(); }, [init]);

  const handleVerify = async () => {
    if (code.length !== 6) { setError("6桁のコードを入力してください"); return; }
    setSubmitting(true);
    setError("");
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyErr) throw verifyErr;
      onVerified();
    } catch (e: any) {
      setError(`認証に失敗しました。コードを確認してください（${e?.message || "エラー"}）`);
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#E6EEFF]" style={{ marginLeft: 0 }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-[440px] max-w-[92vw]">
        <div className="mb-5 text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-[#003D6B]">SPOTLIGHT</span>
            <span className="text-[#E6A817]"> NAVIGATOR</span>
          </h1>
          <p className="text-sm text-slate-500 mt-2">2段階認証（社長アカウント）</p>
        </div>

        {phase === "loading" && (
          <p className="text-center text-slate-400 py-8">読み込み中...</p>
        )}

        {phase === "enroll" && (
          <div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-800 leading-relaxed">
              <p className="font-semibold mb-1">初回設定</p>
              <p>スマホの認証アプリ（Google Authenticator / Microsoft Authenticator など）で下のQRコードを読み取り、表示される6桁の数字を入力してください。</p>
            </div>
            {qrSvg && (
              <div className="flex justify-center mb-3" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            )}
            {secret && (
              <p className="text-[10px] text-slate-400 text-center break-all mb-4">
                QRが読めない場合の手入力キー: <span className="font-mono">{secret}</span>
              </p>
            )}
          </div>
        )}

        {phase === "challenge" && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm text-slate-600 leading-relaxed">
            認証アプリに表示されている6桁のコードを入力してください。
          </div>
        )}

        {(phase === "enroll" || phase === "challenge") && (
          <>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) handleVerify(); }}
              placeholder="000000"
              autoFocus
              className="w-full border border-slate-300 rounded-lg px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono mb-3"
            />
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <button
              onClick={handleVerify}
              disabled={submitting || code.length !== 6}
              className="w-full py-3 rounded-lg text-sm font-bold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "確認中..." : "認証する"}
            </button>
          </>
        )}

        {error && phase === "loading" && (
          <div className="text-center">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <button onClick={init} className="text-sm text-[#003D6B] hover:underline">再試行</button>
          </div>
        )}

        <button onClick={handleLogout} className="mt-5 w-full text-xs text-slate-400 hover:text-[#003D6B] transition">
          ログアウト
        </button>
      </div>
    </div>
  );
}
