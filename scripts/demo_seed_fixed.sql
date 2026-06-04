-- ============================================================
-- SALON RIORA デモデータ一括シード（構文修正済み版）
-- Supabase SQL Editor で実行：
-- https://supabase.com/dashboard/project/ohszxgajckzphhfhdrsv/sql/new
-- ============================================================

-- ─── 0. 権限・RLS 修正 ──────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_logs   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_all" ON customers;
CREATE POLICY "demo_all" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "demo_all" ON reservations;
CREATE POLICY "demo_all" ON reservations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "demo_all" ON line_logs;
CREATE POLICY "demo_all" ON line_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "demo_all" ON staff_logs;
CREATE POLICY "demo_all" ON staff_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─── 0.5. デモユーザーを profiles に登録（owner = 全予約参照可） ─────────────────
-- demo@riora.jp のログインUID を profiles に owner として追加する
-- これにより useHomeStore の role チェックで全予約が表示される

INSERT INTO profiles (id, role, staff_name, display_name)
VALUES ('c180d370-f5d6-46a6-b8bb-4735598f8478', 'owner', 'デモ管理者', 'Demo Owner')
ON CONFLICT (id) DO UPDATE SET role = 'owner';

-- ─── 1. 既存テストデータをクリア ────────────────────────────────────────────────

DELETE FROM staff_logs;
DELETE FROM line_logs;
DELETE FROM reservations;

-- ─── 2. customers UPDATE (全30件) ──────────────────────────────────────────────

-- 【VIP顧客 3名】
UPDATE customers SET
  customer_type='VIP型', is_vip=true, visit_count=14, total_spent=520000,
  last_visit_date=CURRENT_DATE - INTERVAL '5 days',
  next_visit_date=CURRENT_DATE + INTERVAL '14 days',
  churn_risk_score=5,
  memo='高頻度VIP。エイジングケアに強いこだわり。前回セラムを購入。誕生月は6月。',
  updated_at=NOW()
WHERE id='7fc6d7c6-fd9b-48ba-9f4a-168d7151824c';

UPDATE customers SET
  customer_type='VIP型', is_vip=true, visit_count=12, total_spent=445000,
  last_visit_date=CURRENT_DATE - INTERVAL '8 days',
  next_visit_date=CURRENT_DATE + INTERVAL '17 days',
  churn_risk_score=8,
  memo='毎月定期来店。ハリ・毛穴ケアを中心に。サブスク会員。プレミアムコースのみ希望。',
  updated_at=NOW()
WHERE id='e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58';

UPDATE customers SET
  customer_type='VIP型', is_vip=true, visit_count=18, total_spent=680000,
  last_visit_date=CURRENT_DATE - INTERVAL '3 days',
  next_visit_date=CURRENT_DATE + INTERVAL '7 days',
  churn_risk_score=3,
  memo='最上位VIP。月2回ペース。男性。スキンケアに非常に詳しい。接客はデータ・エビデンス重視。',
  updated_at=NOW()
WHERE id='487e4f9f-223c-44a4-8484-8b04177da846';

-- 【常連顧客 6名】
UPDATE customers SET
  customer_type='感情重視型', is_vip=false, visit_count=8, total_spent=248000,
  last_visit_date=CURRENT_DATE - INTERVAL '14 days', next_visit_date=NULL,
  churn_risk_score=15,
  memo='感情的なつながりを重視。前回「いつもより肌が明るい」と喜んでいた。次回はオプション提案のタイミング。',
  updated_at=NOW()
WHERE id='01a5030f-dc20-4a69-b3b4-7107da60b773';

UPDATE customers SET
  customer_type='効果重視型', is_vip=false, visit_count=7, total_spent=218000,
  last_visit_date=CURRENT_DATE - INTERVAL '18 days',
  next_visit_date=CURRENT_DATE + INTERVAL '12 days',
  churn_risk_score=18,
  memo='毛穴・美白に強いこだわり。写真で施術前後の比較を毎回確認。数値で変化を示すと喜ぶ。',
  updated_at=NOW()
WHERE id='31dcffb9-9dfc-4779-8fe6-a072336a541b';

UPDATE customers SET
  customer_type='感情重視型', is_vip=false, visit_count=6, total_spent=183000,
  last_visit_date=CURRENT_DATE - INTERVAL '21 days', next_visit_date=NULL,
  churn_risk_score=22,
  memo='リラックス重視。おしゃべり好き。家族の話をよく話す。プレゼントでギフト券を購入していた。',
  updated_at=NOW()
WHERE id='a8c23ef2-c66b-4204-ae23-23517a8c1445';

UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=5, total_spent=153000,
  last_visit_date=CURRENT_DATE - INTERVAL '25 days', next_visit_date=NULL,
  churn_risk_score=25,
  memo='じっくり信頼関係を構築中。前回初めてオプションを追加してくれた。丁寧な説明が刺さる。',
  updated_at=NOW()
