// 区段之间的短事件：每次只做一个选择，把肉鸽的随机性放在战斗之外。
// 事件只描述数据；效果由 run.ts 统一应用，避免 UI 和核心规则分叉。
export type EventEffect = {
  money?: number;
  humanity?: number;
  boostRandom?: number;
  removeRandom?: number;
};

export interface EventChoice {
  id: string;
  title: string;
  titleEn?: string;
  desc: string;
  descEn?: string;
  effect: EventEffect;
}

export interface EventDef {
  id: string;
  title: string;
  titleEn?: string;
  en: string;
  text: string;
  textEn?: string;
  choices: EventChoice[];
}

export const EVENTS: EventDef[] = [
  {
    id: 'dead-drop',
    title: '死信箱还在响',
    titleEn: 'The Dead Drop Is Still Ringing',
    en: 'DEAD DROP',
    text: '旧联系人留下了一只加密缓存。它没有署名，只有一串还没过期的权限。',
    textEn: 'An old contact left an encrypted cache. No name, just one string of unexpired access.',
    choices: [
      { id: 'salvage', title: '拆机回收', titleEn: 'Strip It', desc: '把缓存里的零件卖掉，赚 ¤35。', descEn: 'Sell the cache parts for ¤35.', effect: { money: 35 } },
      { id: 'upgrade', title: '带回工作台', titleEn: 'Take It Apart', desc: '支付 ¤15，把一张随机程序强化 +1。', descEn: 'Pay ¤15 to boost a random program by +1.', effect: { money: -15, boostRandom: 1 } },
    ],
  },
  {
    id: 'black-market',
    title: '黑市有人卖你的坐标',
    titleEn: 'Someone Is Selling Your Coordinates',
    en: 'BLACK MARKET',
    text: '摊主说他能把追踪记录抹掉，但你得先证明自己值得被保护。',
    textEn: 'The vendor can erase your trail, but first you must prove you are worth protecting.',
    choices: [
      { id: 'pay', title: '买断情报', titleEn: 'Buy the Silence', desc: '支付 ¤25，换一张无用程序的隔离机会。', descEn: 'Pay ¤25 to isolate one random program.', effect: { money: -25, removeRandom: 1 } },
      { id: 'bluff', title: '反向兜售', titleEn: 'Sell a Lie', desc: '不花钱，靠假坐标赚 ¤15。', descEn: 'Spend nothing and earn ¤15 with fake coordinates.', effect: { money: 15 } },
    ],
  },
  {
    id: 'trace-echo',
    title: '反向追踪的回声',
    titleEn: 'Echoes of the Countertrace',
    en: 'TRACE ECHO',
    text: '刚才的战斗在街区节点上留下了热噪声。你可以趁它还没散掉再压榨一次。',
    textEn: 'The last fight left heat in the local nodes. You can squeeze it once more before it fades.',
    choices: [
      { id: 'overheat', title: '继续榨取', titleEn: 'Push the Heat', desc: '赚 ¤45，但人性损耗 +3。', descEn: 'Earn ¤45, but lose 3 humanity.', effect: { money: 45, humanity: 3 } },
      { id: 'cooldown', title: '切断线路', titleEn: 'Cool Down', desc: '低调离场，赚 ¤10。', descEn: 'Leave quietly and earn ¤10.', effect: { money: 10 } },
    ],
  },
  {
    id: 'ghost-contract',
    title: '幽灵合同',
    titleEn: 'Ghost Contract',
    en: 'GHOST CONTRACT',
    text: '一份没有甲方的合同自动弹出，条款只有一句：把某个名字从系统里抹掉。',
    textEn: 'A contract with no client appears. One clause: erase a name from the system.',
    choices: [
      { id: 'accept', title: '接下脏活', titleEn: 'Take the Dirty Job', desc: '人性损耗 +2，并把一张随机程序强化 +1。', descEn: 'Lose 2 humanity and boost a random program by +1.', effect: { humanity: 2, boostRandom: 1 } },
      { id: 'decline', title: '留下干净手', titleEn: 'Keep Clean Hands', desc: '拒绝合同，拿 ¤20 的封口费。', descEn: 'Decline the contract and take ¤20 hush money.', effect: { money: 20 } },
    ],
  },
  {
    id: 'scrap-auction',
    title: '废墟拍卖会',
    titleEn: 'Auction in the Ruins',
    en: 'SCRAP AUCTION',
    text: '上一轮潜入留下的残骸被摆上桌。竞拍者不知道哪一块还带电。',
    textEn: 'Remains from the last breach are on the table. No bidder knows which piece is still live.',
    choices: [
      { id: 'bid', title: '竞拍核心', titleEn: 'Bid on the Core', desc: '支付 ¤20，强化一张随机程序 +1。', descEn: 'Pay ¤20 to boost a random program by +1.', effect: { money: -20, boostRandom: 1 } },
      { id: 'strip', title: '拆走铜线', titleEn: 'Strip the Copper', desc: '直接赚 ¤30，并隔离一张随机程序。', descEn: 'Earn ¤30 and isolate one random program.', effect: { money: 30, removeRandom: 1 } },
    ],
  },
  {
    id: 'rain-check',
    title: '雨幕下的检查站',
    titleEn: 'Checkpoint in the Rain',
    en: 'RAIN CHECK',
    text: '无人机在雨里盘旋。它们没有认出你，但还需要一个理由继续装瞎。',
    textEn: 'Drones circle in the rain. They did not recognize you, but need a reason to keep looking away.',
    choices: [
      { id: 'bribe', title: '塞入通行费', titleEn: 'Pay the Toll', desc: '支付 ¤15，避免留下额外痕迹。', descEn: 'Pay ¤15 and leave no extra trace.', effect: { money: -15 } },
      { id: 'run', title: '穿过雨幕', titleEn: 'Run the Rain', desc: '不花钱，但人性损耗 +1。', descEn: 'Spend nothing, but lose 1 humanity.', effect: { humanity: 1 } },
    ],
  },
];
