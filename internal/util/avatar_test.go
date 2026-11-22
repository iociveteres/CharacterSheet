package util

import "testing"

func TestAvatarHue(t *testing.T) {
	seen := map[int]bool{}
	for id := 1; id <= 100; id++ {
		hue := AvatarHue(id)
		if hue < 0 || hue >= AvatarHues {
			t.Fatalf("hue %d of user %d", hue, id)
		}
		if AvatarHue(id) != hue {
			t.Fatalf("user %d changes hue", id)
		}
		seen[hue] = true
	}
	// A hundred users use every tint.
	if len(seen) != AvatarHues {
		t.Errorf("%d tints of %d", len(seen), AvatarHues)
	}
}
