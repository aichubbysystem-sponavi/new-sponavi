# SPOTLIGHT NAVIGATOR セットアップガイド

新規環境でのセットアップ手順。

---

## 1. Supabase（新規アカウント）

### 1-1. プロジェクト作成
1. https://supabase.com にアクセス → 新規アカウント作成
2. 「New Project」→ プロジェクト名: `スポナビ`（任意）
3. リージョン: `Northeast Asia (Tokyo)` 推奨
4. データベースパスワードを安全に保管

### 1-2. 認証設定
1. **Authentication → Settings → Site URL**
   - 開発時: `http://localhost:3000`
   - 本番時: `https://your-domain.com` に変更
2. **Authentication → Settings → Redirect URLs**
   - `http://localhost:3000/login` を追加
   - 本番URL `/login` も追加
3. **Authentication → Attack Protection**
   - 「Prevent use of leaked passwords」→ 有効化推奨

### 1-3. 初期ユーザー作成
1. **Authentication → Users → Add User**
2. メールアドレスとパスワードを入力（パスワードポリシー: 12文字以上、大文字・小文字・数字・特殊文字必須）

### 1-4. API キー取得
1. **Settings → API**
2. 以下をコピー:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 2. フロントエンド（Next.js）

### 2-1. 依存関係インストール
```bash
npm install
```

### 2-2. 環境変数設定
```bash
cp .env.example .env.local
```
`.env.local` を編集し、Supabase の値を入力:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
NEXT_PUBLIC_API_URL=http://localhost:5555
```

### 2-3. 開発サーバー起動
```bash
npm run dev
```
http://localhost:3000 でアクセス。

---

## 3. Vercel デプロイ（新規アカウント）

### 3-1. アカウント作成
1. https://vercel.com → GitHub連携で新規アカウント作成

### 3-2. リポジトリ連携
1. GitHubにリポジトリを push
2. Vercel ダッシュボード → 「Add New Project」
3. GitHubリポジトリを選択

### 3-3. 環境変数設定
Vercel の Project Settings → Environment Variables に以下を追加:

| 変数名 | 値 |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の anon key |
| `NEXT_PUBLIC_API_URL` | Go APIの本番URL |

### 3-4. デプロイ
- `main` ブランチへの push で自動デプロイ
- リージョン: `vercel.json` で `hnd1`（東京）に設定済み

---

## 4. Go バックエンド API

フロントエンドは `NEXT_PUBLIC_API_URL` で指定したURLにプロキシします。
Go APIサーバーは別途デプロイが必要です（Cloud Run, Fly.io, Railway 等）。

---

## 5. セキュリティチェックリスト

デプロイ前に確認:

- [ ] Supabase Site URL を本番URLに変更
- [ ] Supabase Redirect URLs に本番URLを追加
- [ ] 環境変数が全て設定されている
- [ ] RLS ポリシーが有効
- [ ] 初期ユーザーのパスワードがポリシー準拠
- [ ] Go APIのCORS設定に本番URLを追加
- [ ] HTTPSが有効（Vercelなら自動）
