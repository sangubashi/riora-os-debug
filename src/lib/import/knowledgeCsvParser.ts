/**
 * knowledgeCsvParser.ts — ナレッジ取込CSV(KNOWLEDGE_IMPORT_PHASE1)パーサー
 *
 * CSV列: title / url / category / keywords / summary / published_date
 * (title/url/summaryは必須。category/keywords/published_dateは省略可)
 *
 * LLM・外部API連携は一切行わない。CSVの内容をそのまま検証・整形するのみ
 * (要約生成・タグ抽出・薬機法チェック等の加工は行わない)。
 * keywords列はCSVフィールド内でカンマ区切りの値(例: "毛穴,皮脂,黒ずみ")を想定する。
 * カンマを含む値はCSV仕様どおりダブルクォートで囲む必要がある。
 */

export interface KnowledgeImportRow {
  title: string;
  sourceUrl: string;
  category: string | null;
  keywords: string[];
  summary: string;
  publishedAt: string | null;
}

export interface KnowledgeImportSkippedRow {
  lineNumber: number;
  reason: string;
  raw: Record<string, string>;
}

export interface ParseKnowledgeCsvResult {
  validRows: KnowledgeImportRow[];
  skippedRows: KnowledgeImportSkippedRow[];
  totalLines: number;
  headerError: string | null;
}

const REQUIRED_HEADERS = ['title', 'url', 'summary'] as const;
const KNOWN_HEADERS = ['title', 'url', 'category', 'keywords', 'summary', 'published_date'] as const;
const PUBLISHED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CSVテキスト全体をレコード(行=フィールド配列)の配列にパースする(RFC4180準拠・
 * 引用符内改行/カンマ/エスケープ引用符に対応)。reservationCsvParser.tsと同じ設計だが、
 * 既存の予約CSV取込機能への影響を避けるため独立実装として持つ。
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      record.push(field.trim());
      field = '';
    } else if (ch === '\r') {
      // 無視(直後の\nでレコード区切りとして処理する)
    } else if (ch === '\n') {
      record.push(field.trim());
      field = '';
      records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field.trim());
    records.push(record);
  }

  return records.filter((r) => !(r.length === 1 && r[0] === ''));
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** ヘッダー名(小文字化) → 列インデックスのマップを作る。重複ヘッダーは最初の出現を採用する。 */
function buildHeaderIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (!map.has(key)) map.set(key, i);
  });
  return map;
}

export function parseKnowledgeImportCsv(csvText: string): ParseKnowledgeCsvResult {
  const records = parseCsvRecords(csvText);

  if (records.length === 0) {
    return { validRows: [], skippedRows: [], totalLines: 0, headerError: 'CSVが空です' };
  }

  const headerIndex = buildHeaderIndex(records[0]);
  const missing = REQUIRED_HEADERS.filter((h) => !headerIndex.has(h));
  if (missing.length > 0) {
    return {
      validRows: [],
      skippedRows: [],
      totalLines: records.length - 1,
      headerError: `必須列が見つかりません: ${missing.join(', ')}`,
    };
  }

  const dataRecords = records.slice(1);
  const validRows: KnowledgeImportRow[] = [];
  const skippedRows: KnowledgeImportSkippedRow[] = [];

  const get = (record: string[], key: string): string => {
    const idx = headerIndex.get(key);
    if (idx === undefined || idx >= record.length) return '';
    return record[idx];
  };

  dataRecords.forEach((record, i) => {
    const lineNumber = i + 2; // ヘッダー行を1とした実ファイル行番号
    const raw: Record<string, string> = {};
    KNOWN_HEADERS.forEach((h) => { raw[h] = get(record, h); });

    const title = raw.title.trim();
    const url = raw.url.trim();
    const summary = raw.summary.trim();
    const categoryRaw = raw.category.trim();
    const keywordsRaw = raw.keywords.trim();
    const publishedDateRaw = raw.published_date.trim();

    if (!title) {
      skippedRows.push({ lineNumber, reason: 'titleが空です', raw });
      return;
    }
    if (!url) {
      skippedRows.push({ lineNumber, reason: 'urlが空です', raw });
      return;
    }
    if (!isValidHttpUrl(url)) {
      skippedRows.push({ lineNumber, reason: 'urlの形式が不正です(http/httpsのみ)', raw });
      return;
    }
    if (!summary) {
      skippedRows.push({ lineNumber, reason: 'summaryが空です', raw });
      return;
    }
    if (publishedDateRaw && !PUBLISHED_DATE_RE.test(publishedDateRaw)) {
      skippedRows.push({ lineNumber, reason: 'published_dateの形式が不正です(YYYY-MM-DD)', raw });
      return;
    }

    const keywords = keywordsRaw
      ? keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean)
      : [];

    validRows.push({
      title,
      sourceUrl: url,
      category: categoryRaw || null,
      keywords,
      summary,
      publishedAt: publishedDateRaw || null,
    });
  });

  return { validRows, skippedRows, totalLines: dataRecords.length, headerError: null };
}
