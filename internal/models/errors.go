package models

import (
	"errors"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNoRecord           = errors.New("models: no matching record found")
	ErrInvalidCredentials = errors.New("models: invalid credentials")
	ErrUserNotActivated   = errors.New("models: email is not verified")
	ErrDuplicateEmail     = errors.New("models: duplicate email")
	ErrNoContent          = errors.New("models: character sheet has no content")
	ErrBadType            = errors.New("models: incoming value has wrong JSON type for path")
	ErrLinkInvalid        = errors.New("models: invite link is invalid or expired")
	ErrPermissionDenied   = errors.New("models: permission denied")
	// ErrGone: an edit inside an item of a grid that is not in the sheet,
	// deleted by someone else while the edit was on its way.
	ErrGone = errors.New("models: the item is gone")
	// ErrDestinationGone: a move into a grid of an item deleted by someone
	// else. Unlike ErrGone the moved item is still where it was.
	ErrDestinationGone = errors.New("models: the item the destination grid is in is gone")
	// ErrSheetTooLarge: the content written would be larger than the
	// content_size check of character_sheets allows (migration 000051).
	ErrSheetTooLarge = errors.New("models: the sheet would be too large")
	// ErrDeletionScheduled: the right password of an account in its grace period before the wipe.
	ErrDeletionScheduled = errors.New("models: account deletion is scheduled")
	// ErrDuplicateName: the name is someone else's, compared regardless of case (users_name_key).
	ErrDuplicateName = errors.New("models: duplicate name")
)

// duplicateUser is ErrDuplicateEmail or ErrDuplicateName for a unique violation of the user's
// email or name, else err itself.
func duplicateUser(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation {
		switch pgErr.ConstraintName {
		case "users_email_key":
			return ErrDuplicateEmail
		case "users_name_key":
			return ErrDuplicateName
		}
	}
	return err
}

// sheetTooLarge is ErrSheetTooLarge for a violation of the content_size
// check, else err itself.
func sheetTooLarge(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.CheckViolation && pgErr.ConstraintName == "content_size" {
		return ErrSheetTooLarge
	}
	return err
}
