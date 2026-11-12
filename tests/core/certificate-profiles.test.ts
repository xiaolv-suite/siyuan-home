import { describe, it, expect } from "vitest";
import {
    CERTIFICATE_CATEGORY_OPTIONS,
    CERTIFICATE_PROFILES,
    getCertificateProfile,
    getCertificateReminderField,
} from "@/core/certificate-profiles";

describe("certificate-profiles (证件细分画像与字段档案)", () => {
    it("包含 17 种标准证件与资质分类选项", () => {
        expect(CERTIFICATE_CATEGORY_OPTIONS).toHaveLength(17);
        expect(CERTIFICATE_CATEGORY_OPTIONS).toContain("id");
        expect(CERTIFICATE_CATEGORY_OPTIONS).toContain("passport");
        expect(CERTIFICATE_CATEGORY_OPTIONS).toContain("driver_license");
        expect(CERTIFICATE_CATEGORY_OPTIONS).toContain("hkmo_permit");
        expect(CERTIFICATE_CATEGORY_OPTIONS).toContain("birth_cert");
    });

    it("每个 Profile 正确声明字段键集与列规格", () => {
        const idProfile = CERTIFICATE_PROFILES.id;
        expect(idProfile.category).toBe("id");
        expect(idProfile.fieldKeys).toContain("x_cert_id_number");
        expect(idProfile.fieldKeys).toContain("x_cert_id_front");
        expect(idProfile.columns.length).toBe(idProfile.fieldKeys.length);

        const driverProfile = CERTIFICATE_PROFILES.driver_license;
        expect(driverProfile.fieldKeys).toContain("x_cert_driver_class");
        expect(driverProfile.fieldKeys).toContain("x_cert_driver_review_due");
    });

    it("getCertificateProfile 未知分类默认回退至 other", () => {
        const fallback = getCertificateProfile("unknown_type" as any);
        expect(fallback.category).toBe("other");
        expect(fallback.fieldKeys).toContain("x_cert_other_type");

        const real = getCertificateProfile("passport");
        expect(real.category).toBe("passport");
        expect(real.fieldKeys).toContain("x_cert_passport_nationality");
    });

    it("getCertificateReminderField 正确匹配专属到期日字段", () => {
        expect(getCertificateReminderField("driver_license")).toBe("x_cert_driver_review_due");
        expect(getCertificateReminderField("hkmo_permit")).toBe("x_cert_hkmo_endorsement_expiry");
        expect(getCertificateReminderField("id")).toBeUndefined();
    });
});
