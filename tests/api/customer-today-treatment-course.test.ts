// ================================================================
// PUT /api/customers/[id]/today-treatment-course ルートレベル受入テスト
//
// 「今回の施術コース」保存(2026-09-28ユーザー承認・追加対応)。brain_visitsは実際には
// 翌日以降SalonBoard CSVインポートで一括作成されるため、来店当日にはvisitが存在しない
// ことがほとんどだった。このAPIは「現場の入力が正である」方針のもと、本日分のvisitが
// 無ければその場で作成する(findByCustomerAndDate→無ければcreateSequenced())。
// csvImportPipeline.ts/VisitRepo.reconcile()自体には一切触れない(既存の安全な
// 突合ロジックを再利用するのみ)。
// ================================================================
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestingStaff } from '../../src/lib/auth/extractStaffFromRequest'
import { createFakeSupabase } from './_helpers/fakeSupabase'

vi.mock('../../src/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }))
vi.mock('../../src/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }))
vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn(), getServiceClient: vi.fn() }))

import { extractStaffFromRequest } from '../../src/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '../../src/lib/auth/canAccessCustomer'
import { getRepos, getServiceClient } from '../../app/lib/repos'
import { PUT } from '../../app/api/customers/[id]/today-treatment-course/route'

const mockExtractStaff = vi.mocked(extractStaffFromRequest)
const mockCanAccess    = vi.mocked(canAccessCustomer)
const mockGetRepos     = vi.mocked(getRepos)
const mockGetClient    = vi.mocked(getServiceClient)

const STAFF: RequestingStaff = {
  authUserId: 'auth-user-1', staffBrainId: 'brain-staff-1', email: 'staff@example.com', isAdmin: false,
}

const CUSTOMER = { id: 'cust-1', storeId: 'store-1' }

const mockRepos = {
  customerRepo: { findById: vi.fn() },
  visitRepo: {
    findByCustomerAndDate: vi.fn(),
    createSequenced: vi.fn(),
  },
}

