/**
 * GBP基礎情報の「変更検知＆復旧」用スナップショットのロジック。
 * basic-info 画面から利用。純粋関数として切り出しテスト可能にしている。
 *
 * 重大バグの教訓: 変更検知のたびに現在値でスナップショットを上書きすると、
 * 「元に戻す」が改ざん後の値を書き戻す no-op になる。
 * → shouldRefreshBaseline() が false の時はベースラインを保持すること。
 */

export interface ChangeAlert {
  field: string;
  before: string;
  after: string;
}

export interface GbpSnapshot {
  title: string;
  phone: string;
  website: string;
  category: string;
  address: string;
  raw: {
    storefrontAddress: any;
    primaryCategory: any;
    additionalCategories: any;
  };
  savedAt: string;
}

/** GBPロケーションのメインカテゴリ名を文字列で取り出す（displayNameがobject/stringの両対応） */
export function catNameOf(data: any): string {
  const c = data?.categories?.primaryCategory?.displayName;
  return typeof c === "object" ? (c?.text || c?.displayName || "") : String(c || "");
}

/** GBPロケーションの住所行を結合した文字列 */
export function addressOf(data: any): string {
  return (data?.storefrontAddress?.addressLines || []).join(" ");
}

/**
 * 変更検知・復旧用スナップショットを組み立てる。
 * 比較用の文字列フィールドに加え、住所・カテゴリは復旧に使える構造化データ(raw)も保持する。
 * @param now ISO文字列（テスト用に注入可能。省略時は現在時刻）
 */
export function buildGbpSnapshot(data: any, now?: string): GbpSnapshot {
  return {
    title: data?.title || "",
    phone: data?.phoneNumbers?.primaryPhone || "",
    website: data?.websiteUri || "",
    category: catNameOf(data),
    address: addressOf(data),
    raw: {
      storefrontAddress: data?.storefrontAddress || null,
      primaryCategory: data?.categories?.primaryCategory || null,
      additionalCategories: data?.categories?.additionalCategories || null,
    },
    savedAt: now || new Date().toISOString(),
  };
}

/**
 * 前回の正常時ベースライン(prev)と現在のGBPデータ(data)を比較し、変更点を返す。
 * 双方に値があり、かつ異なる場合のみ変更とみなす（空→値の初期化はアラートにしない）。
 */
export function detectGbpChanges(prev: Partial<GbpSnapshot> | null, data: any): ChangeAlert[] {
  if (!prev || !data) return [];
  const alerts: ChangeAlert[] = [];
  const check = (field: string, prevVal: string | undefined, curVal: string | undefined) => {
    const p = (prevVal || "").trim();
    const c = (curVal || "").trim();
    if (p && c && p !== c) alerts.push({ field, before: p, after: c });
  };
  check("店舗名", prev.title, data.title);
  check("電話番号", prev.phone, data.phoneNumbers?.primaryPhone);
  check("Webサイト", prev.website, data.websiteUri);
  check("メインカテゴリ", prev.category, catNameOf(data));
  check("住所", prev.address, addressOf(data));
  return alerts;
}
