// ================================================================
// cameraError.ts — getUserMedia失敗の分類テスト
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-9節
// ================================================================
import { describe, expect, it } from 'vitest'
import { classifyCameraError } from '../../../src/lib/photos/cameraError'

function domException(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

describe('classifyCameraError', () => {
  it('mediaDevicesAvailable=falseの場合は常にunsupportedを返す', () => {
    expect(classifyCameraError(null, false)).toBe('unsupported')
    expect(classifyCameraError(domException('NotAllowedError'), false)).toBe('unsupported')
  })

  it('NotAllowedError/PermissionDeniedErrorはpermission_deniedを返す', () => {
    expect(classifyCameraError(domException('NotAllowedError'), true)).toBe('permission_denied')
    expect(classifyCameraError(domException('PermissionDeniedError'), true)).toBe('permission_denied')
  })

  it('NotFoundError/NotReadableError等はotherを返す(再試行に意味がある一時的な問題として扱う)', () => {
    expect(classifyCameraError(domException('NotFoundError'), true)).toBe('other')
    expect(classifyCameraError(domException('NotReadableError'), true)).toBe('other')
    expect(classifyCameraError(domException('OverconstrainedError'), true)).toBe('other')
  })

  it('未知のエラー・非Errorオブジェクトもotherにフォールバックする', () => {
    expect(classifyCameraError('some string error', true)).toBe('other')
    expect(classifyCameraError(undefined, true)).toBe('other')
  })
})
