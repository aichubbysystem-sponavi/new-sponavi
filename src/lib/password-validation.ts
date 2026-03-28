// === 壁9: パスワードポリシー（フロントエンドバリデーション） ===

export interface PasswordRule {
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: "12文字以上", test: (pw) => pw.length >= 12 },
  { label: "大文字（A-Z）を含む", test: (pw) => /[A-Z]/.test(pw) },
  { label: "小文字（a-z）を含む", test: (pw) => /[a-z]/.test(pw) },
  { label: "数字（0-9）を含む", test: (pw) => /[0-9]/.test(pw) },
  { label: "特殊文字を含む", test: (pw) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pw) },
];

export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  strength: number; // 0-5
  strengthLabel: string;
  strengthColor: string;
}

export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];
  let strength = 0;

  for (const rule of PASSWORD_RULES) {
    if (rule.test(password)) {
      strength++;
    } else {
      errors.push(rule.label);
    }
  }

  const strengthMap: Record<number, { label: string; color: string }> = {
    0: { label: "非常に弱い", color: "#dc2626" },
    1: { label: "弱い", color: "#ef4444" },
    2: { label: "やや弱い", color: "#f97316" },
    3: { label: "普通", color: "#eab308" },
    4: { label: "強い", color: "#22c55e" },
    5: { label: "非常に強い", color: "#16a34a" },
  };

  return {
    isValid: errors.length === 0,
    errors,
    strength,
    strengthLabel: strengthMap[strength].label,
    strengthColor: strengthMap[strength].color,
  };
}

// ブルートフォース対策: ログイン試行回数の管理
const LOGIN_ATTEMPT_KEY = "login_attempts";
const LOCKOUT_KEY = "login_lockout_until";
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5分

export function checkLoginLockout(): { locked: boolean; remainingSeconds: number } {
  try {
    const lockoutUntil = localStorage.getItem(LOCKOUT_KEY);
    if (lockoutUntil) {
      const until = parseInt(lockoutUntil, 10);
      const now = Date.now();
      if (now < until) {
        return { locked: true, remainingSeconds: Math.ceil((until - now) / 1000) };
      }
      // ロックアウト期間終了 → リセット
      localStorage.removeItem(LOCKOUT_KEY);
      localStorage.removeItem(LOGIN_ATTEMPT_KEY);
    }
  } catch {
    // localStorage が使えない場合は制限なし
  }
  return { locked: false, remainingSeconds: 0 };
}

export function recordLoginAttempt(): { locked: boolean; remainingAttempts: number } {
  try {
    const attempts = parseInt(localStorage.getItem(LOGIN_ATTEMPT_KEY) || "0", 10) + 1;
    localStorage.setItem(LOGIN_ATTEMPT_KEY, String(attempts));

    if (attempts >= MAX_ATTEMPTS) {
      const lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
      localStorage.setItem(LOCKOUT_KEY, String(lockoutUntil));
      return { locked: true, remainingAttempts: 0 };
    }
    return { locked: false, remainingAttempts: MAX_ATTEMPTS - attempts };
  } catch {
    return { locked: false, remainingAttempts: MAX_ATTEMPTS };
  }
}

export function resetLoginAttempts(): void {
  try {
    localStorage.removeItem(LOGIN_ATTEMPT_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {
    // ignore
  }
}
