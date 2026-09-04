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
  /**
   * GBP上の現在名。shops.name は結合キーなので改名されず、マスタ側が
   * GBPの現在名で書かれていると name だけでは照合できない（CEYLON HOUSE / うら山本店 の実例）。
   * name と併せて照合キーにする
   */
  gbp_shop_name?: string | null;
  cancelled_at: string | null;
  paused_at?: string | null;
  rank_tracking_disabled?: boolean | null;
  /** 'manual' = 人が指定（同期で触らない） / 'master' = マスタ由来（同期が管理） */
  rank_tracking_reason?: string | null;
}

/**
 * 店舗の照合キー（正規化済み・重複除去）。name を先頭に、GBP現在名が別名なら続ける。
 * 部分一致は使わない（「渋谷店」が「渋谷本店」に当たる誤マッチを避ける）
 */
export function shopMatchKeys(shop: DbShop): string[] {
  const keys: string[] = [];
  for (const raw of [shop.name, shop.gbp_shop_name]) {
    const k = normalizeShopName(raw);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
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

  // DB側の重複検出（name と GBP現在名の両方をキーにする）
  const dbByNorm = new Map<string, DbShop[]>();
  for (const s of shops) {
    for (const key of shopMatchKeys(s)) {
      if (!dbByNorm.has(key)) dbByNorm.set(key, []);
      dbByNorm.get(key)!.push(s);
    }
  }

  const changes: StatusChange[] = [];
  const unmatched: { shopName: string; status: ContractStatus }[] = [];
  const duplicatedInMaster: string[] = [];
  const duplicatedInDb: string[] = [];

  // マスタ側キー → 採用するステータス（判断できないキーは undefined のまま＝触らない）
  const resolved = new Map<string, ContractStatus>();
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
    if (new Set(candidates.map((c) => c.id)).size > 1) {
      // どの店舗を更新すべきか決められない。誤った店舗を解約にしないため保留
      duplicatedInDb.push(target.shopName);
      continue;
    }
    resolved.set(key, target.status);
  }

  // 店舗ごとに1回だけ判定する。name と GBP現在名の両方がマスタに載っていても二重に変更しない
  // （name のキーを優先し、無ければ GBP現在名のキーで引く）
  for (const shop of shops) {
    let target: ContractStatus | undefined;
    for (const key of shopMatchKeys(shop)) {
      if (resolved.has(key)) { target = resolved.get(key); break; }
    }
    if (!target) continue;
    const from = currentStatus(shop);
    if (from !== target) {
      changes.push({ shopId: shop.id, shopName: shop.name, from, to: target });
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
export function diffRankTracking(
  master: MasterRow[],
  shops: DbShop[],
  /** ステータスを解釈できなかった店舗（正規化名）。判定から除外して現状維持する */
  unknownNames?: Set<string>,
): RankChange[] {
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

    // 手動指定は同期の管理外。
    // disabled の真偽で判定すると、人が手動で「対象に戻した」店舗(disabled=false, manual)が
    // 素通りして再び対象外にされ、reason も master で上書きされて手動の意思が消える
    if (reason === "manual") continue;

    const keys = shopMatchKeys(shop);
    // ステータスを解釈できなかった店舗（空欄含む）は現状維持（表記ゆれで計測を止めない）
    if (unknownNames && keys.some((k) => unknownNames.has(k))) continue;

    // name を優先し、無ければ GBP現在名でマスタを引く
    let status: ContractStatus | undefined;
    for (const k of keys) {
      if (masterStatus.has(k)) { status = masterStatus.get(k); break; }
    }
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
 * 列位置はヘッダー行（「ステータス」「店舗名」を含む行）から自動判定する。
 *   旧MEOマスタ: A列=顧客ID / B列=ステータス管理 / C列=店舗名
 *   MEO顧客管理（2026-09-04〜の正）: A列=ステータス / B列=店舗名（1行目はタイトル行）
 * ヘッダーが見つからない場合は旧レイアウト（B/C列）として読む。
 * ヘッダー行と、ステータスまたは店舗名が空の行は落とす。
 */
export function parseMasterCsv(rows: string[][]): MasterRow[] {
  return parseMasterCsvDetailed(rows).rows;
}

/** ヘッダー行から（ステータス列, 店舗名列, データ開始行）を求める。見つからなければ旧レイアウト */
function detectMasterLayout(rows: string[][]): { statusCol: number; nameCol: number; dataFrom: number } {
  const isStatusHeader = (c: string) => /^ステータス/.test(c.trim());
  const isNameHeader = (c: string) => /^店舗名/.test(c.trim());
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || [];
    const statusCol = r.findIndex((c) => isStatusHeader(c || ""));
    const nameCol = r.findIndex((c) => isNameHeader(c || ""));
    if (statusCol >= 0 && nameCol >= 0 && statusCol !== nameCol) {
      return { statusCol, nameCol, dataFrom: i + 1 };
    }
  }
  return { statusCol: 1, nameCol: 2, dataFrom: 0 };
}

/**
 * マスタCSVの解析結果。未知ステータスの行を捨てずに返す。
 *
 * 【なぜ分けるか】
 * 「契約中（2026/4〜）」のような表記ゆれがあると parseContractStatus が null を返し、
 * 行ごと捨てられる。すると diffRankTracking からは「マスタ未掲載」に見えるため、
 * 契約中の店舗が黙って順位計測の対象外になる。
 * parseContractStatus 単体は「勝手に解約扱いにしない」ため安全だが、
 * パイプライン全体では解約より強い扱い（計測停止）になってしまう。
 * 捨てた行を呼び出し側へ返し、画面で気づけるようにする。
 */
export function parseMasterCsvDetailed(rows: string[][]): {
  rows: MasterRow[];
  /** ステータスを解釈できず除外した行（店舗名と元の表記） */
  unknownStatus: { shopName: string; raw: string }[];
  /**
   * 店舗名はあるがステータスが空欄の行の店舗名。
   * 「空欄は無視する」（2026-09-04 ユーザー決定）ため、呼び出し側は
   * これらを現状維持にする（マスタ未掲載として計測を止めない）
   */
  blankStatus: string[];
} {
  const out: MasterRow[] = [];
  const unknownStatus: { shopName: string; raw: string }[] = [];
  const blankStatus: string[] = [];
  const { statusCol, nameCol, dataFrom } = detectMasterLayout(rows);
  for (let i = dataFrom; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length <= Math.max(statusCol, nameCol)) continue;
    const raw = (r[statusCol] || "").trim();
    const shopName = (r[nameCol] || "").trim();
    if (!shopName) continue;
    if (shopName === "店舗名" || shopName.startsWith("店舗名")) continue; // ヘッダー
    const status = parseContractStatus(raw);
    if (!status) {
      if (raw) unknownStatus.push({ shopName, raw });
      else blankStatus.push(shopName);
      continue;
    }
    out.push({ shopName, status });
  }
  return { rows: out, unknownStatus, blankStatus };
}
