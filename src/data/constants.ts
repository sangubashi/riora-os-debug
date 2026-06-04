import type {
  StaffProfile, StaffDashboard, CustomerProfile, CustomerType,
  KillerPhrase,
} from '../types';

export const STAFF_PROFILES: StaffProfile[] = [
  { id: 'admin',    name: '管理者',   firstName: '管理者', role: 'admin' },
  { id: 'kameyama', name: '亀山 純香', firstName: '亀山',   role: 'staff' },
  { id: 'todate',   name: '外舘 裕子', firstName: '外舘',   role: 'staff' },
  { id: 'demo',     name: 'デモ',     firstName: 'デモ',   role: 'staff' },
];


const RIO_KUMA_RANDOM_MSGS = [
  '今日はリピートのお客様が多いです。施術後の次回提案を忘れずに✨',
  '最近お客様の単価が上がっています。自信を持って提案してください🌸',
  'このお客様は信頼重視。まず「変化」を丁寧に伝えてみましょう✨',
  '今日もていねいな接客で、信頼を積み上げていきましょう🌸',
];

export const getRandomRioraMsg = () =>
  RIO_KUMA_RANDOM_MSGS[Math.floor(Math.random() * RIO_KUMA_RANDOM_MSGS.length)];

export const getTimeGreeting = (): string => {
  const h = new Date().getHours();
  if (h < 11) return 'おはようございます';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
};

/** AI が検出した再来店フォロー推奨顧客の一覧を返します */
/** @deprecated getAiAlertWarnings をご使用ください */
// ─── タイプ別 殺し文句 ────────────────────────────────────────────
export const KILLER_PHRASES: Record<CustomerType, KillerPhrase[]> = {
  '慎重・不安型': [
    { scene: '商品提案の直前', line: '「今日は見るだけでOKです。お肌に何が起きてるか、一緒に確認しましょう」' },
    { scene: '商品に興味を持った瞬間', line: '「このタイプの方、実は一番効果が出やすいんですよ」' },
    { scene: '躊躇している時', line: '「無理に決めなくて大丈夫。気になった時だけ教えてください」' },
  ],
  '感情重視型': [
    { scene: '再来店した時の出迎え', line: '「また来てくださって嬉しいです。顔が違います、絶対」' },
    { scene: '商品提案の時', line: '「これ、私も個人的に一番好きで…お客様に合いそうだなってずっと思ってました」' },
    { scene: '変化を伝える時', line: '「今日のお肌、先月より全然いいですよ！変化、わかりますか？」' },
  ],
  '効果重視型': [
    { scene: '施術後の成果確認', line: '「先月と比べると、毛穴のサイズがここまで変わっています」（写真を見せながら）' },
    { scene: '商品提案の時', line: '「このケアを3ヶ月続けた方の9割が「変わった」と言っています」' },
    { scene: '次回予約の時', line: '「次回は〇月にやると、今の効果がさらに定着します」' },
  ],
  '信頼構築型': [
    { scene: '施術前', line: '「今日は何も決めなくていいです。まずお肌を診させてください」' },
    { scene: '商品について聞かれた時', line: '「正直に言うと、今の状態には◯◯より△△の方が向いています」' },
    { scene: '提案に迷っている時', line: '「今すぐじゃなくていい。ただ頭の片隅においておいてください」' },
  ],
  'VIP型': [
    { scene: '来店時の第一声', line: '「先月からお客様専用で取り置きしていたものがあります」' },
    { scene: '新メニューの案内', line: '「他のお客様にはまだご案内していないんですが、ぜひお伝えしたくて」' },
    { scene: '施術の最初に', line: '「今日は最初の15分、一番気になる部分だけに集中してやりましょう」' },
  ],
};

