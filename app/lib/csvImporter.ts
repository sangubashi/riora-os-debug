import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { upsertCustomer, getSecureProfiles, SkinType, CustomerType } from "./customerManager";
import { normalizePhone } from "./hash";
import { runAnalysis, defaultAnalysis, AnalysisResult } from "../engine/analysisEngine";

// ============================================================
// SalonBoard CSV カラムマッピング
// 複数のヘッダー名に対応（バージョン差異を吸収）
// ============================================================
const COLUMN_MAP = {
  lastNameKana: ["姓（カナ）", "セイ", "お名前（カナ）姓", "last_name_kana"],
  firstNameKana:["名（カナ）", "メイ", "お名前（カナ）名"],
  phone:        ["電話番号", "携帯電話", "携帯", "TEL", "phone"],
  birthday:     ["生年月日", "誕生日", "birthday"],
  visitCount:   ["来店回数", "来店数", "visit_count"],
  lastVisitAt:  ["最終来店日", "最終来店", "last_visit"],
  salesAmount:  ["累計売上", "売上合計", "総売上", "sales_total"],
  skinType:     ["肌タイプ", "肌質", "skin_type"],
  customerType: ["顧客タイプ", "カテゴリ", "customer_type"],
  notes:        ["備考", "メモ", "スタッフメモ", "notes"],
} as const;

const SKIN_TYPE_MAP: Record<string, SkinType> = {
  乾燥肌: "dry",     乾燥: "dry",     dry: "dry",
  脂性肌: "oily",    オイリー: "oily", oily: "oily",
  混合肌: "combination",               combination: "combination",
  敏感肌: "sensitive",                 sensitive: "sensitive",
  普通肌: "normal",  標準: "normal",   normal: "normal",
};

const CUSTOMER_TYPE_MAP: Record<string, CustomerType> = {
  誠実: "sincere", 誠実タイプ: "sincere", sincere: "sincere",
  スピード: "speed", 効率: "speed",        speed: "speed",
  ラグジュアリー: "luxury", 高感度: "luxury", luxury: "luxury",
};

// ============================================================
// ユーティリティ
// ============================================================
function resolveColumn(row: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key].trim();
  }
  return "";
}

function parseBirthday(raw: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  return parseInt(raw.replace(/[¥,￥\s]/g, ""), 10) || 0;
}

// ============================================================
// 型定義
// ============================================================
export interface ImportResult {
  total: number;
  success: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  importedHashIds: string[];
  analysisResults: AnalysisResult[];
}

export interface ImportOptions {
  // フック未登録時は defaultAnalysis を使う
  runDefaultAnalysisOnComplete?: boolean;
  // バッチサイズ（大量 CSV 向け）
  batchSize?: number;
}

// ============================================================
// メイン: SalonBoard CSV → Supabase（フック付き）
// ============================================================
export async function importSalonBoardCsv(
  filePath: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const { runDefaultAnalysisOnComplete = true, batchSize = 50 } = options;

  // BOM 除去（Excel保存のCSV対応）
  const raw = fs.readFileSync(filePath, "utf-8").replace(/^﻿/, "");

  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const result: ImportResult = {
    total: rows.length,
    success: 0,
    skipped: 0,
    errors: [],
    importedHashIds: [],
    analysisResults: [],
  };

  // バッチ処理
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (row, batchIndex) => {
        const rowNum = i + batchIndex + 2; // CSVは1行目ヘッダー、2行目からデータ
        const rawPhone = resolveColumn(row, COLUMN_MAP.phone);

        if (!rawPhone) {
          result.skipped++;
          return;
        }

        try {
          const normalized = normalizePhone(rawPhone);
          if (!/^0\d{9,10}$/.test(normalized)) {
            result.errors.push({ row: rowNum, reason: `無効な電話番号: "${rawPhone}"` });
            return;
          }

          const skinRaw     = resolveColumn(row, COLUMN_MAP.skinType);
          const custTypeRaw = resolveColumn(row, COLUMN_MAP.customerType);

          const hashId = await upsertCustomer(
            {
              phone:        rawPhone,
              lastNameKana: resolveColumn(row, COLUMN_MAP.lastNameKana) || undefined,
            },
            {
              birthday:     parseBirthday(resolveColumn(row, COLUMN_MAP.birthday)),
              skinType:     SKIN_TYPE_MAP[skinRaw]     ?? undefined,
              customerType: CUSTOMER_TYPE_MAP[custTypeRaw] ?? undefined,
              visitCount:   parseInt(resolveColumn(row, COLUMN_MAP.visitCount), 10) || 1,
              salesAmount:  parseAmount(resolveColumn(row, COLUMN_MAP.salesAmount)),
              lastVisitAt:  resolveColumn(row, COLUMN_MAP.lastVisitAt) || undefined,
              notes:        resolveColumn(row, COLUMN_MAP.notes)       || undefined,
            }
          );

          result.importedHashIds.push(hashId);
          result.success++;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ row: rowNum, reason: message });
        }
      })
    );

    console.log(`[csvImporter] ${Math.min(i + batchSize, rows.length)}/${rows.length} 件処理済み`);
  }

  // ── インポート完了フック: 解析エンジンを呼び出す ──────────
  if (result.importedHashIds.length > 0) {
    const profiles = await getSecureProfiles(result.importedHashIds);

    // runAnalysis は内部で組み込みエンジン or カスタムフックを選択し DB 書き戻しまで行う
    const analysisResults = await runAnalysis({
      importedHashIds: result.importedHashIds,
      profiles,
      importedAt: new Date().toISOString(),
      sourceFile: path.basename(filePath),
      summary: {
        total:      result.total,
        success:    result.success,
        skipped:    result.skipped,
        errorCount: result.errors.length,
      },
    });

    result.analysisResults =
      analysisResults.length > 0
        ? analysisResults
        : runDefaultAnalysisOnComplete
        ? defaultAnalysis(profiles)
        : [];
  }

  return result;
}

// ============================================================
// CLI 実行: npx ts-node -r dotenv/config app/lib/csvImporter.ts <file.csv>
// ============================================================
if (require.main === module) {
  require("dotenv").config();
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("使い方: ts-node -r dotenv/config app/lib/csvImporter.ts <CSVファイル>");
    process.exit(1);
  }

  importSalonBoardCsv(filePath).then((result) => {
    console.log("\n=== インポート結果 ===");
    console.log(`合計:        ${result.total}件`);
    console.log(`成功:        ${result.success}件`);
    console.log(`スキップ:    ${result.skipped}件（電話番号なし）`);
    console.log(`エラー:      ${result.errors.length}件`);
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.log(`  行 ${e.row}: ${e.reason}`));
    }

    if (result.analysisResults.length > 0) {
      console.log("\n=== 解析結果（サンプル） ===");
      result.analysisResults.slice(0, 3).forEach((r) => {
        console.log(`  ${r.hashId.slice(0, 8)}... タイプ:${r.salonType} リスク:${r.riskScore} メニュー:${r.recommendedMenu}`);
      });
    }
  });
}
