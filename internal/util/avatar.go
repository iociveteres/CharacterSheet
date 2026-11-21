package util

import (
	"hash/fnv"
	"strconv"
)

// AvatarHues is how many tints the letter of a user without an avatar comes in: the classes
// avatar-hue-0 … avatar-hue-9 of main.css.
const AvatarHues = 10

// AvatarHue is the tint of the letter that stands for the user's avatar, the same on the forum and
// the Account page. From the id, not the name: a rename keeps it. FNV-1a scatters neighbouring ids.
func AvatarHue(userID int) int {
	h := fnv.New32a()
	h.Write([]byte(strconv.Itoa(userID)))
	return int(h.Sum32() % AvatarHues)
}
