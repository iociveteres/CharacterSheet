package forum

import (
	"context"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgx/v5/pgxpool"
)

// at is a time of the tests' forum: minute m of a day in February 2026.
func at(m int) time.Time {
	return time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(m) * time.Minute)
}

func newSection(t *testing.T, db *pgxpool.Pool, name string) int {
	t.Helper()
	var id int
	err := db.QueryRow(context.Background(), `
		INSERT INTO forum_sections (name, position) VALUES ($1, 100) RETURNING id`, name).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func newModerator(t *testing.T, db *pgxpool.Pool, name string) int {
	t.Helper()
	id := forumtest.User(t, db, name, at(0))
	if _, err := db.Exec(context.Background(), `INSERT INTO forum_moderators (user_id) VALUES ($1)`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func mustCreateTopic(t *testing.T, f *Forum, sectionID, authorID int, title string, when time.Time) (topicID, postID int) {
	t.Helper()
	topicID, postID, err := f.createTopic(context.Background(), sectionID, authorID, title, "first post of "+title, when)
	if err != nil {
		t.Fatal(err)
	}
	return topicID, postID
}

func mustReply(t *testing.T, f *Forum, topicID, authorID int, body string, when time.Time) int {
	t.Helper()
	id, err := f.reply(context.Background(), topicID, authorID, body, when)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// deletePost deletes a post as a moderator will in block 5: in a transaction with the recount.
func deletePost(t *testing.T, db *pgxpool.Pool, postID int) {
	t.Helper()
	ctx := context.Background()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var topicID int
	err = tx.QueryRow(ctx, `
		UPDATE forum_posts SET deleted_at = now(), deleted_by = author_id WHERE id = $1
		RETURNING topic_id`, postID).Scan(&topicID)
	if err == nil {
		err = recountTopic(ctx, tx, topicID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func deleteTopic(t *testing.T, db *pgxpool.Pool, topicID int) {
	t.Helper()
	_, err := db.Exec(context.Background(), `
		UPDATE forum_topics SET deleted_at = now(), deleted_by = author_id WHERE id = $1`, topicID)
	if err != nil {
		t.Fatal(err)
	}
}

// A time is shown as how long ago, counted from the forum's now, with the full date on hover.
func TestViewTime(t *testing.T) {
	v := view{Lang: "en", TimeZone: time.UTC, Now: at(90)}
	got := string(v.Time(at(0)))
	if !strings.HasPrefix(got, `<time datetime="2026-02-01T00:00:00Z" title="`+i18n.FormatDate("en", at(0), time.UTC)+`">`) {
		t.Errorf("Time = %s", got)
	}
	// Ninety minutes ago is not the full date; a year ago is.
	if strings.Contains(got, ">"+i18n.FormatDate("en", at(0), time.UTC)+"<") {
		t.Errorf("Time = %s", got)
	}
	v.Now = at(0).AddDate(1, 0, 1)
	assert.StringContains(t, string(v.Time(at(0))), ">"+i18n.FormatDate("en", at(0), time.UTC)+"</time>")
	assert.Equal(t, string(v.Time(time.Time{})), "")
}