// ─── 顧客データ ───────────────────────────────────────────────────
const CUSTOMERS_KAMEYAMA: CustomerProfile[] = [
  {
    id: 'cust-k-001', staffId: 'kameyama',
    name: '田中 美咲', customerType: '慎重・不安型',
    aiOneLiner: '安心感重視 — 強い提案は控えて',
    visits: 8, lastVisitDaysAgo: 14,
    tags: ['#毛穴', '#たるみ', '#敏感肌'],
    previousConcerns: [
      '乾燥が以前より強く出ていると話されていた',
      'ホームケアの美容液をずっと検討中とのこと',
      '職場のストレスで肌荒れしやすい時期と言っていた',
    ],
    aiPoints: [
      { text: '今日は安心感を最優先に。強い提案はしない。' },
      { text: '施術後に「お肌の変化」を具体的に伝えると喜ばれます。' },
      { text: '次回予約は施術中に自然に話題に出してください。' },
      { text: 'ホームケアの美容液、前回から気にされていました。' },
    ],
    ngAction: '複数商品の同時提案はしないこと。信頼関係を最優先に。',
    rioraMessage: 'このお客様は安心感重視。焦らずゆっくり対応してください✨',
    rejectionPatterns: [
      { trigger: '価格を聞いた直後に黙る', meaning: '購入意欲が下がっているサイン', counter: '「まず1回だけ試してみませんか？」と低ハードルな提案に変える' },
      { trigger: '「敏感肌なので…」と言い始める', meaning: '成分・刺激への不安が出ているサイン', counter: '使用成分を丁寧に説明し、パッチテストを提案する' },
    ],
  },
  {
    id: 'cust-k-002', staffId: 'kameyama',
    name: '佐藤 花子', customerType: '信頼構築型',
    aiOneLiner: '信頼構築中 — 定期来店の習慣化を優先',
    visits: 3, lastVisitDaysAgo: 28,
    tags: ['#乾燥', '#くすみ'],
    previousConcerns: [
      '肌のくすみが長年の悩みと言っていた',
      '仕事のストレスで肌荒れしやすいと話していた',
      '来店間隔が空きがちなのが気になると本人も言っていた',
    ],
    aiPoints: [
      { text: '3回目の来店。まだ信頼関係を構築中の段階です。' },
      { text: 'お肌の乾燥が気になる季節変わりについて話題にすると◎。' },
      { text: '次回予約を取ることを最優先目標にしてください。' },
    ],
    ngAction: '高額プランの提案は時期尚早。まず定期来店の習慣化を。',
    rioraMessage: 'まだ3回目。焦らず丁寧なカウンセリングで信頼を積み上げて🌸',
    rejectionPatterns: [
      { trigger: '「また今度考えます」と言う', meaning: '信頼が十分に育っていないサイン', counter: '今日は売らずに「次回また話しましょう」と引いてみる' },
      { trigger: '「今ちょっとお金が…」', meaning: '本当の断り理由ではない（信頼不足の代替表現）', counter: '価格より「続けることの価値」をゆっくり伝える' },
    ],
  },
  {
    id: 'cust-k-003', staffId: 'kameyama',
    name: '鈴木 理恵', customerType: 'VIP型',
    aiOneLiner: 'VIP対応 — 新メニューの案内タイミング',
    visits: 15, lastVisitDaysAgo: 7,
    tags: ['#アンチエイジング', '#ハリ', '#VIP'],
    previousConcerns: [
      '目元のたるみが最近気になり始めたと話していた',
      '新しいリフトアップメニューへの興味を示していた',
      '誕生月（来月）に何か特別なことをしたいと言っていた',
    ],
    aiPoints: [
      { text: 'VIPお客様。毎回の変化に敏感なので丁寧なフィードバックを。' },
      { text: '新しいリフトアップメニューへの案内タイミングです。' },
      { text: 'ホームケアセットの定期購入を提案してください。' },
      { text: '誕生月（来月）の特別プランを今日お伝えするとベスト。' },
    ],
    ngAction: '施術時間を削らないこと。このお客様は「丁寧さ」に価値を感じています。',
    rioraMessage: 'VIPのお客様です。いつも以上の丁寧さで✨ 新メニューの案内もお忘れなく！',
    rejectionPatterns: [
      { trigger: '施術中に無口・返答が短くなる', meaning: '満足度が下がっているサイン', counter: 'すぐに「何か気になる点はありますか？」と確認する' },
      { trigger: '「忙しくて…」と言い始める', meaning: '来店間隔が開き始めるサイン', counter: '「次回は完全にご都合に合わせます」と伝えて離脱を防ぐ' },
    ],
  },
];