WHERE id='9602c3ff-1f46-48bd-b538-2c9f85840568';

UPDATE customers SET
  customer_type='効果重視型', is_vip=false, visit_count=6, total_spent=191000,
  last_visit_date=CURRENT_DATE - INTERVAL '19 days', next_visit_date=NULL,
  churn_risk_score=20,
  memo='美白・シミケアが最大の関心事。効果を感じると即リピート。次回予約なし。要フォロー。',
  updated_at=NOW()
WHERE id='2f4e2f01-9959-4f2e-b220-98b15fa4d53b';

UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=5, total_spent=162000,
  last_visit_date=CURRENT_DATE - INTERVAL '22 days', next_visit_date=NULL,
  churn_risk_score=23,
  memo='男性。友人の紹介で来店。仕事が忙しく予約が不定期。LINE返信は早い。',
  updated_at=NOW()
WHERE id='ff8265ac-0a03-41ef-955c-e272cd64674c';

-- 【信頼構築中 6名】
UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=4, total_spent=122000,
  last_visit_date=CURRENT_DATE - INTERVAL '28 days', next_visit_date=NULL,
  churn_risk_score=30,
  memo='敏感肌で不安が強い。施術ごとに成分を確認する。安心感が最優先。LINEで細かく確認してくる。',
  updated_at=NOW()
WHERE id='3ee71a0e-e7b8-4a4e-bda9-0b6bebc3160c';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=4, total_spent=112000,
  last_visit_date=CURRENT_DATE - INTERVAL '30 days', next_visit_date=NULL,
  churn_risk_score=32,
  memo='初回からの慎重派。3回目からようやく笑顔が増えた。強い提案は逆効果。丁寧なカウンセリングが鍵。',
  updated_at=NOW()
WHERE id='14eb50c9-80bd-40c9-a25a-45f6fbebd060';

UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=3, total_spent=92000,
  last_visit_date=CURRENT_DATE - INTERVAL '35 days', next_visit_date=NULL,
  churn_risk_score=35,
  memo='職場の昼休みに来店するパターン。時間にシビア。90分以上はNG。テキパキした対応を好む。',
  updated_at=NOW()
WHERE id='44e5cb44-1a29-464b-8a3b-9cd989ddc3ac';

UPDATE customers SET
  customer_type='感情重視型', is_vip=false, visit_count=3, total_spent=91000,
  last_visit_date=CURRENT_DATE - INTERVAL '32 days', next_visit_date=NULL,
  churn_risk_score=33,
  memo='施術よりも「癒し」目当て。前回は仕事ストレスで来店と話していた。共感を大切に。',
  updated_at=NOW()
WHERE id='eb7ba329-b750-4b99-8f67-910cf9c8cf0c';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=4, total_spent=124000,
  last_visit_date=CURRENT_DATE - INTERVAL '27 days', next_visit_date=NULL,
  churn_risk_score=28,
  memo='初回に赤みが出た経験から警戒心強い。前回は問題なく喜んでいた。次回は丁寧に確認してから施術。',
  updated_at=NOW()
WHERE id='f99f6205-41fd-42d7-8cc2-29b0a3b715aa';

UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=3, total_spent=91000,
  last_visit_date=CURRENT_DATE - INTERVAL '33 days', next_visit_date=NULL,
  churn_risk_score=33,
  memo='妹と一緒に来店したことがある。次回は妹も一緒に誘えると良い。ペア割の話をしてみる。',
  updated_at=NOW()
WHERE id='f748053f-1358-4bd4-9211-447f0a5605fb';

-- 【新規顧客 5名】
UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=1, total_spent=12800,
  last_visit_date=CURRENT_DATE, next_visit_date=NULL, churn_risk_score=0,
  memo='本日初来店。Instagram見て予約。乾燥と毛穴が悩み。とても緊張していた。丁寧に対応した。',
  updated_at=NOW()
WHERE id='f232275d-6ef0-4500-b561-3de1e6564ffd';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=1, total_spent=12800,
  last_visit_date=CURRENT_DATE - INTERVAL '3 days', next_visit_date=NULL,
  churn_risk_score=5,
  memo='男性。職場近くで検索して予約。肌荒れが気になるとのこと。初来店で様子見の様子だった。',
  updated_at=NOW()
WHERE id='bcc30b15-04ec-4238-9c76-22dc4ad52bd1';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=2, total_spent=25600,
  last_visit_date=CURRENT_DATE - INTERVAL '10 days', next_visit_date=NULL,
  churn_risk_score=10,
  memo='2回目来店。前回より打ち解けた様子。次回予約を促したが「また連絡します」で終了。',
  updated_at=NOW()
