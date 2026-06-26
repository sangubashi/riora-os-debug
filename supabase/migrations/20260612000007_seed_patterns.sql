-- ================================================================
-- Riora Brain Phase1 - Step1: 成功パターン8件 + 各ステップシード
--
-- store_id = NULL (ブランド標準パターン)。1号店「新富町店」を含む全店舗が
-- 参照可能。fire_condition / entry_condition は PatternContext
-- (snake_case変換後) に対する json-logic-js ルール。
--
-- タスク分解書で明示された代表3例(そのまま採用):
--   - B1 step4 (サブスク提案条件): v_subscription
--   - C1 step3 (HC提案条件):       v_c_hc
--   - E1 entry_condition (逆算):   v_e1_entry
-- それ以外の条件は同じPatternContext語彙を用いて新規に構成したもの。
-- 成功パターンv2.0⑤の全文が入手でき次第、本マイグレーションは変更せず
-- UPDATE文を追加する形で内容を揃えること。
-- ================================================================

DO $$
DECLARE
  v_step1_active   jsonb := '{">=":[{"var":"visit_count"},1]}'::jsonb;
  v_common_hc      jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"homecare_purchased_ever"},false]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_c_hc           jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"skin_improved"},true]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_subscription   jsonb := '{"and":[{">=":[{"var":"visit_count"},4]},{">=":[{"var":"subsc_conditions_met"},4]},{"==":[{"var":"homecare_declined_recent"},false]},{"<":[{"var":"churn_score"},0.5]}]}'::jsonb;
  v_upsell         jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"skin_improved"},true]},{"<":[{"var":"churn_score"},0.5]}]}'::jsonb;
  v_engaged_upsell jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_c1_upsell      jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"skin_stagnant2"},false]}]}'::jsonb;
  v_rebooking      jsonb := '{"and":[{"==":[{"var":"next_booking_made_last"},false]},{">":[{"var":"churn_score"},0.4]}]}'::jsonb;
  v_pack_d2        jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"is_nomination_streak2"},true]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_e1_entry       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},90]}]}'::jsonb;
  v_e1_step1       jsonb := '{"!=":[{"var":"wedding_days_left"},null]}'::jsonb;
  v_e1_step2       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},60]},{">=":[{"var":"visit_count"},2]}]}'::jsonb;
  v_e1_step3       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},30]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;

  v_kameyama       uuid := '00000000-0000-0000-0000-000000000102'; -- 亀山 (theory)
  v_sotodate       uuid := '00000000-0000-0000-0000-000000000103'; -- 外舘 (empathy)
