package handlers

func missing(lang string) string {
	return i18n.T(lang, "common.missingGo", nil)
}
