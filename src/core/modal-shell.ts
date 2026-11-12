/**
 * 管家命令式弹窗底座：src/core 下用 DOM 字符串拼的业务弹窗统一从这里开。
 *
 * 一次给齐此前每个弹窗各写一遍、又经常漏掉的部分：
 * - 焦点进入 / Tab 循环 / Esc 关闭并把焦点还给触发按钮（bindDialogA11y）；
 * - 标题与用户数据插值转义（escapeHtml）；
 * - 顶部“数据可能不完整”警告条（跨库读取部分失败时如实告知）；
 * - 底栏按钮统一 type="button"，异步动作期间禁用并标记 aria-busy，防连点。
 */
import { bindDialogA11y } from "./dialog-a11y";

export function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export type DialogLike = { element: HTMLElement; destroy: () => void };
export type DialogCtor = new (options: { title: string; content: string; width?: string }) => DialogLike;

export interface ModalAction {
    id: string;
    label: string;
    kind?: "primary" | "outline" | "cancel" | "text";
    disabled?: boolean;
}

export interface ModalShellOptions {
    DialogCls: DialogCtor;
    /** 纯文本标题，内部转义 */
    title: string;
    /** 主体 HTML（调用方负责对插值调用 escapeHtml） */
    body: string;
    /** 主体容器 id，沿用 #lv-* 约定以命中弹窗主题样式 */
    bodyId: string;
    width?: string;
    actions?: ModalAction[];
    /** 默认聚焦元素选择器；缺省聚焦取消按钮 */
    defaultFocus?: string;
    warnings?: string[];
    onClose?: () => void;
}

export interface ModalShell {
    dlg: DialogLike;
    body: HTMLElement;
    button: (id: string) => HTMLButtonElement | null;
    setWarnings: (warnings: string[]) => void;
    /** 异步动作期间禁用按钮并标记 aria-busy，结束后恢复；重复点击直接忽略 */
    runBusy: <T>(id: string, action: () => Promise<T>) => Promise<T | undefined>;
    close: () => void;
}

const BUTTON_CLASS: Record<NonNullable<ModalAction["kind"]>, string> = {
    primary: "b3-button",
    outline: "b3-button b3-button--outline",
    cancel: "b3-button b3-button--cancel",
    text: "b3-button b3-button--text",
};

export function modalWarningHtml(list: string[]): string {
    if (list.length === 0) return "";
    return `<div class="lv-modal-warn" role="alert">${list.map((w) => `<span>${escapeHtml(w)}</span>`).join("")}</div>`;
}

const escId = (id: string) =>
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

export function openModalShell(opts: ModalShellOptions): ModalShell {
    const actions = opts.actions ?? [];
    const actionHtml = actions.length === 0 ? "" : `<div class="b3-dialog__action">${actions.map((a) =>
        `<button type="button" class="${BUTTON_CLASS[a.kind ?? "outline"]}" data-lv-action="${escapeHtml(a.id)}"${a.disabled ? " disabled" : ""}>${a.label}</button>`,
    ).join("")}</div>`;
    const dlg = new opts.DialogCls({
        title: escapeHtml(opts.title),
        content: `<div class="b3-dialog__content lv-dialog-scroll-body" id="${escapeHtml(opts.bodyId)}"><div class="lv-modal-warn-slot">${modalWarningHtml(opts.warnings ?? [])}</div>${opts.body}</div>${actionHtml}`,
        width: opts.width,
    });
    const body = dlg.element.querySelector(`#${escId(opts.bodyId)}`) as HTMLElement;
    const button = (id: string) => dlg.element.querySelector<HTMLButtonElement>(`[data-lv-action="${escId(id)}"]`);
    for (const a of actions) {
        if (a.kind === "cancel") {
            const el = button(a.id);
            if (el) el.onclick = () => dlg.destroy();
        }
    }
    bindDialogA11y({ dlg, defaultFocus: opts.defaultFocus ?? null, onClose: opts.onClose });

    const busy = new Set<string>();
    return {
        dlg,
        body,
        button,
        setWarnings(list) {
            const slot = body.querySelector(".lv-modal-warn-slot");
            if (slot) slot.innerHTML = modalWarningHtml(list);
        },
        async runBusy(id, action) {
            if (busy.has(id)) return undefined;
            busy.add(id);
            const el = button(id);
            if (el) { el.disabled = true; el.setAttribute("aria-busy", "true"); }
            try {
                return await action();
            } finally {
                busy.delete(id);
                if (el?.isConnected) { el.disabled = false; el.removeAttribute("aria-busy"); }
            }
        },
        close: () => dlg.destroy(),
    };
}

/** 跨库读取结果收集：失败或未读完整的模块计入 failed，供弹窗顶部如实提示 */
export function createReadTracker() {
    const failed: string[] = [];
    return {
        failed,
        async read<T extends { complete: boolean }>(moduleId: string, load: () => Promise<T>): Promise<T | undefined> {
            try {
                const res = await load();
                if (!res.complete) failed.push(moduleId);
                return res;
            } catch {
                failed.push(moduleId);
                return undefined;
            }
        },
    };
}
