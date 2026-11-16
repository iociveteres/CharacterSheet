export function App({ count, grip }: { count: number; grip: string }) {
    // i18n-keys: sheet.weapons.grip.*
    const gripLabel = t(`sheet.weapons.grip.${grip}`);
    return <p title={t("common.close")}>{t('common.items', { count })} {t(`common.greeting`, { name: "x" })} {gripLabel}</p>;
}