WHERE id='58a1b27e-10ae-4221-a005-5a606743f75f';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=1, total_spent=12800,
  last_visit_date=CURRENT_DATE - INTERVAL '7 days', next_visit_date=NULL,
  churn_risk_score=8,
  memo='男性。初来店。彼女へのプレゼントに考えているとのこと。ギフト券の案内をした。',
  updated_at=NOW()
WHERE id='218bd5bd-cc0e-4c8d-9102-af1fe643befa';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=2, total_spent=25600,
  last_visit_date=CURRENT_DATE - INTERVAL '14 days',
  next_visit_date=CURRENT_DATE + INTERVAL '21 days',
  churn_risk_score=15,
  memo='男性。2回目。前回から変化を実感して喜んでいた。次回予約を自分から入れてくれた。',
  updated_at=NOW()
WHERE id='735bf656-50e8-4b61-8304-d4d40250d2bb';

-- 【失客リスク高 6名】
UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=4, total_spent=124000,
  last_visit_date=CURRENT_DATE - INTERVAL '75 days', next_visit_date=NULL,
  churn_risk_score=85,
  memo='3ヶ月近く未来店。以前は月1ペースで来ていた。昨年転職したと言っていた。要フォロー。',
  updated_at=NOW()
WHERE id='601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71';

UPDATE customers SET
  customer_type='感情重視型', is_vip=false, visit_count=5, total_spent=162000,
  last_visit_date=CURRENT_DATE - INTERVAL '68 days', next_visit_date=NULL,
  churn_risk_score=78,
  memo='感情重視型。以前は笑顔で来ていたのに最近音沙汰なし。LINEで優しい文面を送るべき。',
  updated_at=NOW()
WHERE id='bd6df646-1e28-4b2b-a0ed-7077c3d6a216';

UPDATE customers SET
  customer_type='効果重視型', is_vip=false, visit_count=3, total_spent=92000,
  last_visit_date=CURRENT_DATE - INTERVAL '63 days', next_visit_date=NULL,
  churn_risk_score=72,
  memo='2ヶ月以上未来店。前回「効果が出るまで続けたい」と言っていたのに…。新しいサロンに行ったかも。',
  updated_at=NOW()
WHERE id='585d4cbd-e23f-426b-87ff-76b2f037125f';

UPDATE customers SET
  customer_type='VIP型', is_vip=true, visit_count=8, total_spent=282000,
  last_visit_date=CURRENT_DATE - INTERVAL '80 days', next_visit_date=NULL,
  churn_risk_score=80,
  memo='元VIP。80日以上未来店。以前は月2回以上来店していた最上位顧客。何があったか要確認。急ぎフォロー必須。',
  updated_at=NOW()
WHERE id='92afc862-6b96-450a-8b4a-4a269927d1d9';

UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=4, total_spent=122000,
  last_visit_date=CURRENT_DATE - INTERVAL '60 days', next_visit_date=NULL,
  churn_risk_score=68,
  memo='2ヶ月前を最後に来店なし。以前は次回予約を入れていたのに今回は入れず帰った。要注意。',
  updated_at=NOW()
WHERE id='b548b92c-dd66-4847-84d9-b459f1830c1b';

UPDATE customers SET
  customer_type='効果重視型', is_vip=false, visit_count=3, total_spent=91000,
  last_visit_date=CURRENT_DATE - INTERVAL '65 days', next_visit_date=NULL,
  churn_risk_score=75,
  memo='男性。2ヶ月以上未来店。「また来ます」と言って帰ったが音沙汰なし。メンズ向けの案内を送ると良いかも。',
  updated_at=NOW()
WHERE id='8a1cf7ad-0ce7-49c8-9b6b-f934d4135fb2';

-- 【フォロー中 4名】
UPDATE customers SET
  customer_type='信頼構築型', is_vip=false, visit_count=4, total_spent=123000,
  last_visit_date=CURRENT_DATE - INTERVAL '40 days', next_visit_date=NULL,
  churn_risk_score=55,
  memo='男性。来店間隔が空き始めた。仕事で忙しい時期とのこと。LINEでさりげなく声かけが有効。',
  updated_at=NOW()
WHERE id='958bedd4-6f70-4415-bfd6-faf7ddc3bd54';

UPDATE customers SET
  customer_type='感情重視型', is_vip=false, visit_count=5, total_spent=153000,
  last_visit_date=CURRENT_DATE - INTERVAL '35 days', next_visit_date=NULL,
  churn_risk_score=45,
  memo='感情重視型。少し間が空いているが関係は良好。「季節の変わり目に合わせたケア」の提案が効きそう。',
  updated_at=NOW()
WHERE id='a577818c-a35a-4270-bc18-b7d71813b747';

