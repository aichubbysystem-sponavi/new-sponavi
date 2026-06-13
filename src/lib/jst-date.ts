/** 日本時間（JST = UTC+9）の今日の日付をYYYY-MM-DD形式で返す */
export function jstToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** 日本時間の現在月をYYYY-MM形式で返す */
export function jstCurrentMonth(): string {
  return jstToday().slice(0, 7);
}

/** 日本時間のDateオブジェクトを返す */
export function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
