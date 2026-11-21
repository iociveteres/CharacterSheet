package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

// The avatars of the seeded users: the gm and the player have one, player2 none (the forum shows
// their letter), the outsider none and a moderator's lock for 30 days. Every seed puts them back.
var seedAvatars = map[string]color.RGBA{
	"gm":     {0x8a, 0x2b, 0x2b, 0xff},
	"player": {0x2b, 0x5d, 0x8a, 0xff},
}

const seedAvatarLocked = "outsider"

func ensureAvatars(ctx context.Context, m models.Models) error {
	moderator := users[1]
	for _, u := range users {
		if err := m.Avatars.Unlock(ctx, u.ID); err != nil {
			return err
		}
		if err := m.Avatars.Delete(ctx, u.ID); err != nil {
			return err
		}
		if c, ok := seedAvatars[u.Key]; ok {
			data, err := seedAvatar(c)
			if err != nil {
				return err
			}
			if _, err := m.Avatars.Put(ctx, u.ID, "image/jpeg", data); err != nil {
				return fmt.Errorf("avatar of %s: %w", u.Email, err)
			}
		}
		if u.Key == seedAvatarLocked {
			until := time.Now().Add(30 * 24 * time.Hour)
			if err := m.Avatars.Remove(ctx, u.ID, &models.AvatarLock{
				Until: &until, Reason: "Seed: an advert on the avatar", ModeratorID: moderator.ID,
			}); err != nil {
				return fmt.Errorf("avatar lock of %s: %w", u.Email, err)
			}
		}
	}
	return nil
}

// seedAvatar is a 192×192 JPEG, as the Account page crops one: a disc of the colour on a lighter
// ground, so that the frame and the forum's round or square crops show where its edges go.
func seedAvatar(c color.RGBA) ([]byte, error) {
	const side = 192
	img := image.NewRGBA(image.Rect(0, 0, side, side))
	ground := color.RGBA{c.R/2 + 0x70, c.G/2 + 0x70, c.B/2 + 0x70, 0xff}
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			dx, dy := x-side/2, y-side/2
			if dx*dx+dy*dy < 70*70 {
				img.Set(x, y, c)
			} else {
				img.Set(x, y, ground)
			}
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}
