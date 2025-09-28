package validator

import (
	"errors"
)

var (
	ErrBadType = errors.New("incoming value has wrong JSON type for path")
)