BEGIN
  -- ---------------------------------------------------------------
  -- success_patterns
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_success_patterns
    (id, store_id, customer_type, label, entry_condition, target_cycle_days, version, is_active, origin)
  VALUES
    ('A1', NULL, 'A_acne',      'ニキビケア・標準パターン',           '{"==":[1,1]}'::jsonb, 21, 1, true, 'manual'),
    ('A2', NULL, 'A_acne',      'ニキビケア・ホームケア定着型',       '{"==":[{"var":"homecare_purchased_ever"},true]}'::jsonb, 21, 1, true, 'manual'),
    ('B1', NULL, 'B_pore',      '毛穴ケア・標準パターン',             '{"==":[1,1]}'::jsonb, 28, 1, true, 'manual'),
    ('B2', NULL, 'B_pore',      '毛穴ケア・指名定着型',               '{"==":[{"var":"is_nomination_streak2"},true]}'::jsonb, 28, 1, true, 'manual'),
    ('C1', NULL, 'C_sensitive', '敏感肌ケア・標準パターン',           '{"==":[1,1]}'::jsonb, 35, 1, true, 'manual'),
    ('D1', NULL, 'D_aging',     'エイジングケア・標準パターン',       '{"==":[1,1]}'::jsonb, 28, 1, true, 'manual'),
    ('D2', NULL, 'D_aging',     'エイジングケア・離脱注意フォロー型', '{">=":[{"var":"churn_score"},0.5]}'::jsonb, 28, 1, true, 'manual'),
    ('E1', NULL, 'E_bridal',    'ブライダル逆算パターン',             v_e1_entry, 14, 1, true, 'manual')
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: A1 (ニキビケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('A1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '本日はヒト幹細胞コスメで肌のベースを整えていきますね。まずは現在の肌状態をしっかり記録し、次回以降の変化と比較できるようにします。', 0),
    ('A1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'ご自宅でのケアを取り入れていただくと、サロンでの効果がより長持ちします。今お使いの洗顔料に置き換えるだけで負担なく続けられるホームケアセットがございます。', 2),
    ('A1', 3, 'ピーリングメニュー提案(アップセル)', 'upsell', 'peeling', v_upsell,
      '肌の調子が安定してきましたね。次のステップとして、毛穴の詰まりや古い角質にアプローチするハーブピーリングを組み合わせると、さらに効果を実感しやすくなります。', 2),
    ('A1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'ここまで継続して通っていただき、肌の変化を実感いただけていると思います。このペースを保つために、定額で通い放題になるサブスクプランがございます。長期的に見るとお得に続けられます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: A2 (ニキビケア・ホームケア定着型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('A2', 1, 'ピーリングメニュー提案(アップセル)', 'upsell', 'peeling', v_engaged_upsell,
      'ホームケアを続けていただいているおかげで肌の土台が整ってきています。サロンでは角質ケアにフォーカスしたハーブピーリングを取り入れて、相乗効果を狙いましょう。', 2),
    ('A2', 2, '再来店促進(離脱防止)', 'rebooking', NULL, v_rebooking,
      '今のペースを崩さないことが、ニキビを繰り返さないための一番のポイントです。次回のご予約を早めに確保しておきましょう。', 2),
    ('A2', 3, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'ホームケアとサロンケアの両輪がうまく回っていますね。このペースを継続しやすくするサブスクプランへの切り替えもご検討いただけます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: B1 (毛穴ケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('B1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '毛穴の目立ちが気になる肌質ですので、まずはヒト幹細胞コスメで土台を整えながら、毛穴の状態を継続的に記録していきましょう。', 0),
    ('B1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      '毛穴の引き締めは日々の積み重ねが重要です。サロンでのケアに加えて、ご自宅でも使える収れん化粧水を取り入れることで効果の持続が期待できます。', 2),
    ('B1', 3, '毛穴洗浄メニュー提案(アップセル)', 'upsell', 'pore', v_upsell,
      '毛穴の状態が少しずつ変化してきていますね。毛穴洗浄+ヒト幹のメニューに切り替えることで、さらに集中的にアプローチできます。', 2),
    ('B1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      '毛穴ケアは続けることで結果が出てきます。定額で通い放題のサブスクプランにすると、ペースを落とさずに続けやすくなります。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: B2 (毛穴ケア・指名定着型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('B2', 1, '毛穴洗浄メニュー提案(アップセル)', 'upsell', 'pore', v_engaged_upsell,
      'いつもご指名いただきありがとうございます。信頼関係ができてきましたので、より集中的に毛穴にアプローチする毛穴洗浄+ヒト幹のメニューをご提案します。', 2),
    ('B2', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'サロンでのケアの効果を持続させるために、ご自宅でも使える収れん化粧水をお使いいただくのがおすすめです。', 2),
    ('B2', 3, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'いつも継続してご来店いただいているので、サブスクプランに切り替えるとお得に通い続けられます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: C1 (敏感肌ケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('C1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '敏感肌の方には、まず低刺激のヒト幹細胞コスメで肌のバリア機能を整えることを優先します。お肌の反応を見ながら少しずつステップを進めていきましょう。', 0),
    ('C1', 2, '水素ケアメニュー提案(アップセル)', 'upsell', 'sensitive', v_c1_upsell,
      'お肌の調子が落ち着いてきましたので、次回は水素+ヒト幹のメニューで、より鎮静効果の高いケアを試してみませんか。', 2),
    ('C1', 3, 'ホームケア提案', 'homecare', NULL, v_c_hc,
      'お肌の状態が安定して改善が見られていますので、このタイミングでご自宅用の低刺激ケアアイテムを取り入れると、変化をより実感しやすくなります。', 2),
    ('C1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      '敏感肌は環境の変化で揺らぎやすいので、定期的なケアを継続しやすいサブスクプランをご検討いただくと安心です。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: D1 (エイジングケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('D1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      'エイジングケアは早めの土台作りが重要です。まずはヒト幹細胞コスメで肌のハリと潤いを底上げしていきましょう。', 0),
    ('D1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'サロンでのケアと並行して、ご自宅でもハリ・弾力をサポートする美容液を取り入れることで、効果の実感が早くなります。', 2),
    ('D1', 3, 'EMS+小顔メニュー提案(アップセル)', 'upsell', 'lifting', v_upsell,
      'お肌のハリに変化が出てきていますね。EMS+小顔のメニューを組み合わせることで、引き締め効果もプラスできます。', 2),
    ('D1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'エイジングケアは継続が何より大切です。サブスクプランに切り替えることで、無理なく定期的なケアを続けていただけます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: D2 (エイジングケア・離脱注意フォロー型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('D2', 1, '再来店促進(離脱防止)', 'rebooking', NULL, v_rebooking,
      'しばらく間が空いてしまうと、せっかくのエイジングケアの効果が戻りやすくなってしまいます。今のうちに次回のご予約を確保しておきませんか。', 2),
    ('D2', 2, 'EMS+小顔メニュー提案(パック)', 'pack', 'lifting', v_pack_d2,
      '続けてご来店いただけると効果が出やすくなります。EMS+小顔メニューを複数回パックでお得にご利用いただけるプランがございます。', 2),
    ('D2', 3, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'ご来店の間隔が空いてしまっても自宅でケアを続けられるよう、ハリ・弾力をサポートする美容液をお取り入れいただくのがおすすめです。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: E1 (ブライダル逆算パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('E1', 1, 'ブライダル逆算カウンセリング', 'none', 'entry', v_e1_step1,
      '挙式までの日数から逆算して、最適なケアスケジュールをご提案します。まずは現在のお肌の状態を確認し、ゴールに向けたプランを一緒に組み立てていきましょう。', 0),
    ('E1', 2, '集中ケアメニュー提案(パック)', 'pack', NULL, v_e1_step2,
      '挙式まで残り少なくなってきましたので、集中ケアパックで仕上げに向けたスケジュールを組みましょう。', 1),
    ('E1', 3, 'ホームケア提案', 'homecare', NULL, v_e1_step3,
      '本番直前は肌のコンディションを毎日キープすることが大切です。当日まで使えるホームケアアイテムで仕上げのお手入れを続けましょう。', 1)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- staff_adjustments
  --  亀山×(A1,A2,C1)×homecare timing_offset=+1
  --  外舘×全パターン×homecare timing_offset=+1
  --  外舘×C1×subscription script_style='empathy'
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_staff_adjustments
    (staff_id, pattern_id, proposal_kind, timing_offset, script_style)
  VALUES
    (v_kameyama, 'A1', 'homecare', 1, NULL),
    (v_kameyama, 'A2', 'homecare', 1, NULL),
    (v_kameyama, 'C1', 'homecare', 1, NULL),
    (v_sotodate, 'A1', 'homecare', 1, NULL),
    (v_sotodate, 'A2', 'homecare', 1, NULL),
    (v_sotodate, 'B1', 'homecare', 1, NULL),
    (v_sotodate, 'B2', 'homecare', 1, NULL),
    (v_sotodate, 'C1', 'homecare', 1, NULL),
    (v_sotodate, 'D1', 'homecare', 1, NULL),
    (v_sotodate, 'D2', 'homecare', 1, NULL),
    (v_sotodate, 'E1', 'homecare', 1, NULL),
    (v_sotodate, 'C1', 'subscription', 0, 'empathy')
  ON CONFLICT (staff_id, pattern_id, proposal_kind) DO NOTHING;
  -- 鈴木(evidence, 00000000-0000-0000-0000-000000000101)はデフォルトスタイルのため調整レコードなし。
END $$;
