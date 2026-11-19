package webapp

type contextKey string

const isAuthenticatedContextKey = contextKey("isAuthenticated")

// userLocaleContextKey holds users.locale of the signed-in user, read by authenticate.
const userLocaleContextKey = contextKey("userLocale")
