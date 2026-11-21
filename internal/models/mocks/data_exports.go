package mocks

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/models"
)

// DataExportModel keeps the queue of the data exports in memory, with the rules of the real one.
// Its content is Alice's (user 1): a sheet in her room, an NPC of a scene there, her collection 1
// of BestiaryModel, a portrait, a chat message and a forum post; any other user has an account and
// nothing else.
type DataExportModel struct {
	mu   sync.Mutex
	rows map[int]*exportRow
	seq  int
	// Hold, when set, keeps every build waiting in Account until it is closed: builds in progress.
	Hold chan struct{}
}

type exportRow struct {
	models.DataExport
	// seq orders the requests: the times of a test may be equal.
	seq int
}

// AlicePortrait is the hash of the portrait of Alice's sheet.
const AlicePortrait = "0123456789abcdef"

// Put sets the user's export as the database would have it.
func (m *DataExportModel) Put(userID int, e models.DataExport) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rows == nil {
		m.rows = map[int]*exportRow{}
	}
	m.seq++
	m.rows[userID] = &exportRow{DataExport: e, seq: m.seq}
}

// State is the state of the user's export, "" for none.
func (m *DataExportModel) State(userID int) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rows[userID]; ok {
		return r.State
	}
	return ""
}

func (m *DataExportModel) Get(ctx context.Context, userID int) (*models.DataExport, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[userID]
	if !ok {
		return nil, models.ErrNoRecord
	}
	e := r.DataExport
	if e.State == models.ExportQueued {
		for _, o := range m.rows {
			if o.State == models.ExportQueued && o.seq < r.seq {
				e.Ahead++
			}
		}
	}
	return &e, nil
}

func (m *DataExportModel) Request(ctx context.Context, userID int) (string, error) {
	m.mu.Lock()
	r, ok := m.rows[userID]
	m.mu.Unlock()
	switch {
	case !ok:
	case r.State == models.ExportQueued || r.State == models.ExportBuilding:
		return "", nil
	case r.State == models.ExportReady && time.Since(r.RequestedAt) < models.ExportEvery:
		return "", &models.ExportTooSoonError{Until: r.RequestedAt.Add(models.ExportEvery)}
	}
	old := ""
	if ok {
		old = r.FileName
	}
	m.Put(userID, models.DataExport{State: models.ExportQueued, RequestedAt: time.Now()})
	return old, nil
}

func (m *DataExportModel) Discard(ctx context.Context, userID int, fileName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.rows[userID]; ok && r.State == models.ExportReady && r.FileName == fileName {
		delete(m.rows, userID)
	}
	return nil
}

func (m *DataExportModel) Claim(ctx context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var queued []int
	for id, r := range m.rows {
		if r.State == models.ExportQueued {
			queued = append(queued, id)
		}
	}
	if len(queued) == 0 {
		return 0, models.ErrNoRecord
	}
	sort.Slice(queued, func(i, j int) bool { return m.rows[queued[i]].seq < m.rows[queued[j]].seq })
	m.rows[queued[0]].State = models.ExportBuilding
	return queued[0], nil
}

// set changes the user's export if it is in state from.
func (m *DataExportModel) set(userID int, from string, change func(*exportRow)) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[userID]
	if !ok || r.State != from {
		return false
	}
	change(r)
	return true
}

func (m *DataExportModel) Finish(ctx context.Context, userID int, fileName string, size int64) error {
	now := time.Now()
	if !m.set(userID, models.ExportBuilding, func(r *exportRow) {
		r.State, r.ReadyAt, r.FileName, r.Size = models.ExportReady, &now, fileName, size
	}) {
		return models.ErrNoRecord
	}
	return nil
}

func (m *DataExportModel) Fail(ctx context.Context, userID int) error {
	m.set(userID, models.ExportBuilding, func(r *exportRow) { r.State = models.ExportFailed })
	return nil
}

func (m *DataExportModel) Requeue(ctx context.Context, userID int) error {
	m.set(userID, models.ExportBuilding, func(r *exportRow) { r.State = models.ExportQueued })
	return nil
}

func (m *DataExportModel) RequeueBuilding(ctx context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.rows {
		if r.State == models.ExportBuilding {
			r.State = models.ExportQueued
			n++
		}
	}
	return n, nil
}