UPDATE customers SET
  customer_type='効果重視型', is_vip=false, visit_count=4, total_spent=123000,
  last_visit_date=CURRENT_DATE - INTERVAL '38 days', next_visit_date=NULL,
  churn_risk_score=50,
  memo='男性。効果重視型。前回施術後に「肌が変わった気がする」と言って帰った。継続してほしい。',
  updated_at=NOW()
WHERE id='ecaece03-bd76-429b-b5b2-40fc0f5a4264';

UPDATE customers SET
  customer_type='慎重・不安型', is_vip=false, visit_count=3, total_spent=91000,
  last_visit_date=CURRENT_DATE - INTERVAL '36 days', next_visit_date=NULL,
  churn_risk_score=48,
  memo='男性。花粉症で肌が荒れやすい春に来店が多い。来春の来店に向けて関係を維持したい。',
  updated_at=NOW()
WHERE id='17f8102c-ed71-4dd7-8e9a-db83290bd80c';

-- ─── 3. reservations INSERT ──────────────────────────────────────────────────

-- 【今日の予約 5件】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-05-19T10:00:00+09:00',90,'confirmed',false,
 '目元のたるみを重点的に。前回購入のセラムの使い心地を確認する。'),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-05-19T11:30:00+09:00',90,'confirmed',false,
 '新しいハイフ後ケアコースを提案する。データで効果を説明すること。'),
('f232275d-6ef0-4500-b561-3de1e6564ffd','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'ベーシックフェイシャル',12800,'2026-05-19T13:00:00+09:00',60,'confirmed',true,
 '本日初来店。Instagram見て予約。乾燥・毛穴悩み。緊張しているので丁寧に対応。'),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'リラクゼーションコース',15000,'2026-05-19T14:30:00+09:00',75,'confirmed',false,
 '前回「いつもより明るくなった」と喜んでいた。今日もリラックスできる施術を。'),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-05-19T16:00:00+09:00',90,'confirmed',false,
 'サブスク継続月。先月と比べてハリの変化を写真で確認する。');

-- 【次週以降の予約 5件】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-06-02T11:00:00+09:00',90,'confirmed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-05-26T10:00:00+09:00',90,'confirmed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'プレミアムエイジングケア',18000,'2026-06-05T14:00:00+09:00',90,'confirmed',false,NULL),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'ポアクリーニング + 美白ケア',15000,'2026-05-31T11:00:00+09:00',75,'confirmed',false,NULL),
('735bf656-50e8-4b61-8304-d4d40250d2bb','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 'ベーシックフェイシャル',12800,'2026-06-09T13:00:00+09:00',60,'confirmed',false,NULL);

-- 【VIP田中あかり 過去13回】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '35 days',90,'completed',false,'施術後の肌ツヤが特に良好だった'),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '65 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '95 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + 美白トリートメント',23000,NOW()-INTERVAL '125 days',105,'completed',false,'オプション追加。大変喜んでいた'),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '155 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '185 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + コラーゲンパック',21000,NOW()-INTERVAL '215 days',100,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '245 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '275 days',90,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '365 days',75,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '425 days',60,'completed',true,'初来店'),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '395 days',60,'completed',false,NULL),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '335 days',75,'completed',false,NULL);

-- 【VIP高橋優太 過去17回】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '18 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + 美白トリートメント',23000,NOW()-INTERVAL '32 days',105,'completed',false,'美白効果に満足とのこと'),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '50 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '65 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + コラーゲンパック',21000,NOW()-INTERVAL '80 days',100,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '95 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '110 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '125 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + 美白トリートメント',23000,NOW()-INTERVAL '142 days',105,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '158 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '175 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '210 days',75,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '245 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '280 days',90,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '430 days',60,'completed',true,'初来店。データ・効果重視の傾向あり'),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '390 days',75,'completed',false,NULL),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '340 days',75,'completed',false,NULL);

-- 【VIP鈴木美咲 過去11回】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '40 days',90,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '72 days',90,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + 美白トリートメント',23000,NOW()-INTERVAL '104 days',105,'completed',false,'サブスク更新月'),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '136 days',90,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '168 days',90,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + コラーゲンパック',21000,NOW()-INTERVAL '200 days',100,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '235 days',90,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '290 days',75,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '340 days',75,'completed',false,NULL),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '400 days',60,'completed',true,'初来店'),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '365 days',60,'completed',false,NULL);

