/**
 * GBP API のエラー応答を「日本語の原因 ＋ 原文」に整形する。
 *
 * 背景: 予約投稿のエラー欄に `GBP Media API 400: { "error": { "code": 400, "message": "Request contains an
 * invalid argument." ...` がそのまま出ていて、しかも保存前に200文字で切っていたため、Googleが返す本当の理由
 * （errorDetails[].message）が画面にもDBにも残らなかった（2026-08-28 動画3本）。
 * ここで全文を受け取り、errorDetails を優先して日本語化し、原文は後ろに残す。
 */

type Parsed = { message: string; status: string; details: string[] };

function parseGoogleError(raw: string): Parsed {
  const out: Parsed = { message: "", status: "", details: [] };
  const start = raw.indexOf("{");
  if (start < 0) return { ...out, message: raw.trim() };
  try {
    const json = JSON.parse(raw.slice(start));
    const err = json?.error || json;
    out.message = String(err?.message || "");
    out.status = String(err?.status || "");
    const collect = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (typeof node === "object") {
        // v4 ValidationError: errorDetails[{code, field, message, value}] / google.rpc.BadRequest: fieldViolations[{field, description}]
        for (const key of ["errorDetails", "fieldViolations", "details"]) if (node[key]) collect(node[key]);
        const msg = node.message || node.description;
        if (typeof msg === "string" && msg && !out.details.includes(msg)) {
          const field = node.field ? `${node.field}: ` : "";
          out.details.push(`${field}${msg}`);
        }
      }
    };
    collect(err?.details);
  } catch {
    out.message = raw.trim();
  }
  return out;
}

/** 既知パターン → 日本語の原因。当たらなければ null */
function knownCauseJa(text: string, httpStatus: number, isMedia: boolean): string | null {
  const t = text.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403 || /permission|unauthenticated|forbidden/.test(t))
    return "この店舗のGBPに対する権限がない、またはOAuthトークンが失効しています（トークン再発行・オーナー権限の確認）";
  if (httpStatus === 404 || /not found/.test(t))
    return "GBPのロケーションが見つかりません（店舗が別アカウント配下・削除・ロケーションIDの不一致）";
  if (httpStatus === 429 || /quota|rate ?limit|resource_exhausted/.test(t))
    return "GoogleのAPI利用上限に達しました（時間をおいて再実行）";
  if (/duration|too long|seconds/.test(t) && /video|media|duration/.test(t))
    return "動画の長さがGBPの上限（30秒）を超えています。30秒以内に切り出して書き出し直してください";
  if (/too large|file size|exceeds.*size|size.*exceed/.test(t))
    return "ファイルサイズがGBPの上限（写真5MB／動画75MB）を超えています";
  if (/resolution|dimension|too small|pixel/.test(t))
    return "解像度が足りません（写真は250×250px以上、動画は720p以上）";
  if (/could not fetch|fetch|download|unreachable|url.*(invalid|inaccessible)/.test(t))
    return "Googleがファイル（写真・動画のURL）を取得できませんでした。URLの失効・非公開・サイズ超過が原因になります";
  if (/format|unsupported|mime|codec/.test(t))
    return "ファイル形式がGBPで受け付けられません（写真: JPG/PNG、動画: MP4/MOV。WebP・HEIC・GIF不可）";
  if (/duplicate|already exists/.test(t))
    return "同じ内容が既に投稿済みとしてGoogleに拒否されました";
  if (/policy|violat|prohibited|inappropriate/.test(t))
    return "Googleのコンテンツポリシーに抵触すると判定されました（文言・画像の見直しが必要）";
  if (/summary.*(long|length)|too many characters/.test(t))
    return "投稿本文が長すぎます（GBPは1,500文字まで）";
  if (/phone|url.*not allowed|link/.test(t) && !isMedia)
    return "本文中の電話番号・URLがGoogleに拒否されました（本文から外してCTAボタンに移す）";
  if (httpStatus === 400 && isMedia && /invalid argument/.test(t))
    return "Googleが写真・動画の内容を受け付けませんでした（動画は「30秒以内・75MB以下・720p以上」、写真は「5MB以下・250×250px以上・JPG/PNG」を確認。同じ店舗へ動画を連続投稿すると2本目以降が拒否される場合もあります）";
  if (httpStatus === 400 && /invalid argument/.test(t))
    return "Googleがリクエスト内容を受け付けませんでした（本文・CTAリンク・特典期間のいずれかが不正）";
  if (httpStatus >= 500)
    return "Google側の一時的な障害です（時間をおいて再実行）";
  return null;
}

/**
 * @param label  呼び出し経路（"GBP Media API" / "Go API media_direct" 等）
 * @param httpStatus HTTPステータス
 * @param rawText  レスポンス本文（切り詰めずに渡す）
 * @param opts.isMedia 写真・動画投稿か
 * @returns 例: 「動画の長さがGBPの上限（30秒）を超えています｜Google: Video duration must be under 30 seconds｜GBP Media API 400: {...}」
 */
export function explainGbpError(
  label: string,
  httpStatus: number,
  rawText: string,
  opts: { isMedia?: boolean } = {},
): string {
  const parsed = parseGoogleError(rawText || "");
  const googleSays = parsed.details.length > 0 ? parsed.details.join(" / ") : parsed.message;
  const cause = knownCauseJa(`${googleSays} ${parsed.status}`, httpStatus, !!opts.isMedia)
    || "原因を特定できませんでした（原文を確認してください）";
  const parts = [cause];
  if (googleSays) parts.push(`Google: ${googleSays.slice(0, 300)}`);
  parts.push(`${label} ${httpStatus}: ${(rawText || "").replace(/\s+/g, " ").slice(0, 600)}`);
  return parts.join("｜");
}

/** DBの error_detail に保存できる長さ。以前の300文字ではGoogleの理由が切れていた */
export const ERROR_DETAIL_MAX = 1500;
