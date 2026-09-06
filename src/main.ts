import './style.css';
import { DISCIPLINE_INFO, Program } from './core/cards';
import { HookCtx, ImplantDef, sellPrice } from './core/cyberware';
import {
  NODE_INFO,
  PROTOCOLS,
  RunState,
  buyImplant,
  canDiscard,
  canPlay,
  discardCards,
  newRun,
  play,
  reroll,
  sellImplant,
  shopContinue,
  startBattle,
} from './core/run';
import { mulberry32 } from './core/rng';
import { scorePlay } from './core/scoring';
import { TECHNIQUES } from './core/techniques';

let s: RunState | null = null;
let sel: number[] = [];
let busy = false;
let techTableOpen = false;

const app = document.querySelector<HTMLDivElement>('#app')!;

const fmt = (n: number) => n.toLocaleString('zh-CN');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function previewCtx(): HookCtx {
  return {
    playsLeft: s?.playsLeft ?? 4,
    discardsLeft: s?.discardsLeft ?? 3,
    money: s?.money ?? 0,
    implantCount: s?.implants.length ?? 0,
    playedCount: sel.length,
    rng: mulberry32(0), // 预览用固定种子，混沌义体的实际值以结算为准
  };
}

// ---------- 组件 ----------

function cardHtml(p: Program, idx: number, selected: boolean): string {
  const info = DISCIPLINE_INFO[p.d];
  return `<div class="card ${info.cls}${selected ? ' sel' : ''}" data-idx="${idx}">
    <div class="card-glyph">${info.glyph}</div>
    <div class="card-val mono">${p.v}</div>
    <div class="card-disc">${info.zh} · ${info.en}</div>
  </div>`;
}

function implantHtml(def: ImplantDef, mode: 'owned' | 'offer'): string {
  const meta =
    mode === 'owned'
      ? `<button class="btn mini danger" data-sell="${def.id}">卖出 ¤${sellPrice(def)}</button>`
      : `<span class="shop-price">¤${def.cost}</span><button class="btn mini" data-buy="${def.id}">接入</button>`;
  return `<div class="implant">
    <div class="implant-name">${def.zh} <span class="en">${def.en}</span></div>
    <div class="implant-desc">${def.desc}</div>
    <div class="implant-meta"><span class="humcost">人性 −${def.humanity}</span>${meta}</div>
  </div>`;
}

function header(): string {
  if (!s) return '';
  return `<div class="topbar">
    <span class="logo">零日 <span class="en">ZERO-DAY</span></span>
    <span>区段 <b>${s.wing + 1}</b>/4 · ${s.corp.zh}「${s.corp.fortress}」</span>
    <span class="money">¤ ${s.money}</span>
    <span class="humtag">人性 −${s.humanityLoss}</span>
    <span class="seed mono">seed ${s.seed}</span>
  </div>`;
}

function implantsRow(): string {
  if (!s) return '';
  if (s.implants.length === 0) return `<div class="implants"><div class="implant-empty">义体槽空空如也——黑市里有二手货</div></div>`;
  return `<div class="implants">${s.implants.map((i) => implantHtml(i, 'owned')).join('')}</div>`;
}

function techTableHtml(): string {
  const rows = TECHNIQUES.map(
    (t) => `<div class="tech-row">
      <span class="tech-name">${t.zh} <span class="en">${t.en}</span></span>
      <span class="tech-desc">${t.desc}</span>
      <span class="tech-val mono">${t.base} × ${t.eff}</span>
    </div>`,
  ).join('');
  return `<div class="modal-mask" id="modal-mask"><div class="modal">
    <h3>手法表</h3>
    <p class="rule">威力 = 手法基准 + Σ参与程序强度；穿透 = 威力 × 效率。<br>
    攻击时自动从所选程序中枚举子集，取穿透最高的手法结算；同分取更稀有者。</p>
    ${rows}
    <div style="margin-top:16px;text-align:right"><button class="btn" id="btn-close-tech">关闭</button></div>
  </div></div>`;
}

// ---------- 渲染 ----------

function render(): void {
  document.body.classList.add('in-game');
  if (!s) return renderTitle();
  switch (s.phase) {
    case 'select':
      return renderSelect();
    case 'battle':
      return renderBattle();
    case 'shop':
      return renderShop();
    case 'won':
    case 'lost':
      return renderEnd();
  }
}

function renderTitle(): void {
  app.innerHTML = `<div class="screen title-screen">
    <div class="title-logo">零 日</div>
    <div class="title-sub en">ZERO-DAY · A CARD ROGUELIKE</div>
    <div class="blurb">
      雾屿城的雨下了三十年。掮客<i>「老蝉」</i>给你转来一单委托：潜进企业数据堡，把核心数据拽出来。<br><br>
      你的全部本钱，是一套手搓的程序库和几件二手义体。逐层击穿，见好就收——<br>
      或者死在分期账单里。
    </div>
    <div class="title-actions">
      <button class="btn primary" id="btn-start">开始潜入</button>
      <button class="btn" id="btn-title-tech">手法表</button>
    </div>
  </div>${techTableOpen ? techTableHtml() : ''}`;
  document.getElementById('btn-start')!.onclick = () => {
    s = newRun();
    render();
  };
  document.getElementById('btn-title-tech')!.onclick = () => {
    techTableOpen = !techTableOpen;
    render();
  };
  bindModal();
}

