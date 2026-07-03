/**
 * 画像プロキシ: Dropbox等の一時URLから画像をダウンロード → Supabase Storageにアップロード → 公開URL返却
 * GBP APIは sourceUrl から画像をfetchするため、安定した公開URLが必要
 */
import { getSupabase } from "@/lib/supabase";


const BUCKET = "post-images";


/**
 * 画像URLをGBP APIがfetch可能な公開URLに変換
 * - Dropbox一時URL → ダウンロード → Supabase Storage → 公開URL
 * - 既にpublic URLの場合はそのまま返す
 */
// SSRF防止: 実ホスト名がDropboxの正規ドメインの場合のみサーバー側fetchを許可
function isDropboxHost(rawUrl: string): boolean {
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  const allowed = ["dropbox.com", "dropboxusercontent.com"];
  return allowed.some((d) => host === d || host.endsWith("." + d));
}

export async function resolveImageUrl(imageUrl: string, postId: string): Promise<string | null> {
  if (!imageUrl) return null;

  // Dropboxの正規ホストのみサーバー側でダウンロード（SSRF防止）。それ以外はそのまま返す
  if (!isDropboxHost(imageUrl)) return imageUrl;

  try {
    // 1. 画像をダウンロード
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[image-proxy] ダウンロード失敗: ${res.status} ${imageUrl.slice(0, 80)}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());

    if (buffer.length < 1000) {
      console.error(`[image-proxy] 画像が小さすぎる (${buffer.length} bytes) — HTMLリダイレクトの可能性`);
      return null;
    }

    // 2. Supabase Storageにアップロード
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const fileName = `${postId}.${ext}`;
    const supabase = getSupabase();

    // バケット存在確認 & 作成
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: true });
    }

    // アップロード（同名ファイルは上書き）
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.error(`[image-proxy] アップロード失敗:`, error.message);
      return null;
    }

    // 3. 公開URLを返す
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    console.log(`[image-proxy] 変換成功: ${imageUrl.slice(0, 50)}... → ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (e: any) {
    console.error(`[image-proxy] エラー:`, e?.message);
    return null;
  }
}

/**
 * 投稿後にStorageから一時画像を削除（オプション）
 */
export async function cleanupImage(postId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data: files } = await supabase.storage.from(BUCKET).list("", { search: postId });
    if (files && files.length > 0) {
      await supabase.storage.from(BUCKET).remove(files.map(f => f.name));
    }
  } catch {}
}
