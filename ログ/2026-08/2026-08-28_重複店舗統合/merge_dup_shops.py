"""
同じGBPロケーションに紐付いた重複店舗を統合する。
  既定は dry-run（何も書かない・件数だけ表示）。実際に書くときは --apply。
  残す側(winner)= created_at が古い行（4/14 投稿シート表記）。--keep-newer で逆にできる。

やること（1組ごと、全体を1トランザクション）:
  1. shop_id / shop_name 列を持つ全テーブルで loser → winner に付け替え
     （一意制約に当たった行は winner 側に既にあるので loser 側の行を削除）
  2. winner.gbp_shop_name に GBP正式名（loser.gbp_shop_name または loser.name）を補完
  3. loser を論理削除: deleted_at=now(), gbp_location_name/gbp_full_path=NULL, name に「【統合済→winner】」を付ける
     （同期が loser を再び GBP名で拾わないため。物理削除はしない＝FK CASCADE で消える履歴を守る）
  4. 書き換え前の loser 側の行を JSON にバックアップ（scratchpad/merge_backup_<日時>.json）
"""
import psycopg2, psycopg2.extras, sys, io, json, datetime, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
APPLY = "--apply" in sys.argv
KEEP_NEWER = "--keep-newer" in sys.argv
PW = open(r"C:\Users\pasok\.secrets\chubby-meo\メモ.txt", encoding="utf-8").read().split("データベースパスワード :")[1].splitlines()[0].strip()
conn = psycopg2.connect(host="aws-1-ap-northeast-1.pooler.supabase.com", port=5432, dbname="postgres",
                        user="postgres.kxxwspavskhhjtiixcep", password=PW, sslmode="require", connect_timeout=20)
conn.autocommit = False
cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

SKIP_TABLES = {"shops", "shop_name_changes", "auto_post_skips", "audit_logs"}  # 履歴系はそのまま残す

cur.execute("""select s.id, s.name, s.gbp_shop_name, s.gbp_location_name, s.created_at from shops s
  where s.deleted_at is null and s.gbp_location_name in (
    select gbp_location_name from shops where deleted_at is null and gbp_location_name is not null
    group by gbp_location_name having count(*) > 1) order by s.gbp_location_name, s.created_at""")
rows = cur.fetchall()
pairs = {}
for r in rows: pairs.setdefault(r["gbp_location_name"], []).append(r)

cur.execute("""select table_name, column_name from information_schema.columns
  where table_schema='public' and column_name in ('shop_id','shop_name') order by table_name""")
tabcols = {}
for t, c in cur.fetchall():
    if t in SKIP_TABLES: continue
    tabcols.setdefault(t, set()).add(c)

# 一意インデックスの列（衝突した loser 行に対応する winner 行を探すため）
cur.execute("""select tablename, indexdef from pg_indexes where schemaname='public' and indexdef ilike 'create unique%'""")
uniq = {}
for t, d in cur.fetchall():
    cols = [c.strip().strip('"') for c in d[d.rfind("(")+1:d.rfind(")")].split(",")]
    uniq.setdefault(t, []).append(cols)
CACHE_TABLES = {"performance_metrics_cache", "search_query_cache", "report_analysis", "report_data_cache"}
def brief(row, skip=("ctid","id","shop_id","shop_name","created_at","updated_at")):
    out = []
    for k, v in row.items():
        if k in skip or v is None: continue
        if k == "results" and isinstance(v, list):
            # 多地点順位: 中心1地点の順位だけ見せる（rank / position のどちらかに入っている）
            r0 = v[0] if v else {}
            v = f"順位={r0.get('rank', r0.get('position', r0.get('rank_position', '?')))}"
        out.append(f"{k}={str(v)[:60]}")
    return ", ".join(out)[:300]
def show_conflict(t, cs, lr, winner):
    if t in CACHE_TABLES: return
    # 主キー(id)だけの索引は衝突の原因ではないので、shop_id/shop_name を含む一意索引だけを見る
    cand = [c for c in uniq.get(t, []) if ("shop_id" in c or "shop_name" in c)]
    for cols in cand:
        params = []
        for c in cols:
            if c == "shop_id": params.append(winner["id"])
            elif c == "shop_name": params.append(winner["name"])
            elif c in lr: params.append(lr[c])
            else: break
        else:
            try:
                cur.execute(f'select * from "{t}" where ' + " and ".join(f'"{c}" = %s' for c in cols), params)
                w = cur.fetchone()
                print(f"      衝突[{t} / {'+'.join(cols)}]")
                print(f"        消す側: {brief(lr)}")
                print(f"        残す側: {brief(dict(w)) if w else '(見つからず)'}")
                return
            except Exception:
                cur.execute("rollback to savepoint r")
    print(f"      衝突[{t}] 消す側: {brief(lr)}")

