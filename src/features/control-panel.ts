import { config, onConfigChange, resetConfig, switches, updateConfig } from '../core/config';
import type { Config } from '../core/config';
import type { FeatureContext } from '../core/context';

const id = 'aram-lite-controls';
export function controlPanel({ injector, scope }: FeatureContext): void {
  const host = document.createElement('div');
  host.id = id;
  const shadow = host.attachShadow({ mode: 'open' });
  function checkbox(key: typeof switches[number][0]): string {
    const label = switches.find(([name]) => name === key)![1];
    return '<label class="switch"><input type="checkbox" name="' + key + '">' + label + '</label>';
  }
  shadow.innerHTML = '<style>'
    + ':host{all:initial;position:fixed;right:12px;bottom:calc(40px + 0.5cm);text-align:right;z-index:10000;font:13px/1.5 Arial,"Microsoft YaHei",sans-serif;color:#f0e6d2}'
    + '*{box-sizing:border-box}[hidden]{display:none!important}'
    + 'button,input,select{font:inherit}button{cursor:pointer;color:inherit;background:#142332;border:1px solid #785a28;border-radius:3px;padding:5px 10px}'
    + 'button:hover{background:#20394b}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #c8aa6e;outline-offset:2px}'
    + 'section{width:350px;max-width:calc(100vw - 24px);max-height:calc(100vh - 100px - 0.5cm);text-align:left;overflow:auto;margin-bottom:8px;background:#09121b;border:1px solid #785a28;border-radius:5px;padding:14px;box-shadow:0 6px 20px #0008}'
    + 'header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}h2{font-size:15px;margin:0}'
    + 'fieldset{min-width:0;margin:0 0 12px;padding:8px 0 0;border:0;border-top:1px solid #34414c}fieldset:last-child{margin-bottom:0}'
    + 'legend{padding:0 8px 0 0;color:#c8aa6e;font-weight:bold;font-size:12px}'
    + '.row,.switches{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:8px 10px}.row+.row{margin-top:9px}'
    + '.switch{display:flex;align-items:center;gap:6px;cursor:pointer}.switch input{margin:0;accent-color:#c8aa6e}'
    + '.parameter{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px}'
    + 'input[type=number],select{flex:1;min-width:0;width:0;padding:4px;color:#f0e6d2;background:#142332;border:1px solid #435261;border-radius:3px}'
    + 'p{font-size:12px;color:#b9b8b2;margin:8px 0 0}.status{min-height:18px;color:#c8aa6e}footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}footer span{font-size:12px;color:#b9b8b2}'
    + '</style><section hidden role="dialog" aria-label="ARAM 设置">'
    + '<header><h2>ARAM 设置</h2><button type="button" data-action="close" aria-label="关闭设置">×</button></header>'
    + '<form><fieldset><legend>对局开始</legend>'
    + '<div class="row">' + checkbox('quickLobby') + '</div>'
    + '<div class="row">' + checkbox('autoAccept')
    + '<label class="parameter">接受延迟<input aria-label="接受延迟（毫秒）" title="单位：毫秒" name="autoAcceptDelayMs" type="number" min="0" max="15000" step="1" required></label></div>'
    + '</fieldset><fieldset><legend>对局结束</legend>'
    + '<div class="row">' + checkbox('autoHonor')
    + '<label class="parameter">点赞类型<select name="honorCategory"><option value="RANDOM">随机</option><option value="HEART">友善</option><option value="COOL">冷静</option><option value="SHOTCALLER">指挥</option></select></label></div>'
    + '<div class="row">' + checkbox('autoOpenStats')
    + '<label class="parameter">统计延迟<input aria-label="统计延迟（毫秒）" title="点赞处理结束后等待，单位：毫秒" name="openStatsDelayMs" type="number" min="0" max="15000" step="1" required></label></div>'
    + '<div class="row">' + checkbox('autoReturnLobby')
    + '<label class="parameter">回房延迟<input aria-label="结算出现后的回房延迟（毫秒）" title="从结算或点赞界面出现时计时，15000 毫秒 = 15 秒" name="returnLobbyDelayMs" type="number" min="0" max="30000" step="1" required></label></div>'
    + '</fieldset><fieldset><legend>大乱斗选人</legend>'
    + '<div class="row">' + checkbox('benchNoCooldown') + checkbox('champSelectQuit') + '</div>'
    + '<div class="row">' + checkbox('rememberSpells') + '</div>'
    + '</fieldset><fieldset><legend>好友列表</legend><div class="switches">'
    + checkbox('friendStatus') + checkbox('friendGroups')
    + '</div>'

    + '</fieldset></form><p class="status" role="status" aria-live="polite"></p>'
    + '<footer><span>更改自动保存</span><button type="button" data-action="reset">恢复默认</button></footer>'
    + '</section><button type="button" data-action="toggle" aria-expanded="false">ARAM 设置 · F8</button>';
  const panel = shadow.querySelector<HTMLElement>('section')!;
  const toggle = shadow.querySelector<HTMLButtonElement>('[data-action="toggle"]')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  let previousFocus: HTMLElement | null = null;

  function sync(): void {
    for (const [key] of switches) shadow.querySelector<HTMLInputElement>('[name="' + key + '"]')!.checked = config[key];
    for (const key of ['autoAcceptDelayMs', 'openStatsDelayMs', 'returnLobbyDelayMs'] as const) {
      shadow.querySelector<HTMLInputElement>('[name="' + key + '"]')!.value = String(config[key]);
    }
    shadow.querySelector<HTMLSelectElement>('[name="honorCategory"]')!.value = config.honorCategory;
  }
  function show(open: boolean): void {
    if (open && panel.hidden) previousFocus = document.activeElement as HTMLElement | null;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLInputElement>('input')?.focus();
    else if (previousFocus === host) toggle.focus();
    else if (previousFocus?.isConnected) previousFocus.focus();
  }
  function saved(ok: boolean): void {
    status.textContent = ok ? '已保存并生效' : '本次已生效，但保存失败，重启后可能丢失。';
  }
  shadow.addEventListener('change', event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const flag = switches.find(([key]) => key === target.name);
    if (flag) {
      saved(updateConfig({ [flag[0]]: (target as HTMLInputElement).checked }));
    } else if (target.name === 'autoAcceptDelayMs' || target.name === 'openStatsDelayMs' || target.name === 'returnLobbyDelayMs') {
      const input = target as HTMLInputElement;
      const number = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(number) || !Number.isInteger(number) || !input.validity.valid) {
        status.textContent = '请输入范围内的整数：接受及统计 0–15000，回房 0–30000 毫秒。';
        sync();
        return;
      }
      saved(updateConfig({ [target.name]: number }));
    } else if (target.name === 'honorCategory') {
      saved(updateConfig({ honorCategory: target.value as Config['honorCategory'] }));
    }
  });
  shadow.querySelector('form')!.addEventListener('submit', event => event.preventDefault());
  shadow.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    switch (button?.dataset.action) {
      case 'toggle': show(panel.hidden); break;
      case 'close': show(false); break;
      case 'reset': saved(resetConfig()); break;
    }
  });
  const keydown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.key === 'F8' || (event.key === 'Escape' && !panel.hidden)) {
      event.preventDefault();
      event.stopPropagation();
      show(event.key === 'F8' && panel.hidden);
    }
  };
  document.addEventListener('keydown', keydown, true);
  sync();
  scope.own(onConfigChange(sync));
  scope.own(injector.register(() => {
    const existing = document.getElementById(id);
    if (existing && existing !== host) existing.remove();
    if (host.parentElement !== document.body) document.body?.append(host);
  }));
  scope.own(() => {
    document.removeEventListener('keydown', keydown, true);
    host.remove();
  });
}
