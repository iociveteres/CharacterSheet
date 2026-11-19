package forum

import (
	"context"
	"errors"
	"math"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5"
)

// The limits of decision 6 of the plan, the only place of these numbers. Moderators have none.
// The first post of a topic counts as the topic, not as a reply.
const (
	repliesPerMinute           = 5
	topicsPerHour              = 5
	newAccountRepliesPerMinute = 1
	newAccountTopicsPerHour    = 2
	// newAccountAge is how long an account counts as new.
	newAccountAge = 24 * time.Hour
)

var (
	replyLimit = rateLimit{window: time.Minute, max: repliesPerMinute, newAccountMax: newAccountRepliesPerMinute}
	topicLimit = rateLimit{window: time.Hour, max: topicsPerHour, newAccountMax: newAccountTopicsPerHour}
)

// rateLimit is at most max posts of one kind in any window; newAccountMax while the account is
// younger than newAccountAge.
type rateLimit struct {
	window        time.Duration
	max           int
	newAccountMax int
}

// maxFor is how many the viewer may write in a window at the given time.
func (l rateLimit) maxFor(v Viewer, now time.Time) int {
	if now.Sub(v.RegisteredAt) < newAccountAge {
		return l.newAccountMax
	}
	return l.max
}

// The queries count by the time of writing, deleted posts and topics too: deleting what one wrote
// gives no room to write more. A row exactly window old is out of the window.
const (
	// The first post of a topic is the topic's, so replies leave it out.
	recentRepliesSQL = `
		SELECT p.created_at FROM forum_posts p
		WHERE p.author_id = $1 AND p.created_at > $2
		  AND p.id <> (SELECT min(q.id) FROM forum_posts q WHERE q.topic_id = p.topic_id)
		ORDER BY p.created_at DESC
		OFFSET $3 LIMIT 1`
	recentTopicsSQL = `
		SELECT created_at FROM forum_topics
		WHERE author_id = $1 AND created_at > $2
		ORDER BY created_at DESC
		OFFSET $3 LIMIT 1`
)

// nextReplyAt and nextTopicAt are when the viewer may write the next reply or topic: the zero time
// when they may now.
func (f *Forum) nextReplyAt(ctx context.Context, v Viewer, now time.Time) (time.Time, error) {
	return f.nextAt(ctx, recentRepliesSQL, replyLimit, v, now)
}

func (f *Forum) nextTopicAt(ctx context.Context, v Viewer, now time.Time) (time.Time, error) {
	return f.nextAt(ctx, recentTopicsSQL, topicLimit, v, now)
}

// nextAt finds the oldest of the last max rows in the window: when it leaves the window, there is
// room for one more. Without that row there is room now.
func (f *Forum) nextAt(ctx context.Context, query string, l rateLimit, v Viewer, now time.Time) (time.Time, error) {
	if v.Moderator {
		return time.Time{}, nil
	}
	var oldest time.Time
	err := f.db.QueryRow(ctx, query, v.ID, now.Add(-l.window), l.maxFor(v, now)-1).Scan(&oldest)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return oldest.Add(l.window), nil
}

// tooOften is the error of a form sent before next: when the viewer may write again.
func tooOften(lang string, next, now time.Time) string {
	if count, seconds := waitUnit(next.Sub(now)); seconds {
		return i18n.T(lang, "forum.errors.tooOftenSeconds", i18n.Params{"count": count})
	} else {
		return i18n.T(lang, "forum.errors.tooOftenMinutes", i18n.Params{"count": count})
	}
}

// waitUnit tells a wait in seconds under a minute, else in minutes, rounded up.
func waitUnit(wait time.Duration) (count int, seconds bool) {
	if wait < time.Minute {
		return int(math.Ceil(wait.Seconds())), true
	}
	return int(math.Ceil(wait.Minutes())), false
}
