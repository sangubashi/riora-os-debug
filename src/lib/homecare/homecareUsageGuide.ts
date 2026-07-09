/**
 * homecareUsageGuide.ts — ホームケア商品「使い方カード」暫定辞書 (PHASE HC-4)
 *
 * 商品マスタ（商品名・カテゴリ・使用方法を持つテーブル）が未整備のため、
 * まずはコード内の辞書で暫定対応する。DB・migrationは使用しない。
 *
 * キーは /api/customers/[id]/homecare-products が返す productName（PHASE HC-2Dの
 * normalizeProductName適用後の正規化済み商品名）と完全一致させること。
 * PHASE HC-3調査で確認した実データ（22商品）のうち、商品名が具体的な18商品を収録。
 * 「LebyRIN サンプル」（サンプル提供の可能性がありカルテ記入注記付き）・
 * 「店販：基礎化粧品セット」（個別商品でない汎用バンドル名）は使い方を断定できないため
 * 意図的に未収録（→表示は「使い方情報未登録」）。
 * 「ラッシュアディクト」は依頼時の例示に含まれていたため収録（現時点の実データには
 * 存在しないが、将来の取込データで一致すれば使える）。
 */

export interface HomecareUsageGuide {
  frequency:     string
  timing:        string
  caution:       string
  /** スタッフがそのままコピーして送れるメッセージ文面を生成する */
  staffMessage:  (customerName: string) => string
}

function buildMessage(
  customerName: string,
  productName:  string,
  frequency:    string,
  timing:       string,
  caution:      string,
): string {
  return `${customerName}様\n\n${productName}の使い方のご案内です。\n${frequency}、${timing}にお使いください。\n${caution}\nご不明な点があればいつでもご連絡ください🌸`
}

