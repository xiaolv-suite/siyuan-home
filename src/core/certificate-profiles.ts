/**
 * 证件细分画像与字段档案（Certificate Profiles & Category Reminders，解耦自 schema.ts）
 * 包含：各证件分类选项（身份证/户口本/护照/签注/驾照/行驶证/出生证/资格证/毕业证/学位证等）、
 * 私有扩展字段集、到期日提醒字段映射。
 */

import type { ColumnDef } from "./schema";

const fld = (key: string, type: any, extra?: any): ColumnDef => (extra ? { key, type, labelKey: `field.${key}`, ...extra } : { key, type, labelKey: `field.${key}` });
const txt = (k: string) => fld(k, "text");
const dat = (k: string) => fld(k, "date");
const ast = (k: string) => fld(k, "mAsset");
const sel = (k: string, options?: string[], def?: string) => fld(k, "select", { ...(options ? { options } : {}), ...(def ? { default: def } : {}) });

export const CERTIFICATE_CATEGORY_OPTIONS = [
    "id", "hukou", "passport", "visa", "permit", "hkmo_permit", "tw_permit",
    "license", "driver_license", "vehicle_lic", "birth_cert", "vocational_qualification",
    "professional_qualification", "graduation_cert", "degree_cert", "professional_title", "other",
] as const;

export type CertificateCategory = typeof CERTIFICATE_CATEGORY_OPTIONS[number];

/** Category-specific fields. All keys use the x_cert_ prefix so they are
 * clearly module-private and can be added without changing the shared field
 * dictionary. The UI can use this profile to render only relevant fields. */
export interface CertificateProfile {
    category: CertificateCategory;
    fieldKeys: readonly string[];
    columns: readonly ColumnDef[];
}

const CERTIFICATE_PROFILE_COLUMNS: Record<CertificateCategory, readonly ColumnDef[]> = {
    id: [
        txt("x_cert_id_number"),
        txt("x_cert_id_address"),
        txt("x_cert_id_authority"),
        sel("x_cert_id_gender", ["male", "female"]),
        ast("x_cert_id_front"),
        ast("x_cert_id_back"),
    ],
    hukou: [
        txt("x_cert_hukou_location"),
        txt("x_cert_hukou_head_name"),
        ast("x_cert_hukou_scan"),
    ],
    passport: [
        txt("x_cert_passport_name_pinyin"),
        txt("x_cert_passport_nationality"),
        txt("x_cert_passport_birth_place"),
        txt("x_cert_passport_authority"),
        ast("x_cert_passport_scan"),
    ],
    visa: [
        txt("x_cert_visa_country"),
        txt("x_cert_visa_type"),
        ast("x_cert_visa_scan"),
    ],
    permit: [
        txt("x_cert_permit_region"),
        txt("x_cert_permit_endorsement"),
        dat("x_cert_permit_endorsement_expiry"),
        ast("x_cert_permit_scan"),
    ],
    hkmo_permit: [
        sel("x_cert_hkmo_region", ["hong_kong", "macao"]),
        txt("x_cert_hkmo_endorsement"),
        dat("x_cert_hkmo_endorsement_expiry"),
        ast("x_cert_hkmo_scan"),
    ],
    tw_permit: [
        txt("x_cert_tw_endorsement"),
        dat("x_cert_tw_endorsement_expiry"),
        ast("x_cert_tw_scan"),
    ],
    /** Legacy value retained for rows created when this option meant a generic license. */
    license: [
        txt("x_cert_legacy_type"),
        txt("x_cert_legacy_issuer"),
        ast("x_cert_legacy_scan"),
    ],
    driver_license: [
        txt("x_cert_driver_class"),
        txt("x_cert_driver_authority"),
        dat("x_cert_driver_first_issue_date"),
        dat("x_cert_driver_review_due"),
        ast("x_cert_driver_scan"),
    ],
    vehicle_lic: [
        txt("x_cert_vehicle_plate"),
        txt("x_cert_vehicle_owner"),
        ast("x_cert_vehicle_scan"),
    ],
    birth_cert: [
        txt("x_cert_birth_place"),
        txt("x_cert_birth_registration_no_last4"),
        ast("x_cert_birth_scan"),
    ],
    vocational_qualification: [
        txt("x_cert_vocational_name"),
        txt("x_cert_vocational_level"),
        txt("x_cert_vocational_issuer"),
        txt("x_cert_vocational_registration_last4"),
        dat("x_cert_vocational_education_due"),
        ast("x_cert_vocational_scan"),
    ],
    professional_qualification: [
        txt("x_cert_professional_name"),
        txt("x_cert_professional_level"),
        txt("x_cert_professional_issuer"),
        txt("x_cert_professional_registration_last4"),
        dat("x_cert_professional_education_due"),
        ast("x_cert_professional_scan"),
    ],
    graduation_cert: [
        txt("x_cert_school"),
        txt("x_cert_major"),
        txt("x_cert_education_level"),
        dat("x_cert_admission_date"),
        dat("x_cert_graduation_date"),
        txt("x_cert_graduation_no_last4"),
        ast("x_cert_graduation_scan"),
    ],
    degree_cert: [
        txt("x_cert_degree"),
        txt("x_cert_degree_school"),
        dat("x_cert_degree_award_date"),
        txt("x_cert_degree_no_last4"),
        ast("x_cert_degree_scan"),
    ],
    professional_title: [
        txt("x_cert_title_level"),
        txt("x_cert_title_specialty"),
        txt("x_cert_title_issuer"),
        dat("x_cert_title_review_due"),
        ast("x_cert_title_scan"),
    ],
    other: [
        txt("x_cert_other_type"),
        txt("x_cert_other_issuer"),
        ast("x_cert_other_scan"),
    ],
};

const certificateProfiles = CERTIFICATE_CATEGORY_OPTIONS.reduce((profiles, category) => {
    const columns = CERTIFICATE_PROFILE_COLUMNS[category];
    profiles[category] = { category, fieldKeys: columns.map((column) => column.key), columns };
    return profiles;
}, {} as Record<CertificateCategory, CertificateProfile>);

export const CERTIFICATE_PROFILES: Readonly<Record<CertificateCategory, CertificateProfile>> = certificateProfiles;

/** Unknown/legacy category values deliberately fall back to `other`; callers
 * can still preserve and display the raw category value separately. */
export function getCertificateProfile(category: string | undefined): CertificateProfile {
    return CERTIFICATE_PROFILES[category as CertificateCategory] ?? CERTIFICATE_PROFILES.other;
}

/** Type-specific deadline fields already registered as their own reminder rules. */
const CERTIFICATE_REMINDER_FIELDS: Partial<Record<CertificateCategory, string>> = {
    permit: "x_cert_permit_endorsement_expiry",
    hkmo_permit: "x_cert_hkmo_endorsement_expiry",
    tw_permit: "x_cert_tw_endorsement_expiry",
    driver_license: "x_cert_driver_review_due",
    vocational_qualification: "x_cert_vocational_education_due",
    professional_qualification: "x_cert_professional_education_due",
    professional_title: "x_cert_title_review_due",
};

export function getCertificateReminderField(category: string | undefined): string | undefined {
    return CERTIFICATE_REMINDER_FIELDS[category as CertificateCategory];
}

export const CERT_PROFILE_COLUMNS: ColumnDef[] = Object.values(CERTIFICATE_PROFILE_COLUMNS).flatMap((columns) => [...columns]);
