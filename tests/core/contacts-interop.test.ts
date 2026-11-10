import { describe, it, expect, vi } from "vitest";

describe("contacts-interop (成员页面与小驴人脉生态互通与优雅降级)", () => {
    it("当装有小驴人脉时，保存成员自动双向触发 ensurePerson 关联", async () => {
        const mockEnsurePerson = vi.fn().mockResolvedValue({ docId: "doc-person-123", name: "妈妈", created: false });
        const mockBridge = { ensurePerson: mockEnsurePerson };

        let contactSnapshot: string | undefined;

        async function syncMemberToContacts(name: string, bridge: typeof mockBridge | undefined) {
            if (!bridge?.ensurePerson || !name.trim()) return;
            const person = await bridge.ensurePerson(name.trim());
            if (person?.docId) {
                contactSnapshot = `${person.name} [${person.docId}]`;
            }
        }

        await syncMemberToContacts("妈妈", mockBridge);
        expect(mockEnsurePerson).toHaveBeenCalledWith("妈妈");
        expect(contactSnapshot).toBe("妈妈 [doc-person-123]");
    });

    it("当未装小驴人脉时，完全优雅降级，零报错零打扰自洽运行", async () => {
        const noBridge = undefined;
        let contactSnapshot: string | undefined;

        async function syncMemberToContacts(name: string, bridge: any) {
            if (!bridge?.ensurePerson || !name.trim()) return;
            const person = await bridge.ensurePerson(name.trim());
            if (person?.docId) {
                contactSnapshot = `${person.name} [${person.docId}]`;
            }
        }

        // 不抛出任何异常，静默跳过
        await expect(syncMemberToContacts("爸爸", noBridge)).resolves.not.toThrow();
        expect(contactSnapshot).toBeUndefined();
    });

    it("正确解析人脉联系人快照字符串格式 名称 [docId]", () => {
        function parseSnapshot(raw: string) {
            const match = raw.match(/^(.*?)\s*\[(.*?)\]$/);
            return {
                name: match ? match[1].trim() : raw.trim(),
                docId: match ? match[2].trim() : undefined,
            };
        }

        expect(parseSnapshot("爷爷 [20261101-doc001]")).toEqual({ name: "爷爷", docId: "20261101-doc001" });
        expect(parseSnapshot("普通姓名")).toEqual({ name: "普通姓名", docId: undefined });
    });

    it("logContactInteractionSafely 正确调用人脉桥沉淀互动记录，未安装时优雅返回 false", async () => {
        const { logContactInteractionSafely } = await import("@/libs/contact-picker");

        // 1. 无桥对象时静默返回 false，零报错
        const resNoBridge = await logContactInteractionSafely({
            contactSnapshot: "大姑 [doc-uncle-1]",
            note: "中秋随礼 500元",
        });
        expect(resNoBridge).toBe(false);

        // 2. 模拟宿主有桥对象时的互动写入
        (globalThis as any).window = globalThis;
        const mockRecordInteraction = vi.fn().mockResolvedValue({ recorded: 1, complete: true });
        (globalThis as any).siyuanContacts = {
            recordInteraction: mockRecordInteraction,
        };

        const resWithBridge = await logContactInteractionSafely({
            contactSnapshot: "大姑 [doc-uncle-1]",
            note: "中秋随礼 500元",
            date: "2026-09-15",
            ref: "home:ledger:row-1",
        });
        expect(resWithBridge).toBe(true);
        expect(mockRecordInteraction).toHaveBeenCalledWith(["doc-uncle-1"], {
            date: "2026-09-15",
            note: "中秋随礼 500元",
            ref: "home:ledger:row-1",
        });

        delete (globalThis as any).siyuanContacts;
        delete (globalThis as any).window;
    });
});
