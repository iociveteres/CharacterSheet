package ratelimit

import (
	"context"
	"sync"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestLimiter(n, burst int, period time.Duration) (*Limiter, *clock) {
	c := &clock{t: time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)}
	l := New(Every(n, period), burst)
	l.now = c.now
	return l, c
}

func TestLimiterRefusesPastBurstAndRecovers(t *testing.T) {
	l, c := newTestLimiter(10, 5, time.Minute)

	for i := range 5 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d refused within the burst", i+1)
		}
	}
	ok, wait := l.Allow("a")
	if ok {
		t.Fatal("request past the burst let through")
	}
	if wait != 6*time.Second {
		t.Fatalf("wait %v, want 6s: a token every minute/10", wait)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("another key refused: keys must not share a bucket")
	}

	c.advance(5 * time.Second)
	if ok, wait := l.Allow("a"); ok || wait != time.Second {
		t.Fatalf("after 5s got %v, wait %v; want refused, 1s left", ok, wait)
	}
	c.advance(time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("refused once a token came back")
	}
	if ok, _ := l.Allow("a"); ok {
		t.Fatal("a second request let through on one token")
	}
}

func TestSweepForgetsOnlyFullBuckets(t *testing.T) {
	l, c := newTestLimiter(3, 3, time.Hour)

	l.Allow("old")
	c.advance(50 * time.Minute)
	l.Allow("new")
	c.advance(10 * time.Minute)

	// "old" has had the 20 minutes its token takes to come back; "new" has not.
	l.Sweep()
	if l.Len() != 1 {
		t.Fatalf("%d keys left, want only the one still refilling", l.Len())
	}
	if _, ok := l.buckets["new"]; !ok {
		t.Fatal("swept the key whose bucket is not full")
	}

	// A swept key starts with a full bucket, as it would have had.
	for i := range 3 {
		if ok, _ := l.Allow("old"); !ok {
			t.Fatalf("request %d of a swept key refused", i+1)
		}
	}
}

func TestSweeperStopsWithItsContext(t *testing.T) {
	l, _ := newTestLimiter(1, 1, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	StartSweeper(ctx, &wg, time.Millisecond, l)
	cancel()
	wg.Wait()
}