const CUSTOMERS_TODATE: CustomerProfile[] = [
  {
    id: 'cust-t-001', staffId: 'todate',
    name: '高橋 麻美', customerType: '慎重・不安型',
    aiOneLiner: 'リラックス優先 — 効果を断言しない',
    visits: 2, lastVisitDaysAgo: 35,
    tags: ['#ニキビ', '#オイリー'],
    previousConcerns: [
      '前回は頬の肌荒れを特に気にされていた',
      'ニキビ跡の色素沈着が一番の悩みと言っていた',
      '化粧品を変えてから肌が不安定になったと話していた',
    ],
    aiPoints: [
      { text: '前回は肌荒れを気にされていました。状態の変化を最初に確認。' },
      { text: 'ニキビの原因となる生活習慣についての会話が効果的です。' },
      { text: 'まずは「また来てよかった」と思わせることが最優先。' },
    ],
    ngAction: '施術の効果を断言しないこと。個人差があることを丁寧に伝えて。',
    rioraMessage: '2回目のお客様。緊張されているかも。リラックスできる雰囲気から始めて🌸',
    rejectionPatterns: [
      { trigger: '「自分には少し…」と自己評価が低い発言', meaning: '効果への自信がなく購入を躊躇しているサイン', counter: '「実は同じタイプの方が一番効果を実感されています」と伝える' },
      { trigger: '「友達に相談してみます」と言う', meaning: '即日決断を避けているサイン', counter: '「どんな点が気になりますか？」と不安を深掘りして解消する' },
    ],
  },
  {
    id: 'cust-t-002', staffId: 'todate',
    name: '伊藤 久美子', customerType: '効果重視型',
    aiOneLiner: '変化の可視化 — 写真比較で確認する',
    visits: 6, lastVisitDaysAgo: 21,
    tags: ['#毛穴', '#色素沈着'],
    previousConcerns: [
      '毎回写真で比較していて、変化が小さいと感じていた回があった',
      'ビタミンC系のホームケアが効くかどうかずっと気にしている',
      '施術の効果が持続する期間を短く感じると言っていた',
    ],
    aiPoints: [
      { text: '毎回写真で比較している方。変化の記録を一緒に確認して。' },
      { text: 'ビタミンC系のホームケアを検討されているので詳細を伝えて。' },
      { text: '来月のキャンペーンをご案内するタイミングです。' },
    ],
    ngAction: '色素沈着への過度な期待を持たせないこと。正直なコミュニケーションを。',
    rioraMessage: '前回から3週間。お肌の変化をしっかり確認してあげてください✨',
    rejectionPatterns: [
      { trigger: '「前回と何が違うんですか？」と聞く', meaning: '差別化ができていないと感じているサイン', counter: '写真や数値で前回との具体的な変化を見せる' },
      { trigger: '「家でもできますか？」と代替案を探す', meaning: 'コスト意識が高まっているサイン', counter: '「プロのケアで得られる限界値の違い」をデータで説明する' },
    ],
  },
];

const CUSTOMERS_ADMIN: CustomerProfile[] = [...CUSTOMERS_KAMEYAMA, ...CUSTOMERS_TODATE];

const STAFF_DASHBOARDS: Record<string, StaffDashboard> = {
  admin:    { rioraDailyMsg: '今日も全スタッフをしっかりサポートしましょう🌸', customers: CUSTOMERS_ADMIN },
  kameyama: { rioraDailyMsg: '今日はリピートのお客様が多いです。次回提案を忘れずに✨', customers: CUSTOMERS_KAMEYAMA },
  todate:   { rioraDailyMsg: '今日は久しぶりのお客様もいます。丁寧なカウンセリングで🌸', customers: CUSTOMERS_TODATE },
};

export const getStaffDashboard = (staffId: string): StaffDashboard =>
  STAFF_DASHBOARDS[staffId] ?? STAFF_DASHBOARDS['admin'];
