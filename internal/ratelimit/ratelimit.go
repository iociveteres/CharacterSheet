// Package ratelimit keeps a token bucket per key: an address, a user, an email.
package ratelimit

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limiter lets each key through at most limit times a second on average,
// burst of them at once.
type Limiter struct {
	limit rate.Limit
	burst int
	// now is the clock; tests move it instead of sleeping.
	now func() time.Time

	mu      sync.Mutex
	buckets map[string]*rate.Limiter
}

// Every is n events per period, as rate.Limit.
func Every(n int, period time.Duration) rate.Limit {
	return rate.Every(period / time.Duration(n))
}

func New(limit rate.Limit, burst int) *Limiter {
	return &Limiter{limit: limit, burst: burst, now: time.Now, buckets: make(map[string]*rate.Limiter)}
}

// Allow takes a token of key; if there is none, it reports how long until
// there is one.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = rate.NewLimiter(l.limit, l.burst)
		l.buckets[key] = b
	}
	if b.AllowN(now, 1) {
		return true, 0
	}
	missing := 1 - b.TokensAt(now)
	// Rounded: float arithmetic leaves a wait of 1s as 1.000000001s.
	return false, time.Duration(missing / float64(l.limit) * float64(time.Second)).Round(time.Millisecond)
}

// Sweep forgets the keys whose bucket has filled up again: a new bucket for
// such a key is the same, so nothing is lost.
func (l *Limiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	for key, b := range l.buckets {
		if b.TokensAt(now) >= float64(l.burst) {
			delete(l.buckets, key)
		}
	}
}

func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// StartSweeper sweeps limiters every interval until ctx is done; wg waits for
// the goroutine to end.
func StartSweeper(ctx context.Context, wg *sync.WaitGroup, interval time.Duration, limiters ...*Limiter) {
	wg.Add(1)
	go func() {
		defer wg.Done()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				for _, l := range limiters {
					l.Sweep()
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}