export const HOMECARE_USAGE_GUIDE: Record<string, HomecareUsageGuide> = {
  'ラッシュアディクト': {
    frequency: '1日1回',
    timing:    '就寝前、まつ毛の生え際に塗布',
    caution:   '目に入らないようご注意ください。異常を感じた場合は使用を中止してください。',
    staffMessage: (name) => buildMessage(name, 'ラッシュアディクト', '1日1回', '就寝前、まつ毛の生え際に塗布', '目に入らないようご注意ください。異常を感じた場合は使用を中止してください。'),
  },
  'CELCOS クリーム': {
    frequency: '朝晩1日2回',
    timing:    '洗顔・化粧水・美容液の後、スキンケアの最後に',
    caution:   '傷や炎症がある部分には使用しないでください。',
    staffMessage: (name) => buildMessage(name, 'CELCOSクリーム', '朝晩1日2回', '洗顔・化粧水・美容液の後、スキンケアの最後', '傷や炎症がある部分には使用しないでください。'),
  },
  'CELCOS セラム': {
    frequency: '朝晩1日2回',
    timing:    '化粧水の後、クリームの前に',
    caution:   '肌に合わない場合は使用を中止し、無理に続けないでください。',
    staffMessage: (name) => buildMessage(name, 'CELCOSセラム', '朝晩1日2回', '化粧水の後、クリームの前', '肌に合わない場合は使用を中止し、無理に続けないでください。'),
  },
  'CELCOS ローション': {
    frequency: '朝晩1日2回',
    timing:    '洗顔直後、肌が乾く前に',
    caution:   'コットンでなじませる場合は肌をこすりすぎないでください。',
    staffMessage: (name) => buildMessage(name, 'CELCOSローション', '朝晩1日2回', '洗顔直後、肌が乾く前', 'コットンでなじませる場合は肌をこすりすぎないでください。'),
  },
  'CO2シートマスク': {
    frequency: '週1〜2回',
    timing:    '洗顔後、10〜15分程度パック',
    caution:   'ピリつきや赤みを感じた場合はすぐに取り外し洗い流してください。',
    staffMessage: (name) => buildMessage(name, 'CO2シートマスク', '週1〜2回', '洗顔後10〜15分程度のパック', 'ピリつきや赤みを感じた場合はすぐに取り外し洗い流してください。'),
  },
  'GD-11 アンプルミスト': {
    frequency: '1日2〜3回',
    timing:    '化粧水の前後、乾燥が気になる時に',
    caution:   '顔から適度な距離を保ってスプレーしてください。',
    staffMessage: (name) => buildMessage(name, 'GD-11アンプルミスト', '1日2〜3回', '化粧水の前後や乾燥が気になる時', '顔から適度な距離を保ってスプレーしてください。'),
  },
  'GD-11 シートマスク': {
    frequency: '週1〜2回',
    timing:    '洗顔後、10〜15分程度パック',
    caution:   '肌に異常を感じた場合はすぐに使用を中止してください。',
    staffMessage: (name) => buildMessage(name, 'GD-11シートマスク', '週1〜2回', '洗顔後10〜15分程度のパック', '肌に異常を感じた場合はすぐに使用を中止してください。'),
  },
  'HARIBIN 95': {
    frequency: '朝晩1日2回',
    timing:    'スキンケアの気になる工程で少量を重ねづけ',
    caution:   '目元・口元など皮膚の薄い部分は少量から試してください。',
    staffMessage: (name) => buildMessage(name, 'HARIBIN 95', '朝晩1日2回', 'スキンケアの気になる工程での少量重ねづけ', '目元・口元など皮膚の薄い部分は少量から試してください。'),
  },
  'HARIBIN ダーマエッセンス': {
    frequency: '朝晩1日2回',
    timing:    '化粧水の後、クリームの前に',
    caution:   '肌が敏感な時期は使用頻度を減らしてください。',
    staffMessage: (name) => buildMessage(name, 'HARIBINダーマエッセンス', '朝晩1日2回', '化粧水の後、クリームの前', '肌が敏感な時期は使用頻度を減らしてください。'),
  },
  'LebyRIN クリーム': {
    frequency: '朝晩1日2回',
    timing:    'スキンケアの最後、保湿の仕上げに',
    caution:   'つけすぎるとべたつく場合があるため少量ずつのばしてください。',
    staffMessage: (name) => buildMessage(name, 'LebyRINクリーム', '朝晩1日2回', 'スキンケアの最後、保湿の仕上げ', 'つけすぎるとべたつく場合があるため少量ずつのばしてください。'),
  },
  'LebyRIN クレンジング': {
    frequency: '1日1回（夜）',
    timing:    'メイクオフ時、乾いた手・顔に使用',
    caution:   '目や口に入らないよう注意し、使用後はよくすすいでください。',
    staffMessage: (name) => buildMessage(name, 'LebyRINクレンジング', '1日1回（夜）', 'メイクオフ時、乾いた手・顔への使用', '目や口に入らないよう注意し、使用後はよくすすいでください。'),
  },
  'LebyRIN セラム': {
    frequency: '朝晩1日2回',
    timing:    '化粧水の後、クリームの前に',
    caution:   '肌に合わない場合は使用を中止してください。',
    staffMessage: (name) => buildMessage(name, 'LebyRINセラム', '朝晩1日2回', '化粧水の後、クリームの前', '肌に合わない場合は使用を中止してください。'),
  },
  'LebyRIN ローション': {
    frequency: '朝晩1日2回',
    timing:    '洗顔直後、肌が乾く前に',
    caution:   '乾燥が強い場合は重ねづけしてください。',
    staffMessage: (name) => buildMessage(name, 'LebyRINローション', '朝晩1日2回', '洗顔直後、肌が乾く前', '乾燥が強い場合は重ねづけしてください。'),
  },
  'LebyRIN 洗顔': {
    frequency: '朝晩1日2回',
    timing:    '洗顔時、よく泡立ててから使用',
    caution:   'ゴシゴシこすらず、泡でやさしく包むように洗ってください。',
    staffMessage: (name) => buildMessage(name, 'LebyRIN洗顔', '朝晩1日2回', '洗顔時（よく泡立ててから使用）', 'ゴシゴシこすらず、泡でやさしく包むように洗ってください。'),
  },
  'LedyRIN UVクリーム': {
    frequency: '朝1回（日中は2〜3時間おきに塗り直し）',
    timing:    'スキンケアの最後、外出前に',
    caution:   '汗をかいた後や長時間の外出時はこまめに塗り直してください。',
    staffMessage: (name) => buildMessage(name, 'UVクリーム', '朝1回（日中は2〜3時間おきに塗り直し）', 'スキンケアの最後、外出前', '汗をかいた後や長時間の外出時はこまめに塗り直してください。'),
  },
  'RIN エッセンスローション': {
    frequency: '朝晩1日2回',
    timing:    '洗顔直後、肌が乾く前に',
    caution:   'コットンよりも手でなじませる方が肌への負担が少ないです。',
    staffMessage: (name) => buildMessage(name, 'RINエッセンスローション', '朝晩1日2回', '洗顔直後、肌が乾く前', 'コットンよりも手でなじませる方が肌への負担が少ないです。'),
  },
  'RIN スピキュールクリーム': {
    frequency: '週2〜3回（夜）',
    timing:    'スキンケアの最後、就寝前に',
    caution:   '使用直後に肌がピリつくことがあるため初回は少量から試してください。',
    staffMessage: (name) => buildMessage(name, 'RINスピキュールクリーム', '週2〜3回（夜）', 'スキンケアの最後、就寝前', '使用直後に肌がピリつくことがあるため初回は少量から試してください。'),
  },
  'RIN モイスチャークリーム': {
    frequency: '朝晩1日2回',
    timing:    'スキンケアの最後、保湿の仕上げに',
    caution:   '乾燥が特に気になる部分は重ねづけしてください。',
    staffMessage: (name) => buildMessage(name, 'RINモイスチャークリーム', '朝晩1日2回', 'スキンケアの最後、保湿の仕上げ', '乾燥が特に気になる部分は重ねづけしてください。'),
  },
  'RIN モイスチャーセラム': {
    frequency: '朝晩1日2回',
    timing:    '化粧水の後、クリームの前に',
    caution:   '肌に合わない場合は使用を中止してください。',
    staffMessage: (name) => buildMessage(name, 'RINモイスチャーセラム', '朝晩1日2回', '化粧水の後、クリームの前', '肌に合わない場合は使用を中止してください。'),
  },
  '水素サプリ': {
    frequency: '1日1〜2粒',
    timing:    '食後に水またはぬるま湯で',
    caution:   '持病がある方・妊娠中の方は事前に医師にご相談ください。',
    staffMessage: (name) => buildMessage(name, '水素サプリ', '1日1〜2粒', '食後に水またはぬるま湯で', '持病がある方・妊娠中の方は事前に医師にご相談ください。'),
  },
}

export function getHomecareUsageGuide(productName: string): HomecareUsageGuide | null {
  return HOMECARE_USAGE_GUIDE[productName] ?? null
}
