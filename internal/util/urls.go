package util

import "github.com/alehano/reverse"

func MakeInviteLink(token string, origin string) string {
	return origin + reverse.Rev("RedeemInvite", token)
}
