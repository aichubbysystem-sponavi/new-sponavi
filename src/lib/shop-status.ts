/**
 * MEOマスタ（スプレッドシート）の契約ステータスを店舗に突き合わせるロジック。
 *
 * 【なぜ独立モジュールなのか】
 * このプロジェクトで最も事故が多いのが店舗名の照合。
 * 実データにも「エミナルクリニック 札幌院」（半角スペース）と
 * 「エミナルクリニック　新潟院」（全角スペース）が混在している。
 * さらに部分一致で照合すると「渋谷店」が「渋谷本店」に当たるような
 * 誤マッチが起きるため、ここでは正規化した完全一致しか採らない。
 * 照合できなかったものは黙って捨てず、呼び出し側へ返して人が確認する。
 */

/** 契約ステータス。MEOマスタのB列の値に対応する */
export type ContractStatus = "active" | "cancelled" | "paused";

/** B列の表記 → 内部ステータス */
export function parseContractStatus(raw: string | null | undefined): ContractStatus | null {
  const s = (raw || "").normalize("NFKC").replace(/[\s　]/g, "");
  if (!s) return null;
  if (s === "契約中") return "active";
  if (s === "解約" || s === "解約済" || s === "解約済み") return "cancelled";
  if (s === "停止中" || s === "停止") return "paused";
  return null; // 未知の値は判断しない（勝手に解約扱いにしない）
}

/**
 * 店舗名の正規化。
 * NFKCで全角/半角を統一し、空白と記号のゆれを吸収する。
 * 別店舗を同一視してしまわないよう、削るのは空白と一部の記号だけに留める。
 */