function renderSelect(): void {
  if (!s) return;
  const cards = s.options
    .map((o, i) => {
      const info = NODE_INFO[o.kind];
      const proto = o.protocol
        ? `<div class="protocol"><b>固执协议 · ${PROTOCOLS[o.protocol].zh}</b><br>${PROTOCOLS[o.protocol].desc}</div>`
        : '';
      return `<div class="nodecard" data-node="${i}">
        <div class="node-name">${info.zh} <span class="en">${info.en}</span></div>
        <div class="node-th mono">${fmt(o.threshold)}</div>
        <div>击穿所需穿透</div>
        <div class="node-reward">报酬 ¤${o.reward}${o.kind !== 'core' ? '（高风险高回报，何不看一眼核心？）' : '（含固执协议）'}</div>
        ${proto}
      </div>`;
    })
    .join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="h2">选择下手节点 — 打穿任意一个即可深入</div>
    <div class="nodes">${cards}</div>
    ${implantsRow()}
  </div>`;
  document.querySelectorAll('[data-node]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s || busy) return;
      startBattle(s, Number((el as HTMLElement).dataset.node));
      render();
    });
  });
}

function previewHtml(): string {
  if (!s || sel.length === 0) return `选择 1–5 张程序，自动匹配最优手法`;
  const chosen = sel.map((i) => s!.hand[i]);
  const r = scorePlay(chosen, s.implants, previewCtx());
  if (!r) return `选择 1–5 张程序`;
  const subsetHint = r.cards.length < sel.length ? `<span class="hint">自动选取 ${r.cards.length} 张参与结算</span>` : '';
  return `<b>${r.techZh}</b>　<span class="mono">${r.power} × ${r.eff} = <span class="fin">${r.final}</span></span>${subsetHint}`;
}

function renderBattle(): void {
  if (!s) return;
  const pct = Math.min(100, (s.roundScore / s.threshold) * 100);
  const proto = s.protocol
    ? `<div class="protocol" style="margin-top:8px"><b>固执协议 · ${PROTOCOLS[s.protocol].zh}</b>　${PROTOCOLS[s.protocol].desc}</div>`
    : '';
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="nodebar">
      <div class="nodebar-head">
        <div class="node-name">${NODE_INFO[s.nodeKind!].zh} <span class="en">${NODE_INFO[s.nodeKind!].en}</span></div>
        <div class="score-line"><b class="mono" id="score-num">${fmt(s.roundScore)}</b> / ${fmt(s.threshold)} 穿透</div>
      </div>
      <div class="progress"><div id="score-fill" style="width:${pct}%"></div></div>
      <div class="counters">
        <span>攻击窗口 <b id="plays">${s.playsLeft}/${s.playsMax}</b></span>
        <span>重编译 <b id="discards">${s.discardsLeft}</b></span>
        <span>程序库 <b>${s.hand.length + s.draw.length + s.discard.length}</b></span>
      </div>
      ${proto}
    </div>
    ${implantsRow()}
    <div class="result" id="result">接入完成。等待攻击指令…</div>
    <div class="hand" id="hand">${s.hand.map((c, i) => cardHtml(c, i, sel.includes(i))).join('')}</div>
    <div class="actions">
      <button class="btn primary" id="btn-play" ${canPlay(s, sel) ? '' : 'disabled'}>攻击<span class="cnt">${s.playsLeft}/${s.playsMax}</span></button>
      <button class="btn" id="btn-discard" ${canDiscard(s, sel) ? '' : 'disabled'}>重编译<span class="cnt">${s.discardsLeft}</span></button>
      <div class="preview" id="preview">${previewHtml()}</div>
      <button class="btn" id="btn-tech">手法表</button>
    </div>
  </div>${techTableOpen ? techTableHtml() : ''}`;

  document.getElementById('hand')!.addEventListener('click', (e) => {
    if (!s || busy) return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (sel.includes(idx)) sel = sel.filter((i) => i !== idx);
    else if (sel.length < 5) sel.push(idx);
    render();
  });
  document.getElementById('btn-play')!.onclick = () => void attack();
  document.getElementById('btn-discard')!.onclick = () => {
    if (!s || busy || !canDiscard(s, sel)) return;
    discardCards(s, sel);
    sel = [];
    render();
  };
  document.getElementById('btn-tech')!.onclick = () => {
    techTableOpen = true;
    render();
  };
  bindModal();
}

