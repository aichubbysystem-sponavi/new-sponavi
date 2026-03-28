"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  validatePassword,
  PASSWORD_RULES,
  checkLoginLockout,
  recordLoginAttempt,
  resetLoginAttempts,
} from "@/lib/password-validation";

type Mode = "login" | "reset" | "change-password";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const router = useRouter();

  // ロックアウトのカウントダウン
  useEffect(() => {
    const { locked, remainingSeconds } = checkLoginLockout();
    if (locked) {
      setLockoutSeconds(remainingSeconds);
    }
  }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // パスワードリセットのコールバック（メールからのリダイレクト）
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get("type");
    if (type === "recovery") {
      setMode("change-password");
    }
  }, []);

  const validation = validatePassword(newPassword);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // ロックアウトチェック
    const lockout = checkLoginLockout();
    if (lockout.locked) {
      setLockoutSeconds(lockout.remainingSeconds);
      setError(`ログイン試行回数の上限に達しました。${Math.ceil(lockout.remainingSeconds / 60)}分後に再試行してください。`);
      return;
    }

    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      const result = recordLoginAttempt();
      if (result.locked) {
        setLockoutSeconds(300);
        setError("ログイン試行回数の上限（5回）に達しました。5分後に再試行してください。");
      } else {
        setError(`メールアドレスまたはパスワードが正しくありません（残り${result.remainingAttempts}回）`);
      }
      setLoading(false);
      return;
    }

    if (data.session) {
      resetLoginAttempts();
      router.push("/");
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email) {
      setError("メールアドレスを入力してください");
      return;
    }

    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (resetError) {
      setError("パスワードリセットメールの送信に失敗しました");
    } else {
      setSuccess("パスワードリセット用のメールを送信しました。メールをご確認ください。");
    }
    setLoading(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!validation.isValid) {
      setError("パスワードが要件を満たしていません");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      setError("パスワードの更新に失敗しました: " + updateError.message);
    } else {
      setSuccess("パスワードを更新しました。新しいパスワードでログインしてください。");
      setMode("login");
      setNewPassword("");
      setConfirmPassword("");
    }
    setLoading(false);
  };

  const switchMode = useCallback((newMode: Mode) => {
    setMode(newMode);
    setError("");
    setSuccess("");
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#E6EEFF]" style={{ marginLeft: 0 }}>
      <form
        onSubmit={
          mode === "login" ? handleLogin :
          mode === "reset" ? handleResetPassword :
          handleChangePassword
        }
        className="bg-white rounded-2xl shadow-xl p-10 w-[460px]"
        aria-label={
          mode === "login" ? "ログインフォーム" :
          mode === "reset" ? "パスワードリセットフォーム" :
          "パスワード変更フォーム"
        }
      >
        {/* ロゴ */}
        <div className="flex justify-center mb-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold">
              <span className="text-[#003D6B]">SPOTLIGHT</span>
              <span className="text-[#E6A817]"> NAVIGATOR</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">MEO Management Platform</p>
          </div>
        </div>

        {/* モード表示 */}
        <div className="text-center mb-6">
          <h2 className="text-sm font-semibold text-slate-600">
            {mode === "login" && "ログイン"}
            {mode === "reset" && "パスワードリセット"}
            {mode === "change-password" && "新しいパスワードを設定"}
          </h2>
        </div>

        {/* エラー */}
        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4 border border-red-100">
            {error}
          </div>
        )}

        {/* 成功 */}
        {success && (
          <div className="bg-emerald-50 text-emerald-600 text-sm p-3 rounded-lg mb-4 border border-emerald-100">
            {success}
          </div>
        )}

        {/* ロックアウト警告 */}
        {lockoutSeconds > 0 && (
          <div className="bg-amber-50 text-amber-700 text-sm p-3 rounded-lg mb-4 border border-amber-200">
            アカウント保護のためロック中: あと {Math.floor(lockoutSeconds / 60)}分{lockoutSeconds % 60}秒
          </div>
        )}

        {/* ===== ログインモード ===== */}
        {mode === "login" && (
          <>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-500 block mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B]"
                required
                autoComplete="email"
              />
            </div>

            <div className="mb-6">
              <label className="text-xs font-medium text-slate-500 block mb-1">パスワード</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="パスワード"
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B] pr-12"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  {showPassword ? "隠す" : "表示"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || lockoutSeconds > 0}
              className="w-full bg-[#003D6B] text-white py-3 rounded-lg font-medium hover:bg-[#002a4a] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "ログイン中..." : "Sign In"}
            </button>

            <button
              type="button"
              onClick={() => switchMode("reset")}
              className="w-full text-center text-xs text-slate-400 mt-4 hover:text-[#003D6B] transition cursor-pointer"
            >
              パスワードをお忘れの場合
            </button>
          </>
        )}

        {/* ===== パスワードリセットモード ===== */}
        {mode === "reset" && (
          <>
            <p className="text-xs text-slate-500 mb-4">
              登録済みのメールアドレスを入力してください。パスワードリセット用のリンクをお送りします。
            </p>
            <div className="mb-6">
              <label className="text-xs font-medium text-slate-500 block mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@company.com"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B]"
                required
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#003D6B] text-white py-3 rounded-lg font-medium hover:bg-[#002a4a] transition disabled:opacity-50"
            >
              {loading ? "送信中..." : "リセットメールを送信"}
            </button>

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full text-center text-xs text-slate-400 mt-4 hover:text-[#003D6B] transition cursor-pointer"
            >
              ログインに戻る
            </button>
          </>
        )}

        {/* ===== パスワード変更モード ===== */}
        {mode === "change-password" && (
          <>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-500 block mb-1">新しいパスワード</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新しいパスワード"
                  className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B] pr-12"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  {showNewPassword ? "隠す" : "表示"}
                </button>
              </div>

              {/* パスワード強度メーター */}
              {newPassword && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${(validation.strength / 5) * 100}%`,
                          backgroundColor: validation.strengthColor,
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-medium min-w-[80px] text-right"
                      style={{ color: validation.strengthColor }}
                    >
                      {validation.strengthLabel}
                    </span>
                  </div>

                  {/* 各ルールのチェック状態 */}
                  <div className="space-y-1">
                    {PASSWORD_RULES.map((rule) => {
                      const passed = rule.test(newPassword);
                      return (
                        <div key={rule.label} className="flex items-center gap-2">
                          <span className={`text-xs ${passed ? "text-emerald-500" : "text-slate-300"}`}>
                            {passed ? "●" : "○"}
                          </span>
                          <span className={`text-xs ${passed ? "text-emerald-600" : "text-slate-400"}`}>
                            {rule.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="mb-6">
              <label className="text-xs font-medium text-slate-500 block mb-1">パスワード確認</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="もう一度入力してください"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B]"
                required
                autoComplete="new-password"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-500 mt-1">パスワードが一致しません</p>
              )}
              {confirmPassword && newPassword === confirmPassword && newPassword.length > 0 && (
                <p className="text-xs text-emerald-500 mt-1">パスワードが一致しました</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !validation.isValid || newPassword !== confirmPassword}
              className="w-full bg-[#003D6B] text-white py-3 rounded-lg font-medium hover:bg-[#002a4a] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "更新中..." : "パスワードを更新"}
            </button>

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full text-center text-xs text-slate-400 mt-4 hover:text-[#003D6B] transition cursor-pointer"
            >
              ログインに戻る
            </button>
          </>
        )}

        {/* セキュリティバッジ */}
        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-center gap-1">
            <span className="text-[10px] text-slate-300">SSL / HSTS / CSP / RLS で保護されています</span>
          </div>
        </div>
      </form>
    </div>
  );
}
