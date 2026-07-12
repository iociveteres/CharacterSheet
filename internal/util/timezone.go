package util

import (
	"net/http"
	"net/url"
	"time"
)

func GetTimeLocation(r *http.Request) *time.Location {
	c, err := r.Cookie("tz")
	if err != nil {
		return nil
	}
	tz, err := url.QueryUnescape(c.Value)
	if err != nil {
		return time.UTC
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	return loc
}
