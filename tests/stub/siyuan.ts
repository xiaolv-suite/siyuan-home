/**
 * 测试专用思源包 stub：内核 API 经 src/core/siyuan.ts 的 setTransport 注入，
 * 测试中不应触达真实包；此文件兜底拦截误用的静态导入。
 */
export async function fetchSyncPost(): Promise<never> {
    throw new Error("[test] siyuan package is stubbed; inject a transport via setTransport()");
}
export const Plugin = class {};
export const showMessage = () => {};
export const confirm = (_title: string, _text: string, confirmCallback?: () => void) => { confirmCallback?.(); };
export const Dialog = class {};
export const Menu = class {};
export const getFrontend = () => "desktop";
export const openTab = () => {};