function renderShop(): void {
  if (!s) return;
  const cash = s.lastCashout;
  const owned =
    s.implants.length === 0
      ? `<div class="implant-empty">还没有义体</div>`
      : s.implants.map((i) => implantHtml(i, 'owned')).join('');
  const offers =
    s.shopOffers.length === 0
      ? `<div class="sold-out">货架已空（本局义体池有限）</div>`
      : s.shopOffers.map((i) => implantHtml(i, 'offer')).join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="shop-banner">
      击穿确认。赃款到账：<b>¤${cash?.reward ?? 0}</b>　利息 <b>¤${cash?.interest ?? 0}</b>（每 50 新元结余 +10，上限 40）
    </div>
    <div class="h2">已装载义体 — 人性损耗不可逆，卖出只退钱</div>
    <div class="implants">${owned}</div>
    <div class="h2">黑市货架</div>
    <div class="shop-grid"><div class="shop-row">${offers}</div>
      <div class="shop-row">
        <div class="implant"><div class="implant-name">重掷货架</div>
          <div class="implant-desc">换一批义体。费用每次 +10。</div>
          <div class="implant-meta"><span class="shop-price">¤${s.rerollCost}</span>
          <button class="btn mini" id="btn-reroll" ${s.money >= s.rerollCost ? '' : 'disabled'}>重掷</button></div>
        </div>
        <button class="btn primary" id="btn-next" style="margin-top:auto">继续深入 ↓</button>
      </div>
    </div>
  </div>`;
  document.querySelectorAll('[data-buy]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      buyImplant(s, (el as HTMLElement).dataset.buy!);
      render();
    });
  });
  document.querySelectorAll('[data-sell]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      sellImplant(s, (el as HTMLElement).dataset.sell!);
      render();
    });
  });
  document.getElementById('btn-reroll')!.onclick = () => {
    if (!s) return;
    reroll(s);
    render();
  };
  document.getElementById('btn-next')!.onclick = () => {
    if (!s) return;
    shopContinue(s);
    render();
  };
}

function renderEnd(): void {
  if (!s) return;
  const won = s.phase === 'won';
  app.innerHTML = `<div class="screen end-screen">
    <div class="end-title ${won ? 'won' : 'lost'}">${won ? '全身而退' : '连接中断'}</div>
    <div class="end-text">${
      won
        ? '核心数据到手。断线上浮，你把火漆一样的反向追踪甩在数据堡的残骸里。<br>雨还在下，霓虹在水洼里碎掉。老蝉的分成到账——这单，成了。'
        : '反向追踪锁定了你的接入点。权限被吊销，义体被远程锁死，<br>而欠掮客的那笔账，才刚刚开始计息。'
    }</div>
    <div class="end-stats">
      最终资产 <b>¤${s.money}</b> ｜ 人性损耗 <b>−${s.humanityLoss}</b> ｜ 到达区段 <b>${s.wing + 1}/4</b> ｜ seed <b>${s.seed}</b>
    </div>
    <button class="btn primary" id="btn-restart">再潜一次</button>
  </div>`;
  document.getElementById('btn-restart')!.onclick = () => {
    s = null;
    sel = [];
    render();
  };
}

function bindModal(): void {
  const mask = document.getElementById('modal-mask');
  if (!mask) return;
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      techTableOpen = false;
      render();
    }
  });
  document.getElementById('btn-close-tech')!.onclick = () => {
    techTableOpen = false;
    render();
  };
}

// ---------- 结算动画 ----------

async function attack(): Promise<void> {
  if (!s || busy || !canPlay(s, sel)) return;
  busy = true;
  const before = s.roundScore;
  const result = play(s, sel);
  if (!result) {
    busy = false;
    return;
  }
  const resEl = document.getElementById('result')!;
  for (const ev of result.events) {
    const deltas: string[] = [];
    if (ev.power) deltas.push(`威力 +${ev.power}`);
    if (ev.eff) deltas.push(`效率 +${ev.eff}`);
    resEl.innerHTML = `<b>${ev.label}</b>　${deltas.join('　')}　<span class="mono">${ev.powerTotal} × ${ev.effTotal}</span>`;
    resEl.classList.remove('flash');
    void resEl.offsetWidth;
    resEl.classList.add('flash');
    await sleep(240);
  }
  resEl.innerHTML = `<b>${result.techZh}</b>　威力 ${result.power} × 效率 ${result.eff} ＝ <span class="big mono">${fmt(result.final)}</span> 穿透`;
  const num = document.getElementById('score-num')!;
  const fill = document.getElementById('score-fill')!;
  num.textContent = fmt(before + result.final);
  fill.style.width = `${Math.min(100, ((before + result.final) / s.threshold) * 100)}%`;
  await sleep(650);
  sel = [];
  busy = false;
  render();
}

// 调试钩子：沿用黑冰 __BIP.game 惯例，控制台/自动化测试经 window.__zd 操作对局
(window as unknown as { __zd: object }).__zd = {
  get run() {
    return s;
  },
  render: () => render(),
  select: (idxs: number[]) => {
    sel = idxs;
    render();
  },
};

render();