function putRoute(customerId: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/customers/${customerId}/today-treatment-course`, {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return PUT(req, { params: Promise.resolve({ id: customerId }) })
}

afterEach(() => vi.clearAllMocks())

describe('PUT /api/customers/[id]/today-treatment-course', () => {
  it('未認証は401を返す', async () => {
    mockExtractStaff.mockResolvedValue(null)
    const res = await putRoute('cust-1', { courseOptions: [] })
    expect(res.status).toBe(401)
  })

  it('staffBrainIdが無い(brain_staff行を持たないadmin等)場合も401を返す', async () => {
    mockExtractStaff.mockResolvedValue({ authUserId: 'a', staffBrainId: null, email: 'x', isAdmin: true } as never)
    const res = await putRoute('cust-1', { courseOptions: [] })
    expect(res.status).toBe(401)
  })

  it('アクセス権のない顧客は403を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(false)
    const res = await putRoute('cust-1', { courseOptions: [] })
    expect(res.status).toBe(403)
  })

  it('存在しない顧客は404を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(null)
    mockGetRepos.mockReturnValue(mockRepos as never)
    const res = await putRoute('cust-1', { courseOptions: [] })
    expect(res.status).toBe(404)
  })

  it('本日分のvisitが既にある場合、createSequenced()は呼ばず既存visitのcourse_optionsのみ更新する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue({ id: 'visit-existing' })
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      brain_visits: { data: { id: 'visit-existing', course_options: ['スク→ポレ→炭酸'] }, error: null },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await putRoute('cust-1', { courseOptions: ['スク→ポレ→炭酸'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, visitId: 'visit-existing', courseOptions: ['スク→ポレ→炭酸'] })
    expect(mockRepos.visitRepo.createSequenced).not.toHaveBeenCalled()
    expect(fake.chainFor('brain_visits').update).toHaveBeenCalledWith({ course_options: ['スク→ポレ→炭酸'] })
  })

  it('本日分のvisitが無い場合、直近来店のmenu_idを使ってcreateSequenced()で新規作成する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue(null)
    mockRepos.visitRepo.createSequenced.mockResolvedValue({ id: 'visit-new' })
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      // 1回目: 直近来店のmenu_id検索、2回目: 最終update
      brain_visits: [
        { data: { menu_id: 'menu-prev' }, error: null },
        { data: { id: 'visit-new', course_options: ['背中ケア(内容カルテ記入)'] }, error: null },
      ],
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await putRoute('cust-1', { courseOptions: ['背中ケア(内容カルテ記入)'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, visitId: 'visit-new', courseOptions: ['背中ケア(内容カルテ記入)'] })
    expect(mockRepos.visitRepo.createSequenced).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'store-1', customerId: 'cust-1', staffId: 'brain-staff-1', menuId: 'menu-prev',
      isNomination: false, treatmentAmount: 0, retailAmount: 0,
    }))
  })

  it('直近来店が無い場合、同店舗の任意メニューへフォールバックする', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue(null)
    mockRepos.visitRepo.createSequenced.mockResolvedValue({ id: 'visit-new' })
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      brain_visits: [
        { data: null, error: null }, // 直近来店なし
        { data: { id: 'visit-new', course_options: [] }, error: null }, // 最終update
      ],
      brain_menus: { data: { id: 'menu-any' }, error: null },
    })
    mockGetClient.mockReturnValue(fake as never)

    await putRoute('cust-1', { courseOptions: [] })

    expect(mockRepos.visitRepo.createSequenced).toHaveBeenCalledWith(expect.objectContaining({ menuId: 'menu-any' }))
  })

  it('フォールバックメニューも見つからない場合は500(no_menu_available)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue(null)
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      brain_visits: { data: null, error: null },
      brain_menus: { data: null, error: null },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await putRoute('cust-1', { courseOptions: [] })
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('no_menu_available')
    expect(mockRepos.visitRepo.createSequenced).not.toHaveBeenCalled()
  })

  it('courseOptionsが14件を超える場合はvalidation_error(400)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetRepos.mockReturnValue(mockRepos as never)
    const tooMany = Array.from({ length: 15 }, (_, i) => `course-${i}`)
    const res  = await putRoute('cust-1', { courseOptions: tooMany })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('optionItemsが26件を超える場合はvalidation_error(400)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetRepos.mockReturnValue(mockRepos as never)
    const tooMany = Array.from({ length: 27 }, (_, i) => `option-${i}`)
    const res  = await putRoute('cust-1', { optionItems: tooMany })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('courseOptions・optionItemsのどちらも指定しない場合はvalidation_error(400)を返す', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockGetRepos.mockReturnValue(mockRepos as never)
    const res  = await putRoute('cust-1', {})
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('validation_error')
  })

  it('optionItemsのみ指定した場合、course_optionsは更新せずoption_itemsのみ更新する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue({ id: 'visit-existing' })
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      brain_visits: { data: { id: 'visit-existing', course_options: null, option_items: ['スクライバー'] }, error: null },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await putRoute('cust-1', { optionItems: ['スクライバー'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      success: true, visitId: 'visit-existing',
      courseOptions: null, optionItems: ['スクライバー'],
    })
    expect(fake.chainFor('brain_visits').update).toHaveBeenCalledWith({ option_items: ['スクライバー'] })
  })

  it('courseOptions・optionItemsを同時に指定した場合、両方まとめて更新する', async () => {
    mockExtractStaff.mockResolvedValue(STAFF)
    mockCanAccess.mockResolvedValue(true)
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER)
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue({ id: 'visit-existing' })
    mockGetRepos.mockReturnValue(mockRepos as never)

    const fake = createFakeSupabase({
      brain_visits: {
        data: { id: 'visit-existing', course_options: ['スク→ポレ→炭酸'], option_items: ['スクライバー'] },
        error: null,
      },
    })
    mockGetClient.mockReturnValue(fake as never)

    const res  = await putRoute('cust-1', { courseOptions: ['スク→ポレ→炭酸'], optionItems: ['スクライバー'] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      success: true, visitId: 'visit-existing',
      courseOptions: ['スク→ポレ→炭酸'], optionItems: ['スクライバー'],
    })
    expect(fake.chainFor('brain_visits').update).toHaveBeenCalledWith({
      course_options: ['スク→ポレ→炭酸'], option_items: ['スクライバー'],
    })
  })
})
