import { config } from '../core/config';
import type { FeatureContext } from '../core/context';
import { LcuError, report, uri } from '../core/lcu';
import { stopClick } from '../core/injector';

const id = 'aram-lite-quit';
export function champSelectQuit({ flow, injector, lcu, scope }: FeatureContext): void {
  let busy = false;
  let confirmationEpoch: number | null = null;
  let previousFocus: HTMLElement | null = null;
  const dialog = document.createElement('div');
  dialog.id = 'aram-lite-quit-confirm';
  const shadow = dialog.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>'
    + ':host{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;background:#0009;font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;color:#f0e6d2}'
    + 'section{width:340px;max-width:calc(100vw - 48px);padding:20px;background:#09121b;border:1px solid #785a28;border-radius:5px;box-shadow:0 6px 24px #0009}'
    + 'h2{margin:0 0 10px;font-size:17px}p{margin:0 0 20px}footer{display:flex;justify-content:flex-end;gap:12px}'
    + 'button{font:inherit;color:inherit;background:#142332;border:1px solid #785a28;border-radius:3px;padding:5px 14px;cursor:pointer}button:focus-visible{outline:2px solid #c8aa6e;outline-offset:2px}'
    + '</style><section role="alertdialog" aria-modal="true" aria-labelledby="quit-title" aria-describedby="quit-message">'
    + '<h2 id="quit-title">确认退出选人？</h2><p id="quit-message">退出将按客户端规则产生秒退惩罚。</p><footer>'
    + '<button type="button" data-aram-lite-quit-action="cancel">取消</button>'
    + '<button type="button" data-aram-lite-quit-action="confirm">确认退出</button></footer></section>';
  const cancelButton = shadow.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="cancel"]')!;
  function dismiss(): void {
    confirmationEpoch = null;
    dialog.remove();
    document.removeEventListener('keydown', handleKey, true);
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { stopClick(event); dismiss(); }
    else if (event.key === 'Tab') {
      stopClick(event);
      const confirmButton = shadow.querySelector<HTMLButtonElement>('[data-aram-lite-quit-action="confirm"]')!;
      (shadow.activeElement === cancelButton ? confirmButton : cancelButton).focus();
    }
  }
  scope.own(dismiss);
  scope.own(flow.onChange(() => {
    if (confirmationEpoch !== null && (!config.champSelectQuit || !flow.isAram || confirmationEpoch !== flow.selectionEpoch)) dismiss();
  }));
  scope.own(injector.register(() => {
    if (confirmationEpoch === null) return;
    if (!config.champSelectQuit || !flow.isAram || confirmationEpoch !== flow.selectionEpoch) { dismiss(); return; }
    if (!dialog.isConnected) { document.body?.append(dialog); cancelButton.focus(); }
  }));
  scope.own(injector.onClick('[data-aram-lite-quit-action]', (event, element) => {
    stopClick(event);
    const epoch = confirmationEpoch;
    const confirmed = element.getAttribute('data-aram-lite-quit-action') === 'confirm';
    dismiss();
    if (!confirmed || epoch === null || epoch !== flow.selectionEpoch ||
      !scope.active || !config.champSelectQuit || !flow.isAram || busy) return;
    busy = true;
    void lcu.delete(uri.lobby).catch(error => {
      if (!(error instanceof LcuError && error.status === 404)) report('退出选人', error, true);
    }).finally(() => { busy = false; });
  }));
  scope.own(injector.register(() => {
    const container = config.champSelectQuit && flow.isAram ? document.querySelector('.bottom-right-buttons') : null;
    const old = document.getElementById(id);
    if (!container || container.querySelector('.quit-button')) { old?.remove(); return; }
    if (old?.parentElement === container) return;
    old?.remove();
    const button = document.createElement('lol-uikit-flat-button');
    button.id = id;
    button.textContent = '退出选人';
    button.style.width = '125px';
    button.style.marginRight = '10px';
    container.prepend(button);
  }));
  scope.own(injector.onClick('#' + id, event => {
    stopClick(event);
    if (!scope.active || !config.champSelectQuit || !flow.isAram || busy || confirmationEpoch !== null) return;
    confirmationEpoch = flow.selectionEpoch;
    previousFocus = document.activeElement as HTMLElement | null;
    document.body?.append(dialog);
    document.addEventListener('keydown', handleKey, true);
    cancelButton.focus();
  }));
  scope.own(() => document.getElementById(id)?.remove());
}