func (m *DataExportModel) DeleteExpired(ctx context.Context, olderThan time.Duration) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var files []string
	for id, r := range m.rows {
		if r.State == models.ExportReady && r.ReadyAt != nil && time.Since(*r.ReadyAt) > olderThan {
			files = append(files, r.FileName)
			delete(m.rows, id)
		}
	}
	return files, nil
}

func (m *DataExportModel) Account(ctx context.Context, userID int) (*models.ExportAccount, error) {
	if m.Hold != nil {
		select {
		case <-m.Hold:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if userID == 1 {
		return &models.ExportAccount{Name: "Alice", Email: "alice@example.com", Locale: "ru",
			FormerNames: []models.NameChange{{Name: "Alicia", ChangedAt: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)}}}, nil
	}
	return &models.ExportAccount{Name: "Bob", Email: "bob@example.com", FormerNames: []models.NameChange{}}, nil
}

func (m *DataExportModel) Avatar(ctx context.Context, userID int) (*models.Avatar, error) {
	return nil, models.ErrNoRecord
}

func (m *DataExportModel) Rooms(ctx context.Context, userID int) ([]models.ExportRoom, error) {
	if userID != 1 {
		return []models.ExportRoom{}, nil
	}
	role := models.RoleGamemaster
	return []models.ExportRoom{{Name: "Room/1", Role: &role, Owner: true, DicePresets: []models.ExportDicePreset{{Slot: 1, Notation: "1d10"}}}}, nil
}

func (m *DataExportModel) Sheets(ctx context.Context, userID int, fn func(models.ExportSheet) error) error {
	if userID != 1 {
		return nil
	}
	author := "Alice"
	for _, s := range []models.ExportSheet{
		{ID: 1, Room: "Room/1", CharacterName: "Hero", Kind: models.DefaultSheetKind, Content: json.RawMessage(`{"characterInfo": {"characterName": "Hero"}}`), Author: &author},
		{ID: 5, Room: "Room/1", NPC: true, CharacterName: "Cultist", Kind: models.DefaultSheetKind, Content: json.RawMessage(`{"characterInfo": {"characterName": "Cultist"}}`)},
	} {
		if err := fn(s); err != nil {
			return err
		}
	}
	return nil
}

func (m *DataExportModel) Collections(ctx context.Context, userID int) ([]models.ExportCollection, error) {
	if userID != 1 {
		return nil, nil
	}
	return []models.ExportCollection{{ID: 1, Name: "Orks"}}, nil
}

func (m *DataExportModel) PortraitHashes(ctx context.Context, userID int) ([]string, error) {
	if userID != 1 {
		return nil, nil
	}
	return []string{AlicePortrait}, nil
}

func (m *DataExportModel) Portrait(ctx context.Context, hash string) (*models.Portrait, error) {
	if hash != AlicePortrait {
		return nil, models.ErrNoRecord
	}
	return &models.Portrait{Mime: "image/webp", Data: []byte("RIFF")}, nil
}

func (m *DataExportModel) ChatMessages(ctx context.Context, userID int, fn func(models.ExportMessage) error) error {
	if userID != 1 {
		return nil
	}
	return fn(models.ExportMessage{Room: "Room/1", Text: "hello"})
}

func (m *DataExportModel) ForumTopics(ctx context.Context, userID int, fn func(forum.ExportTopic) error) error {
	return nil
}

func (m *DataExportModel) ForumPosts(ctx context.Context, userID int, fn func(forum.ExportPost) error) error {
	if userID != 1 {
		return nil
	}
	return fn(forum.ExportPost{ID: 1, TopicID: 1, Topic: "Rules", Body: "**hi**"})
}

func (m *DataExportModel) ForumProfile(ctx context.Context, userID int) (*forum.ExportProfile, error) {
	return &forum.ExportProfile{Subscriptions: []forum.ExportSubscription{}}, nil
}

func (m *DataExportModel) Moderation(ctx context.Context, userID int) (*models.ExportModeration, error) {
	return &models.ExportModeration{ForumBans: []forum.ExportBan{}}, nil
}
