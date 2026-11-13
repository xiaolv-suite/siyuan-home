import { describe, it, expect, vi } from "vitest";
import {
    renderHouseWarrantySection,
    renderFoodDietarySection,
    renderSchoolingStageSection,
    renderPetCareSection,
    renderParentingFeedingSection,
    renderSocialRetirementSection,
} from "@/core/drawer-domain-sections";

describe("drawer-domain-sections (台账详情抽屉专属领域分析卡片)", () => {
    const createMockElement = () => {
        const el: any = {
            style: {},
            className: "",
            innerHTML: "",
            textContent: "",
            appendChild: vi.fn(),
            append: vi.fn(),
            replaceChildren: vi.fn(),
            querySelector: vi.fn(),
            querySelectorAll: vi.fn().mockReturnValue([]),
            onclick: null,
        };
        return el;
    };

    it("非浏览器环境（document === undefined）各卡片优雅跳过", async () => {
        const mockBody = {} as any;
        const mockRow = { itemID: "row-1", cells: {} };
        const mockRef = { columns: {} };
        const mockPlugin = { settings: {} };
        const t = (k: string) => k;

        await expect(renderHouseWarrantySection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            plugin: mockPlugin,
            t,
            renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
        })).resolves.not.toThrow();

        await expect(renderFoodDietarySection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            plugin: mockPlugin,
            t,
            showMessageFn: vi.fn(),
            renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
            cellTextFn: () => "",
        })).resolves.not.toThrow();

        await expect(renderSchoolingStageSection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            t,
            cellTextFn: () => "",
        })).resolves.not.toThrow();

        await expect(renderPetCareSection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            t,
            cellTextFn: () => "",
        })).resolves.not.toThrow();

        await expect(renderParentingFeedingSection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            plugin: mockPlugin,
            t,
            DialogCls: class {},
            showMessageFn: vi.fn(),
            renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
            cellTextFn: () => "",
        })).resolves.not.toThrow();

        await expect(renderSocialRetirementSection({
            body: mockBody,
            row: mockRow,
            ref: mockRef,
            plugin: mockPlugin,
            t,
        })).resolves.not.toThrow();
    });

    it("在具备 document 环境下正确装配各领域卡片", async () => {
        (globalThis as any).document = {
            createElement: vi.fn().mockImplementation(() => createMockElement()),
        };

        try {
            const body = createMockElement();
            const t = (k: string) => k;

            // 1. 房屋保修卡片
            const houseRow = {
                itemID: "house-1",
                cells: {
                    c_name: { text: { content: "中央空调" } },
                    c_brand: { text: { content: "格力" } },
                },
            };
            const housePlugin = {
                settings: {
                    dbRefs: {
                        contracts: {
                            avId: "av-contracts-1",
                            docId: "doc-contracts-1",
                            columns: { name: "col_title", party: "col_party", end_date: "col_exp" },
                        },
                    },
                },
                showTabDocs: vi.fn(),
            };
            const renderLedgerAllFn = vi.fn().mockResolvedValue({
                complete: true,
                rows: [
                    {
                        itemID: "contract-1",
                        cells: {
                            col_title: { text: { content: "中央空调维保协议" } },
                            col_party: { text: { content: "格力售后" } },
                            col_exp: { date: { content: 1893456000000 } },
                        },
                    },
                ],
            });

            await renderHouseWarrantySection({
                body,
                row: houseRow,
                ref: { columns: { name: "c_name", brand: "c_brand" } },
                plugin: housePlugin,
                t,
                renderLedgerAllFn,
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 2. 食品忌口排查卡片
            const foodRow = {
                itemID: "food-1",
                cells: {
                    c_name: { text: { content: "芒果慕斯蛋糕" } },
                    c_ing: { text: { content: "芒果, 奶油, 糖" } },
                },
            };
            const foodPlugin = {
                settings: {
                    members: [{ id: "m-1", name: "大宝", allergies: ["芒果"] }],
                    dbRefs: {},
                },
            };
            await renderFoodDietarySection({
                body,
                row: foodRow,
                ref: { columns: { name: "c_name", ingredients: "c_ing" } },
                plugin: foodPlugin,
                t,
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                cellTextFn: (cell) => cell?.text?.content || "",
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 3. 教育学段进度卡片
            const schoolRow = {
                itemID: "school-1",
                cells: {
                    c_cat: { select: [{ content: "primary" }] },
                    c_year: { number: { content: 2023 } },
                    c_status: { select: [{ content: "enrolled" }] },
                },
            };
            await renderSchoolingStageSection({
                body,
                row: schoolRow,
                ref: { columns: { category: "c_cat", enroll_year: "c_year", status: "c_status" } },
                t,
                cellTextFn: (cell) => cell?.select?.[0]?.content || String(cell?.number?.content || ""),
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 4. 宠物照护卡片
            const petRow = {
                itemID: "pet-1",
                cells: {
                    c_species: { select: [{ content: "cat" }] },
                    c_vac: { date: { content: 1735689600000 } },
                    c_note: { text: { content: "生日: 2022-05-15" } },
                },
            };
            await renderPetCareSection({
                body,
                row: petRow,
                ref: { columns: { species: "c_species", vaccine_due: "c_vac", note: "c_note" } },
                t,
                cellTextFn: (cell) => cell?.select?.[0]?.content || cell?.text?.content || "",
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 5. 育儿辅食观察卡片
            const parentingRow = {
                itemID: "parenting-1",
                cells: {
                    c_cat: { select: [{ content: "feeding" }] },
                    c_date: { date: { content: 1730000000000 } },
                    c_name: { text: { content: "鸡蛋黄" } },
                    c_member: { relation: { blockIDs: ["member-block-1"] } },
                },
            };
            const parentingPlugin = {
                settings: {
                    members: [{ avItemId: "member-block-1", name: "二宝" }],
                    dbRefs: {
                        health: {
                            avId: "av-health-1",
                            columns: { category: "col_cat", name: "col_name", member: "col_mem", note: "col_note" },
                        },
                    },
                },
            };
            await renderParentingFeedingSection({
                body,
                row: parentingRow,
                ref: { columns: { category: "c_cat", date: "c_date", name: "c_name", member: "c_member" } },
                plugin: parentingPlugin,
                t,
                DialogCls: class {},
                showMessageFn: vi.fn(),
                renderLedgerAllFn: vi.fn().mockResolvedValue({ complete: true, rows: [] }),
                cellTextFn: (cell) => cell?.select?.[0]?.content || cell?.text?.content || "2026-10-27",
            });
            expect(body.appendChild).toHaveBeenCalled();

            // 6. 退休测算卡片
            const socialRow = {
                itemID: "social-1",
                cells: {
                    c_member: { relation: { blockIDs: ["member-block-self"] } },
                },
            };
            const socialPlugin = {
                settings: {
                    members: [{ avItemId: "member-block-self", name: "爸爸", birthday: "1980-05-12", sex: "male" }],
                },
            };
            await renderSocialRetirementSection({
                body,
                row: socialRow,
                ref: { columns: { member: "c_member" } },
                plugin: socialPlugin,
                t,
            });
            expect(body.appendChild).toHaveBeenCalled();
        } finally {
            delete (globalThis as any).document;
        }
    });
});
