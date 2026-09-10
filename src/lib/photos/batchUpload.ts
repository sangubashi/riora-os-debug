'use client'
/**
 * batchUpload.ts — 写真ライブラリ複数選択 → 仮分類 → 一括アップロード(Photo Karte Phase2)
 *
 * 設計根拠: PHOTO_KARTE Phase2調査(READ ONLY設計)で確定した方針。
 *   - 既存のカメラ撮影フロー(captureConfirmFlow.ts・usePhotoCapture.ts)とは完全に独立させる
 *     (共有するのは convertImageFileToWebpBlob() / uploadCustomerPhoto() のみ)。
 *   - 新しい一括アップロードAPIは作らず、既存の POST /api/customers/[id]/photos を
 *     写真の枚数分だけ呼ぶ(uploadCustomerPhoto()をそのまま利用)。
 *   - Photo LibraryではEXIF撮影日時をまだ取得していないため、File.lastModifiedを暫定日時
 *     (takenAt)として利用し、取得できない場合のみ既存API仕様どおりサーバー側 now() に
 *     フォールバックする(resolveTakenAtFromFile()参照。既存のカメラ撮影フローは
 *     takenAt省略のまま変更しない)。
 *   - 完全自動の画像解析・顔向き判定は今回実装しない。THREE_SHOT_SEQUENCEによる
 *     「3枚ちょうどの場合だけ正面/左45°/右45°を仮割当て」という決定論ルールのみを持つ。
 *     将来、画像解析による判定を追加する場合は buildBatchItems() の中身を差し替えるだけで済み、
 *     呼び出し側(PhotoLibraryPickerView.tsx)のインターフェースは変えずに拡張できる。
 */
import { convertImageFileToWebpBlob } from './fileToWebpBlob'
import { uploadCustomerPhoto } from './photoApiClient'
import { DEFAULT_BODY_PART } from './bodyParts'

export type BatchItemStatus = 'idle' | 'uploading' | 'success' | 'error'

export interface BatchPhotoItem {
  id:            string
  file:          File
  /** サムネイル表示用のobject URL。使い終わったら revokeBatchItemPreviews() で解放すること。 */
  previewUrl:    string
  bodyPart:      string
  /** 3枚ルールによる仮割当てかどうか。スタッフが部位を変更したらfalseにする。 */
  isProvisional: boolean
  status:        BatchItemStatus
  error?:        string
}

/**
 * 3枚ちょうどの場合だけ適用する仮分類の並び順(bodyParts.tsのid)。
 * 顔向きの画像解析は行わず、あくまで「選んだ順序」による決定論的な仮割当て。
 */
const THREE_SHOT_SEQUENCE = ['face_front', 'face_left45', 'face_right45'] as const

/**
 * 選択されたFile[]から確認画面用の初期状態を組み立てる(アップロードは一切行わない・純粋関数)。
 * ちょうど3枚の場合のみ 1枚目=正面/2枚目=左45°/3枚目=右45° を仮割当てする。
 * それ以外(1〜2枚・4枚以上)はDEFAULT_BODY_PART(顔全体・正面)をフォールバック値として使うが、
 * これも実際の内容を確認したものではないため、3枚ルール適用時と同じくisProvisional: trueとし、
 * 確認画面で「(仮)」バッジを表示させてスタッフに確認・修正を促す(READ ONLY調査で判明した、
 * 3枚以外は無警告でface_frontに分類される問題への対応)。
 */
export function buildBatchItems(files: File[]): BatchPhotoItem[] {
  const useThreeShotRule = files.length === THREE_SHOT_SEQUENCE.length
  return files.map((file, i) => ({
    id:            crypto.randomUUID(),
    file,
    previewUrl:    URL.createObjectURL(file),
    bodyPart:      useThreeShotRule ? THREE_SHOT_SEQUENCE[i] : DEFAULT_BODY_PART,
    isProvisional: true,
    status:        'idle' as const,
  }))
}

/** 確認画面を閉じる際に呼ぶこと(object URLのメモリリークを防ぐ)。 */
export function revokeBatchItemPreviews(items: BatchPhotoItem[]): void {
  items.forEach(item => {
    try {
      URL.revokeObjectURL(item.previewUrl)
    } catch {
      // 既に解放済み等は無視してよい
    }
  })
}

