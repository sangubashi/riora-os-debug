'use client'
/**
 * batchUpload.ts — 写真ライブラリ複数選択 → 仮分類 → 一括アップロード(Photo Karte Phase2)
 *
 * 設計根拠: PHOTO_KARTE Phase2調査(READ ONLY設計)で確定した方針。
 *   - 既存のカメラ撮影フロー(captureConfirmFlow.ts・usePhotoCapture.ts)とは完全に独立させる
 *     (共有するのは uploadCustomerPhoto() のみ)。
 *   - 写真カルテ Phase A(原本保存): 選択されたFileをconvertImageFileToWebpBlob()に通して
 *     縮小・WebP再エンコードする処理は廃止した。iPad標準カメラのHEIC/JPEG原本を画質劣化
 *     させずそのままStorageへ保存することを優先する(「画質を良くする」ための新しい圧縮を
 *     追加するのではなく「元画像を壊さない」ことを最優先する設計判断)。FileはBlobの
 *     サブタイプのため uploadCustomerPhoto() の型は無変更で受け付けられる。MIME許可・
 *     拡張子対応はconstants.ts側(ALLOWED_PHOTO_MIME_TYPES/PHOTO_MIME_EXTENSIONS)に
 *     HEIC/HEIFを追加するだけで、route.ts・commitCustomerPhoto.ts・photoApiClient.tsは
 *     いずれも無変更のまま新形式を受け付けられる(既存が汎用実装のため)。カメラ撮影失敗時の
 *     フォールバック(usePhotoCapture.tsのcaptureFromFile()、fileToWebpBlob.ts使用)は
 *     今回のPhase Aのスコープ外のため無変更。
 *   - 新しい一括アップロードAPIは作らず、既存の POST /api/customers/[id]/photos を
 *     写真の枚数分だけ呼ぶ(uploadCustomerPhoto()をそのまま利用)。
 *   - Photo LibraryではEXIF撮影日時をまだ取得していないため、File.lastModifiedを暫定日時
 *     (takenAt)として利用し、取得できない場合のみ既存API仕様どおりサーバー側 now() に
 *     フォールバックする(resolveTakenAtFromFile()参照。既存のカメラ撮影フローは
 *     takenAt省略のまま変更しない)。
 *   - PHOTO_LABEL_REALIGN_1(2026-09-13): 自動の画像解析・顔向き判定は行わない方針は維持しつつ、
 *     以前あった「3枚ちょうどの場合だけ正面/左45°/右45°を仮割当てする」決定論ルールは廃止した。
 *     実際の撮影スタイル(施術ベッドで仰向け、正面・斜め・顎・額のバリエーション)と合わず、
 *     3枚以外の枚数だと複数枚が同じ仮タグのまま登録されてしまい、お客様モードの
 *     「同一撮影機会は代表1枚に集約する」設計と衝突して一部の写真が表示上見えなくなる
 *     問題が実際に発生したため(小宮山仁美様の実例)。枚数によらず、全アイテムは
 *     「未選択」状態で開始し、スタッフが明示的に部位を選ぶまでbodyPartは空文字のまま
 *     (呼び出し側PhotoLibraryPickerView.tsxが未選択がある間は登録ボタンをdisabledにする)。
 */
import { uploadCustomerPhoto } from './photoApiClient'

export type BatchItemStatus = 'idle' | 'uploading' | 'success' | 'error'

export interface BatchPhotoItem {
  id:            string
  file:          File
  /** サムネイル表示用のobject URL。使い終わったら revokeBatchItemPreviews() で解放すること。 */
  previewUrl:    string
  /** 空文字 = まだ部位が未選択(登録不可)。スタッフが選ぶとbodyParts.tsのidが入る。 */
  bodyPart:      string
  /** 部位が未選択(bodyPart === '')かどうかの意味に変更した(旧: 3枚ルールによる仮割当てかどうか)。 */
  isProvisional: boolean
  status:        BatchItemStatus
  error?:        string
}

/**
 * 選択されたFile[]から確認画面用の初期状態を組み立てる(アップロードは一切行わない・純粋関数)。
 * PHOTO_LABEL_REALIGN_1: 自動仮割当ては行わず、全アイテムを常に「未選択」(bodyPart: '',
 * isProvisional: true)で開始する。スタッフが確認画面で明示的に部位を選ぶまで登録できない
 * (呼び出し側のゲート判定と対になる)。
 */
export function buildBatchItems(files: File[]): BatchPhotoItem[] {
  return files.map(file => ({
    id:            crypto.randomUUID(),
    file,
    previewUrl:    URL.createObjectURL(file),
    bodyPart:      '',
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
 * 1件分のアップロード。原本(item.file)をそのまま → 既存 POST /api/customers/[id]/photos。
 * 写真カルテ Phase A: 以前はここでconvertImageFileToWebpBlob()による縮小・WebP再エンコードを
 * 行っていたが廃止した。item.file(Blobのサブタイプ)をそのままuploadCustomerPhoto()へ渡す。
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
    await uploadCustomerPhoto(customerId, {
      blob:            item.file,
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