export function normalizeShopName(name: string | null | undefined): string {
  return (name || "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[‐‑‒–—―ー−]/g, "-") // ハイフン類を統一（長音符「ー」は別字だが店名では混用される）
    .replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"))
    .toLowerCase();
}

export interface MasterRow {
  /** MEOマスタ C列 */
  shopName: string;
  status: ContractStatus;
}

export interface DbShop {
  id: string;
  name: string;
  cancelled_at: string | null;
  paused_at?: string | null;
  rank_tracking_disabled?: boolean | null;
  /** 'manual' = 人が指定（同期で触らない） / 'master' = マスタ由来（同期が管理） */
  rank_tracking_reason?: string | null;
}

/** 順位計測の対象外にする理由 */
export type RankExclusionReason = "manual" | "master";

export interface RankChange {
  shopId: string;
  shopName: string;
  /** true = 対象外にする / false = 対象に戻す */
  disable: boolean;
  /** 対象外にする理由（戻す場合は null） */
  reason: RankExclusionReason | null;
  /** 画面表示用の理由ラベル */
  detail: string;
}

export interface StatusChange {
  shopId: string;
  shopName: string;
  from: ContractStatus;
  to: ContractStatus;
}

export interface StatusDiff {
  changes: StatusChange[];
  /** マスタに載っているがDBに見つからなかった店舗名 */
  unmatched: { shopName: string; status: ContractStatus }[];
  /** マスタに同じ名前が複数ある場合（どれを採るか決められない） */
  duplicatedInMaster: string[];
  /** DBに同じ名前が複数ある場合 */
  duplicatedInDb: string[];
}

/** DBの列からステータスを求める。解約が停止に優先する */
export function currentStatus(shop: DbShop): ContractStatus {
  if (shop.cancelled_at) return "cancelled";
  if (shop.paused_at) return "paused";
  return "active";
}

/**
 * マスタとDBを突き合わせ、変更が必要な店舗を洗い出す。
 * 実際の書き込みは呼び出し側が行う（dry-runできるように分離している）。
 */
export function diffContractStatus(master: MasterRow[], shops: DbShop[]): StatusDiff {
  // マスタ側の重複検出
  const masterByNorm = new Map<string, MasterRow[]>();
  for (const row of master) {
    const key = normalizeShopName(row.shopName);
    if (!key) continue;
    if (!masterByNorm.has(key)) masterByNorm.set(key, []);
    masterByNorm.get(key)!.push(row);
  }

  // DB側の重複検出
  const dbByNorm = new Map<string, DbShop[]>();
  for (const s of shops) {
    const key = normalizeShopName(s.name);
    if (!key) continue;
    if (!dbByNorm.has(key)) dbByNorm.set(key, []);
    dbByNorm.get(key)!.push(s);
  }

  const changes: StatusChange[] = [];
  const unmatched: { shopName: string; status: ContractStatus }[] = [];
  const duplicatedInMaster: string[] = [];
  const duplicatedInDb: string[] = [];

  for (const [key, rows] of Array.from(masterByNorm.entries())) {
    // 同じ名前が複数ステータスで載っている場合は判断できないので触らない
    const statuses = new Set(rows.map((r) => r.status));
    if (rows.length > 1 && statuses.size > 1) {
      duplicatedInMaster.push(rows[0].shopName);
      continue;
    }
    const target = rows[0];

    const candidates = dbByNorm.get(key);
    if (!candidates || candidates.length === 0) {
      unmatched.push({ shopName: target.shopName, status: target.status });
      continue;
    }
    if (candidates.length > 1) {
      // どの店舗を更新すべきか決められない。誤った店舗を解約にしないため保留
      duplicatedInDb.push(target.shopName);
      continue;
    }

    const shop = candidates[0];
    const from = currentStatus(shop);
    if (from !== target.status) {
      changes.push({ shopId: shop.id, shopName: shop.name, from, to: target.status });
    }
  }

  return { changes, unmatched, duplicatedInMaster, duplicatedInDb };
}

/**
 * 「MEOマスタに契約中として載っている店舗だけ順位計測する」方針に基づき、
 * 順位計測フラグの変更点を洗い出す。
 *
 * 【重要】手動指定（reason='manual'、エミナル等）は絶対に触らない。
 * ここを触ると、同期のたびに手動で外した店舗が計測対象に戻ってしまう。
 *
 * マスタに載っていない店舗は「契約中ではない」とみなして対象外にする。
 * DB608件に対しマスタは398行なので、この扱いで約220件が対象外になる。
 */
export function diffRankTracking(master: MasterRow[], shops: DbShop[]): RankChange[] {
  const masterStatus = new Map<string, ContractStatus>();
  for (const row of master) {
    const key = normalizeShopName(row.shopName);
    if (!key) continue;
    // 同名でステータスが割れている場合は、安全側（契約中でない方）を採る
    const prev = masterStatus.get(key);
    if (prev && prev !== row.status) {
      masterStatus.set(key, prev === "active" ? row.status : prev);
    } else {
      masterStatus.set(key, row.status);
    }
  }

  const changes: RankChange[] = [];
  for (const shop of shops) {
    const disabled = shop.rank_tracking_disabled === true;
    const reason = shop.rank_tracking_reason || null;

    // 手動指定は同期の管理外
    if (disabled && reason === "manual") continue;

    const status = masterStatus.get(normalizeShopName(shop.name));
    const shouldExclude = status !== "active"; // 未掲載(undefined)も対象外

    if (shouldExclude && !disabled) {
      const detail =
        status === "cancelled" ? "マスタで解約"
        : status === "paused" ? "マスタで停止中"
        : "マスタ未掲載";
      changes.push({ shopId: shop.id, shopName: shop.name, disable: true, reason: "master", detail });
    } else if (!shouldExclude && disabled && reason === "master") {
      // マスタが契約中に戻った → 計測対象へ復帰
      changes.push({ shopId: shop.id, shopName: shop.name, disable: false, reason: null, detail: "マスタで契約中" });
    }
  }
  return changes;
}

/** ステータスに対応するDB更新値 */
export function statusToColumns(status: ContractStatus, now: string): {
  cancelled_at: string | null;
  paused_at: string | null;
} {
  if (status === "cancelled") return { cancelled_at: now, paused_at: null };
  if (status === "paused") return { cancelled_at: null, paused_at: now };
  return { cancelled_at: null, paused_at: null };
}

/**
 * MEOマスタのCSVを解析する。
 * A列=顧客ID / B列=ステータス管理 / C列=店舗名
 * ヘッダー行と、ステータスまたは店舗名が空の行は落とす。
 */
export function parseMasterCsv(rows: string[][]): MasterRow[] {
  const out: MasterRow[] = [];
  for (const r of rows) {
    if (!r || r.length < 3) continue;
    const status = parseContractStatus(r[1]);
    const shopName = (r[2] || "").trim();
    if (!status || !shopName) continue;
    if (shopName === "店舗名" || shopName.startsWith("店舗名")) continue; // ヘッダー
    out.push({ shopName, status });
  }
  return out;
}
