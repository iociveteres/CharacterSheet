package models

import (
	"errors"
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
)
