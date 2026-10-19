// Package idgen generates opaque, prefixed identifiers.
package idgen

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns a prefixed random identifier, e.g. "mission_3f9a...".
// 128 bits of randomness make collisions and enumeration infeasible.
func New(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
