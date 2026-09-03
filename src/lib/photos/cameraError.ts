/**
 * cameraError.ts — getUserMedia失敗の分類
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-9節「カメラ起動失敗時の画面」の3パターン。
 *   - permission_denied: 権限拒否(NotAllowedError/PermissionDeniedError)
 *   - unsupported:       mediaDevices自体が存在しない(非対応端末・非HTTPS等)
 *   - other:             その他の失敗(カメラ使用中・一時的な不調等)
 */

export type CameraErrorKind = 'permission_denied' | 'unsupported' | 'other'

/**
 * @param error getUserMediaが投げた例外(またはタイムアウト等の任意のエラー)。
 * @param mediaDevicesAvailable navigator.mediaDevices.getUserMediaの存在チェック結果。
 *   falseの場合、そもそもgetUserMediaを呼ぶ前の判定として'unsupported'を返す
 *   (1-9節: 非対応時は「もう一度試す」ボタン自体を出さないため、呼び出し側が
 *   この関数を呼ぶ前にAPI存在チェックで先に'unsupported'を確定させてもよい)。
 */
export function classifyCameraError(
  error: unknown,
  mediaDevicesAvailable: boolean
): CameraErrorKind {
  if (!mediaDevicesAvailable) return 'unsupported'

  const name = error instanceof Error ? error.name : undefined
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'permission_denied'
  }
  // NotFoundError(カメラデバイスなし)/NotReadableError(他アプリ使用中)/
  // OverconstrainedError/AbortError等はすべて「その他の失敗」として扱う
  // (再試行に意味がある一時的な問題として案内する、1-9節の表)。
  return 'other'
}
