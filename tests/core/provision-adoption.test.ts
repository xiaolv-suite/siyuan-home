import { describe, it, expect, vi, afterEach } from "vitest";
import {
    findDuplicateLedgers,
    bindExistingDoc,
    healColumnMapping,
    discoverAndAdoptAllLedgers,
} from "@/core/provision-adoption";
import { setTransport } from "@/core/siyuan";
import type { HomeSettings } from "@/types";

describe("provision-adoption (历史台账发现、重名排查、智能接管与列自愈)", () => {
    afterEach(() => {
        setTransport(null);
    });

    it("findDuplicateLedgers 在缺少笔记本登记时安全返回空数组", async () => {
        const settings = {
            dbRefs: {},
        } as unknown as HomeSettings;

        const duplicates = await findDuplicateLedgers(settings);
        expect(duplicates).toEqual([]);
    });

    it("bindExistingDoc 输入非法文档 ID 时抛错防御", async () => {
        const settings = {
            dbRefs: {},
        } as unknown as HomeSettings;

        await expect(
            bindExistingDoc(settings, "certs", "", {} as any)
        ).rejects.toThrow("invalid document ID or link");
    });

    it("healColumnMapping 在无有效 avId 时优雅返回 undefined", async () => {
        const plugin = {
            settings: { dbRefs: {} },
        };
        const res = await healColumnMapping(plugin, "certs", "name");
        expect(res).toBeUndefined();
    });

    it("discoverAndAdoptAllLedgers 空模块列表返回空找回报告", async () => {
        setTransport(async (endpoint: string) => {
            if (endpoint === "/api/notebook/lsNotebooks") {
                return { code: 0, msg: "", data: { notebooks: [{ id: "nb-1", name: "🏠 小驴管家", closed: false }] } };
            }
            return { code: 0, msg: "", data: {} };
        });

        const settings = {
            enabledModules: [],
            dbRefs: {},
        } as unknown as HomeSettings;

        const report = await discoverAndAdoptAllLedgers(settings, {});
        expect(report.adoptedCount).toBe(0);
        expect(report.alreadyReadyCount).toBe(0);
        expect(report.issues).toEqual([]);
    });
});

