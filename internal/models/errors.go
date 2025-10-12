package models

import (
	"errors"
)

var (
	ErrNoRecord           = errors.New("models: no matching record found")
	ErrInvalidCredentials = errors.New("models: invalid credentials")
	ErrDuplicateEmail     = errors.New("models: duplicate email")
	ErrNoContent          = errors.New("models: character sheet has no content")
	ErrBadType            = errors.New("models: incoming value has wrong JSON type for path")
	ErrLinkInvalid        = errors.New("models: invite link is invalid or expired")
)