export interface UploadBatchItemResult {
  itemId: string
  ok:     boolean
  error?: string
}

/**
 * File.lastModifiedをtakenAt候補として使う(Phase2の写真ライブラリ選択のみ対象)。
 * Photo LibraryではEXIF撮影日時をまだ取得していないため、File.lastModifiedを暫定日時として
 * 利用し、取得できない場合のみサーバー側now()にfallbackする(実際の撮影日時とは限らない
 * 近似値であり、EXIF解析の代替として断定はしない)。
 * 0以下・非有限値(ブラウザによってlastModifiedが取得できない場合の既知の挙動)はfallback対象とする。
 */
function resolveTakenAtFromFile(file: File): string | undefined {
  const ms = file.lastModified
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return new Date(ms).toISOString()
}

/**
 * 1件分のアップロード。WebP変換 → 既存 POST /api/customers/[id]/photos。
 * 例外を投げず必ず結果オブジェクトを返す(呼び出し側のPromise.allSettledを全件fulfilledにするため)。
 * photoTypeは常に'progress'固定(ライブラリ由来の写真はbefore/afterのチェックリストに
 * 紐付かないため。既存のbrain_customer_photos.photo_typeデフォルト値と同じ)。
 */
async function uploadOne(
  customerId: string,
  visitId:    string | null,
  item:       BatchPhotoItem,
): Promise<UploadBatchItemResult> {
  try {
    const blob = await convertImageFileToWebpBlob(item.file)
    await uploadCustomerPhoto(customerId, {
      blob,
      bodyPart:        item.bodyPart,
      photoType:       'progress',
      visitId,
      takenAt:         resolveTakenAtFromFile(item.file),
      // 写真ごとに一意(冪等性の単位)。再送時も毎回新規に発行するため、
      // 一度失敗したアップロードを再送しても既存写真と衝突しない。
      clientRequestId: crypto.randomUUID(),
    })
    return { itemId: item.id, ok: true }
  } catch (e) {
    return { itemId: item.id, ok: false, error: e instanceof Error ? e.message : 'upload_failed' }
  }
}

/**
 * 複数件を並行アップロードする。1枚の失敗が他の写真の成功を取り消さないよう
 * Promise.allSettledで包む(uploadOne自体は例外を投げないため通常は全件fulfilledになるが、
 * 予期しない例外に対する構造的な保険として明示的に使う)。
 */
export async function uploadBatch(
  customerId: string,
  visitId:    string | null,
  items:      BatchPhotoItem[],
): Promise<UploadBatchItemResult[]> {
  const settled = await Promise.allSettled(items.map(item => uploadOne(customerId, visitId, item)))
  return settled.map((s, i) =>
    s.status === 'fulfilled' ? s.value : { itemId: items[i].id, ok: false, error: 'unexpected_failure' }
  )
}

export interface BatchUploadSummary {
  successCount: number
  failureCount: number
  /** 呼び出し側(PhotoLibraryPickerView.tsx)がtoast等で表示するための文言。 */
  message:      string
  isError:      boolean
}

/**
 * uploadBatch()の結果から、ユーザー向けの要約メッセージを組み立てる(純粋関数)。
 * 「選択して追加」経路で失敗が既存の各サムネイル下の小さな赤文字のみに留まり
 * 気づかれにくかった問題への対応(呼び出し側でtoast表示する際の文言をここで決定する)。
 */
export function summarizeUploadResults(results: UploadBatchItemResult[]): BatchUploadSummary {
  const successCount = results.filter(r => r.ok).length
  const failureCount = results.length - successCount

  if (failureCount === 0) {
    return { successCount, failureCount, message: `${successCount}枚登録しました`, isError: false }
  }
  if (successCount === 0) {
    return { successCount, failureCount, message: `登録に失敗しました（${failureCount}枚）`, isError: true }
  }
  return {
    successCount, failureCount,
    message: `${successCount}枚登録しました（${failureCount}枚は失敗）`,
    isError: true,
  }
}