-- 【常連・信頼構築中顧客 過去来店履歴】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
-- 佐藤 花子 過去7回
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '45 days',75,'completed',false,'施術後の肌ツヤが良かったと喜んでいた'),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '80 days',75,'completed',false,NULL),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '115 days',75,'completed',false,NULL),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '150 days',75,'completed',false,NULL),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '200 days',75,'completed',false,NULL),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '280 days',60,'completed',true,'初来店'),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '240 days',60,'completed',false,NULL),
-- 山本 結衣 過去6回
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '50 days',75,'completed',false,'毛穴の改善を実感したと話していた'),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '85 days',75,'completed',false,NULL),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '120 days',75,'completed',false,NULL),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '160 days',75,'completed',false,NULL),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '240 days',60,'completed',true,'初来店'),
('31dcffb9-9dfc-4779-8fe6-a072336a541b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '200 days',60,'completed',false,NULL),
-- 加藤 みゆき 過去5回
('2f4e2f01-9959-4f2e-b220-98b15fa4d53b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '50 days',75,'completed',false,NULL),
('2f4e2f01-9959-4f2e-b220-98b15fa4d53b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '90 days',75,'completed',false,NULL),
('2f4e2f01-9959-4f2e-b220-98b15fa4d53b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '130 days',60,'completed',false,NULL),
('2f4e2f01-9959-4f2e-b220-98b15fa4d53b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '200 days',60,'completed',true,'初来店'),
('2f4e2f01-9959-4f2e-b220-98b15fa4d53b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '165 days',75,'completed',false,NULL),
-- 小林 沙耶 過去5回
('a8c23ef2-c66b-4204-ae23-23517a8c1445','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '55 days',75,'completed',false,NULL),
('a8c23ef2-c66b-4204-ae23-23517a8c1445','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '95 days',75,'completed',false,NULL),
('a8c23ef2-c66b-4204-ae23-23517a8c1445','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '145 days',60,'completed',false,NULL),
('a8c23ef2-c66b-4204-ae23-23517a8c1445','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店'),
('a8c23ef2-c66b-4204-ae23-23517a8c1445','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '180 days',75,'completed',false,NULL),
-- 木村 里奈 過去4回
('9602c3ff-1f46-48bd-b538-2c9f85840568','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '60 days',60,'completed',false,NULL),
('9602c3ff-1f46-48bd-b538-2c9f85840568','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '110 days',60,'completed',false,NULL),
('9602c3ff-1f46-48bd-b538-2c9f85840568','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '165 days',75,'completed',false,NULL),
('9602c3ff-1f46-48bd-b538-2c9f85840568','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '240 days',60,'completed',true,'初来店'),
-- 村上 健一 過去4回
('ff8265ac-0a03-41ef-955c-e272cd64674c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '55 days',60,'completed',false,NULL),
('ff8265ac-0a03-41ef-955c-e272cd64674c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '100 days',60,'completed',false,NULL),
('ff8265ac-0a03-41ef-955c-e272cd64674c','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '150 days',75,'completed',false,NULL),
('ff8265ac-0a03-41ef-955c-e272cd64674c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店（友人紹介）'),
-- 山田 葵 過去3回
('3ee71a0e-e7b8-4a4e-bda9-0b6bebc3160c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '65 days',60,'completed',false,NULL),
('3ee71a0e-e7b8-4a4e-bda9-0b6bebc3160c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '120 days',60,'completed',false,NULL),
('3ee71a0e-e7b8-4a4e-bda9-0b6bebc3160c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '200 days',60,'completed',true,'初来店'),
-- 松本 奈々 過去3回
('14eb50c9-80bd-40c9-a25a-45f6fbebd060','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '70 days',60,'completed',false,NULL),
('14eb50c9-80bd-40c9-a25a-45f6fbebd060','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '130 days',60,'completed',false,NULL),
('14eb50c9-80bd-40c9-a25a-45f6fbebd060','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '210 days',60,'completed',true,'初来店'),
-- 橋本 咲良 過去3回
('f99f6205-41fd-42d7-8cc2-29b0a3b715aa','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '65 days',60,'completed',false,NULL),
('f99f6205-41fd-42d7-8cc2-29b0a3b715aa','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '125 days',60,'completed',false,NULL),
('f99f6205-41fd-42d7-8cc2-29b0a3b715aa','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店。前に他サロンで赤みが出た経験あり'),
-- 林 香織 過去2回
('44e5cb44-1a29-464b-8a3b-9cd989ddc3ac','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '90 days',60,'completed',false,NULL),
('44e5cb44-1a29-464b-8a3b-9cd989ddc3ac','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '200 days',60,'completed',true,'初来店'),
-- 長谷川 真央 過去2回
('eb7ba329-b750-4b99-8f67-910cf9c8cf0c','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '95 days',75,'completed',false,NULL),
('eb7ba329-b750-4b99-8f67-910cf9c8cf0c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '210 days',60,'completed',true,'初来店'),
-- 池田 真理 過去2回
('f748053f-1358-4bd4-9211-447f0a5605fb','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '100 days',60,'completed',false,NULL),
('f748053f-1358-4bd4-9211-447f0a5605fb','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '215 days',60,'completed',true,'初来店');

-- 【新規顧客 来店履歴】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
-- 中島 瞳 過去1回（計2回）
('58a1b27e-10ae-4221-a005-5a606743f75f','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '42 days',60,'completed',true,'初来店'),
('58a1b27e-10ae-4221-a005-5a606743f75f','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '10 days',60,'completed',false,'2回目。少しリラックスしていた'),
-- 吉田 太郎 過去1回（計2回）
('735bf656-50e8-4b61-8304-d4d40250d2bb','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '50 days',60,'completed',true,'初来店（男性）'),
('735bf656-50e8-4b61-8304-d4d40250d2bb','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '14 days',60,'completed',false,'変化を実感。次回予約を自ら入れた'),
-- 佐々木 翔 1回
('bcc30b15-04ec-4238-9c76-22dc4ad52bd1','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '3 days',60,'completed',true,'初来店（男性）'),
-- 中村 健太 1回
('218bd5bd-cc0e-4c8d-9102-af1fe643befa','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '7 days',60,'completed',true,'初来店（男性）。彼女へのギフト券も購入');

-- 【失客リスク顧客 来店履歴 + 無断キャンセル 3件】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
-- 山口 優子 過去3回 + no_show1件
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '75 days',60,'completed',false,NULL),
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '130 days',60,'completed',false,NULL),
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '240 days',60,'completed',true,'初来店'),
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '45 days',60,'cancelled',false,'当日連絡なし。事前確認のLINEも既読スルー'),
-- 渡辺 恵美 過去4回 + no_show1件
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '68 days',75,'completed',false,'この後から来店が途絶えた'),
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '110 days',75,'completed',false,NULL),
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '160 days',60,'completed',false,NULL),
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '260 days',60,'completed',true,'初来店'),
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '50 days',75,'cancelled',false,'3日前のリマインドLINEに反応なし'),
-- 小川 遥香 過去2回
('585d4cbd-e23f-426b-87ff-76b2f037125f','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '63 days',75,'completed',false,NULL),
('585d4cbd-e23f-426b-87ff-76b2f037125f','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '180 days',60,'completed',false,NULL),
('585d4cbd-e23f-426b-87ff-76b2f037125f','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '280 days',60,'completed',true,'初来店'),
-- 岡田 真由 過去7回（元VIP）
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '80 days',90,'completed',false,'この日以降来店なし。何かあった可能性'),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '115 days',90,'completed',false,NULL),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '150 days',90,'completed',false,NULL),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア + コラーゲンパック',21000,NOW()-INTERVAL '185 days',100,'completed',false,NULL),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','プレミアムエイジングケア',18000,NOW()-INTERVAL '225 days',90,'completed',false,NULL),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','ポアクリーニング + 美白ケア',15000,NOW()-INTERVAL '310 days',75,'completed',false,NULL),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '430 days',60,'completed',true,'初来店。最初からVIP素質あり'),
-- 斎藤 彩 過去3回
('b548b92c-dd66-4847-84d9-b459f1830c1b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '60 days',60,'completed',false,NULL),
('b548b92c-dd66-4847-84d9-b459f1830c1b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '110 days',60,'completed',false,NULL),
('b548b92c-dd66-4847-84d9-b459f1830c1b','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店'),
-- 井上 拓海 過去2回（男性）
('8a1cf7ad-0ce7-49c8-9b6b-f934d4135fb2','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '65 days',60,'completed',false,'男性。この日以降来店なし'),
('8a1cf7ad-0ce7-49c8-9b6b-f934d4135fb2','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '175 days',60,'completed',false,NULL),
('8a1cf7ad-0ce7-49c8-9b6b-f934d4135fb2','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '280 days',60,'completed',true,'初来店（男性）');

-- 【フォロー中顧客 来店履歴】
INSERT INTO reservations (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes) VALUES
-- 森 涼介 過去3回（男性）
('958bedd4-6f70-4415-bfd6-faf7ddc3bd54','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '40 days',60,'completed',false,'来店間隔が空いてきた'),
('958bedd4-6f70-4415-bfd6-faf7ddc3bd54','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '85 days',60,'completed',false,NULL),
('958bedd4-6f70-4415-bfd6-faf7ddc3bd54','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店（男性）'),
-- 森田 彩花 過去4回
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '35 days',75,'completed',false,NULL),
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee','リラクゼーションコース',15000,NOW()-INTERVAL '75 days',75,'completed',false,NULL),
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '130 days',60,'completed',false,NULL),
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '240 days',60,'completed',true,'初来店'),
-- 石川 裕也 過去3回（男性）
('ecaece03-bd76-429b-b5b2-40fc0f5a4264','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '38 days',60,'completed',false,'「肌が変わった気がする」と感想'),
('ecaece03-bd76-429b-b5b2-40fc0f5a4264','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '90 days',60,'completed',false,NULL),
('ecaece03-bd76-429b-b5b2-40fc0f5a4264','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '220 days',60,'completed',true,'初来店（男性）'),
-- 清水 健 過去2回（男性）
('17f8102c-ed71-4dd7-8e9a-db83290bd80c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '36 days',60,'completed',false,NULL),
('17f8102c-ed71-4dd7-8e9a-db83290bd80c','ae68433d-69ce-4dc3-a38e-cc2501895fee','ベーシックフェイシャル',12800,NOW()-INTERVAL '210 days',60,'completed',true,'初来店（男性）');

-- ─── 4. line_logs INSERT（全件を1つのINSERTに統合） ──────────────────────────
-- ※ここが元のSQLのバグ箇所。4つに分割されていたINSERTを1つに統合して修正。

INSERT INTO line_logs (customer_id, staff_id, direction, message, sent_at) VALUES
-- 【失客リスク顧客】山口 優子へ送信→未返信
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '山口様、こんにちは🌸 前回のご来店から少し時間が経ちましたが、お肌のお調子はいかがでしょうか？ぜひまたお会いできることを楽しみにしております。',
 NOW()-INTERVAL '20 days'),
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '山口様、お元気でいらっしゃいますか？新しい季節のスキンケアについてご提案があります。ご都合よろしい時間帯にご予約いただけると嬉しいです🌷',
 NOW()-INTERVAL '5 days'),
-- 渡辺 恵美から受信（未返信・要対応）
('bd6df646-1e28-4b2b-a0ed-7077c3d6a216','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 'キャンセルしたいのですが、どうすればいいですか',
 NOW()-INTERVAL '2 hours'),
-- 岡田 真由への送信（返信なし）
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '岡田様、ご無沙汰しております。いつもご利用いただきありがとうございます🌸 新しいプレミアムコースが始まりました。岡田様にぜひご体験いただきたいです。',
 NOW()-INTERVAL '30 days'),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '岡田様、先月もご連絡いたしましたが、お忙しいのでしょうか？お力になれることがあれば何でもお申し付けください💐',
 NOW()-INTERVAL '10 days'),
-- 斎藤 彩から受信（未返信）
('b548b92c-dd66-4847-84d9-b459f1830c1b','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 'ご確認お願いします',
 NOW()-INTERVAL '3 hours'),
-- 小川 遥香へ送信（未返信）
('585d4cbd-e23f-426b-87ff-76b2f037125f','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '小川様、こんにちは！季節の変わり目でお肌の変化が出やすい時期です。毛穴ケアの特別プランをご用意しました✨ いかがでしょうか？',
 NOW()-INTERVAL '15 days'),
-- 井上 拓海から受信（未返信・男性）
('8a1cf7ad-0ce7-49c8-9b6b-f934d4135fb2','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 '予約したいのですがどうすれば良いですか',
 NOW()-INTERVAL '1 hour'),
-- 【VIP顧客】田中 あかりとのやり取り
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '田中様、本日10時のご予約ありがとうございます🌸 前回ご購入のセラムのご使用感もぜひ教えてください。お待ちしております！',
 NOW()-INTERVAL '1 day'),
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 'はい、使い心地がとてもよくて！楽しみにしています😊',
 NOW()-INTERVAL '23 hours'),
-- 高橋 優太とのやり取り
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '高橋様、本日11:30のご予約確認です。新しいハイフ後ケアについてご説明させていただきます。',
 NOW()-INTERVAL '2 days'),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 '了解です。データを見せてもらえると助かります',
 NOW()-INTERVAL '47 hours'),
-- 【フォロー中】森田 彩花へ
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '森田様、こんにちは🌸 少し間が空きましたがお肌の調子はいかがですか？新緑の季節、うるおいケアをご一緒にいかがでしょう？',
 NOW()-INTERVAL '7 days'),
-- 森 涼介へ（男性）
('958bedd4-6f70-4415-bfd6-faf7ddc3bd54','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '森様、お疲れ様です！お忙しい時期かと思いますが、お肌のメンテナンスはお時間ございますでしょうか？',
 NOW()-INTERVAL '10 days'),
('958bedd4-6f70-4415-bfd6-faf7ddc3bd54','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 '最近忙しくて..来月あたりに予約入れてもいいですか',
 NOW()-INTERVAL '9 days'),
-- 【新規顧客】伊藤 遥（今日来店予定）
('f232275d-6ef0-4500-b561-3de1e6564ffd','ae68433d-69ce-4dc3-a38e-cc2501895fee','sent',
 '伊藤様、本日13時のご予約ありがとうございます！初めてのご来店ですね。緊張なさらずにお越しくださいね🌸',
 NOW()-INTERVAL '12 hours'),
('f232275d-6ef0-4500-b561-3de1e6564ffd','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 '楽しみにしています！よろしくお願いします',
 NOW()-INTERVAL '11 hours'),
-- 中村 健太から受信（男性・未返信）
('218bd5bd-cc0e-4c8d-9102-af1fe643befa','ae68433d-69ce-4dc3-a38e-cc2501895fee','received',
 'ギフト券についてもう少し教えてもらえますか',
 NOW()-INTERVAL '30 minutes');

-- ─── 5. staff_logs INSERT ────────────────────────────────────────────────────

INSERT INTO staff_logs (customer_id, staff_id, services_done, log_text, next_visit_recommended_at, created_at) VALUES
('7fc6d7c6-fd9b-48ba-9f4a-168d7151824c','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["プレミアムエイジングケア","フォトフェイシャル"]'::jsonb,
 '目元のたるみが改善傾向。ご本人も効果を実感されており、新しいリフトケアに興味を示された。セラム購入(¥8,800)。',
 CURRENT_DATE + INTERVAL '14 days',
 NOW()-INTERVAL '35 days'),
('487e4f9f-223c-44a4-8484-8b04177da846','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["プレミアムエイジングケア","美白トリートメント"]'::jsonb,
 '肌ターンオーバーのデータを見ながら施術。数値で変化を見ると満足度が高い。ハイフ後ケアコースを次回提案予定。',
 CURRENT_DATE + INTERVAL '7 days',
 NOW()-INTERVAL '18 days'),
('e5219ca4-f2ac-44e9-9f8a-5b0633bd5a58','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["プレミアムエイジングケア","コラーゲンパック"]'::jsonb,
 'サブスク継続月。ハリの変化を写真で確認し一緒に喜んだ。「毎月来るのが楽しみ」とのお言葉。',
 CURRENT_DATE + INTERVAL '17 days',
 NOW()-INTERVAL '40 days'),
('01a5030f-dc20-4a69-b3b4-7107da60b773','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["リラクゼーションコース"]'::jsonb,
 '施術後に「いつもより肌が明るい」と喜んでいた。感情重視型なので共感の言葉が効果的。次回はオプション提案のタイミング。',
 NULL,
 NOW()-INTERVAL '45 days'),
('92afc862-6b96-450a-8b4a-4a269927d1d9','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["プレミアムエイジングケア"]'::jsonb,
 '最後の来店。急に無口になり施術中の会話が少なかった。何か不満があった可能性。次回フォローが必要。要確認。',
 NULL,
 NOW()-INTERVAL '80 days'),
('f232275d-6ef0-4500-b561-3de1e6564ffd','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["ベーシックフェイシャル"]'::jsonb,
 '初来店。Instagram見て予約。乾燥・毛穴が悩み。とても緊張していたが施術後はリラックスしていた。次回予約につながる可能性あり。',
 CURRENT_DATE + INTERVAL '30 days',
 NOW()-INTERVAL '10 minutes'),
('601f7ea0-2b33-4acc-9ab8-e8ca7a3f7f71','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["ベーシックフェイシャル"]'::jsonb,
 '無断キャンセルが1回あり。転職後から来店間隔が空いている。LINEを2回送ったが返信なし。電話してみることを検討。',
 NULL,
 NOW()-INTERVAL '45 days'),
('a577818c-a35a-4270-bc18-b7d71813b747','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["リラクゼーションコース"]'::jsonb,
 '来店間隔が空き始めた。関係は良好。季節の変わり目ケアの提案が響きそう。次回は5月末目安でフォロー。',
 NULL,
 NOW()-INTERVAL '35 days'),
('218bd5bd-cc0e-4c8d-9102-af1fe643befa','ae68433d-69ce-4dc3-a38e-cc2501895fee',
 '["ベーシックフェイシャル"]'::jsonb,
 '彼女へのギフト券について相談。¥20,000のギフト券を購入予定とのこと。来月に2名で来店の可能性あり。',
 CURRENT_DATE + INTERVAL '21 days',
 NOW()-INTERVAL '7 days');

-- ─── 6. 確認用クエリ ─────────────────────────────────────────────────────────

SELECT 'reservations件数' AS label, count(*) AS count FROM reservations
UNION ALL SELECT 'customers件数', count(*) FROM customers
UNION ALL SELECT 'line_logs件数', count(*) FROM line_logs
UNION ALL SELECT 'staff_logs件数', count(*) FROM staff_logs
UNION ALL SELECT '今日の予約', count(*) FROM reservations WHERE scheduled_at::date = CURRENT_DATE
UNION ALL SELECT '失客リスク70以上', count(*) FROM customers WHERE churn_risk_score >= 70
UNION ALL SELECT 'VIP顧客', count(*) FROM customers WHERE is_vip = true
UNION ALL SELECT 'cancelled件数', count(*) FROM reservations WHERE status = 'cancelled';
