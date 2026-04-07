"use server";

import { revalidatePath } from "next/cache";
import { clearSpreadsheetCache } from "@/lib/spreadsheet";

export async function syncReportData() {
  clearSpreadsheetCache();
  revalidatePath("/report", "layout");
  return { success: true, timestamp: new Date().toISOString() };
}
