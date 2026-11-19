package handlers

func login(r *Request) string {
	return i18n.T(r.Lang, "site.auth.login", nil)
}