backup = {}
print(f"モード: {'APPLY（書き込みます）' if APPLY else 'DRY-RUN（書き込みません）'} / 残す側: {'新しい行' if KEEP_NEWER else '古い行(4/14)'}")
print("====")
try:
    for loc, ps in pairs.items():
        if len(ps) != 2:
            print(f"!! {loc}: {len(ps)}件（2件以外はスキップ）"); continue
        ps.sort(key=lambda r: r["created_at"])
        winner, loser = (ps[1], ps[0]) if KEEP_NEWER else (ps[0], ps[1])
        print(f"◆ {loc}\n   残す: {winner['name']} ({winner['id'][:8]})\n   消す: {loser['name']} ({loser['id'][:8]})")
        moved = deleted = 0
        for t, cs in sorted(tabcols.items()):
            conds, params = [], []
            if "shop_id" in cs: conds.append('"shop_id" = %s'); params.append(loser["id"])
            if "shop_name" in cs: conds.append('"shop_name" = %s'); params.append(loser["name"])
            where = " or ".join(conds)
            cur.execute(f'select ctid::text as ctid, * from "{t}" where {where}', params)
            lrows = cur.fetchall()
            if not lrows: continue
            backup.setdefault(loser["id"], {})[t] = [dict(r) for r in lrows]
            sets, sparams = [], []
            if "shop_id" in cs: sets.append('"shop_id" = %s'); sparams.append(winner["id"])
            if "shop_name" in cs: sets.append('"shop_name" = %s'); sparams.append(winner["name"])
            tm = td = 0
            for lr in lrows:
                cur.execute("savepoint r")
                try:
                    cur.execute(f'update "{t}" set {", ".join(sets)} where ctid = %s::tid', sparams + [lr["ctid"]])
                    tm += 1
                except psycopg2.errors.UniqueViolation:
                    cur.execute("rollback to savepoint r")
                    show_conflict(t, cs, dict(lr), winner)
                    # 順位データは「値が入っている側」を残す。残す側が 0（未入力）で消す側に本物の順位があるなら
                    # 残す側の行を捨てて消す側の行を付け替える（2026/3・2026/5 の SEASIDE/Red Shoes/NOBLE で実例）
                    swapped = False
                    if t == "grid_ranking_overrides":
                        def rank_of(row):
                            rs = row.get("results") if row else None
                            r0 = rs[0] if isinstance(rs, list) and rs else {}
                            v = r0.get("rank", r0.get("position", r0.get("rank_position")))
                            try: return int(v)
                            except (TypeError, ValueError): return 0
                        cur.execute('select ctid::text as ctid, * from grid_ranking_overrides where shop_name=%s and keyword=%s and month=%s',
                                    (winner["name"], lr["keyword"], lr["month"]))
                        w = cur.fetchone()
                        if w is not None and rank_of(dict(w)) <= 0 and rank_of(dict(lr)) > 0:
                            cur.execute('delete from grid_ranking_overrides where ctid = %s::tid', (w["ctid"],))
                            cur.execute(f'update "{t}" set {", ".join(sets)} where ctid = %s::tid', sparams + [lr["ctid"]])
                            print(f"        → 残す側が未入力(0)のため、消す側の順位({rank_of(dict(lr))}位)で差し替え")
                            tm += 1; swapped = True
                    if not swapped:
                        cur.execute(f'delete from "{t}" where ctid = %s::tid', (lr["ctid"],))
                        td += 1
                cur.execute("release savepoint r")
            moved += tm; deleted += td
            print(f"   {t}: 付替 {tm}" + (f" / 重複削除 {td}" if td else ""))
        gbp_name = loser["gbp_shop_name"] or loser["name"]
        if not winner["gbp_shop_name"] or winner["gbp_shop_name"] != gbp_name:
            cur.execute("update shops set gbp_shop_name = %s where id = %s", (gbp_name, winner["id"]))
            print(f"   shops(残す側): gbp_shop_name = {gbp_name}")
        cur.execute("""update shops set deleted_at = now(), gbp_location_name = null, gbp_full_path = null,
                       name = %s where id = %s""", (f"{loser['name']}【統合済→{winner['name']}】", loser["id"]))
        print(f"   合計: 付替 {moved} / 重複削除 {deleted} / loser を論理削除")
    if APPLY:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"merge_backup_{datetime.datetime.now():%Y%m%d_%H%M%S}.json")
        with open(path, "w", encoding="utf-8") as f: json.dump(backup, f, ensure_ascii=False, default=str, indent=1)
        conn.commit()
        print("====\nCOMMIT しました。バックアップ:", path)
    else:
        conn.rollback()
        print("====\nDRY-RUN のため ROLLBACK しました（何も変更していません）。本実行は --apply を付けてください")
except Exception as e:
    conn.rollback()
    print("!! エラーのため ROLLBACK:", e)
    raise
finally:
    conn.close()
