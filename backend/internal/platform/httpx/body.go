package httpx

import (
	"io"
	"net/http"
	"strings"
)

// maxBodyBytes bounds ordinary JSON request bodies; uploads set their own limit.
const maxBodyBytes = 64 << 10

// ReadBody reads the request body up to a fixed limit, returning a Problem
// (413) rather than a generic error when it is exceeded.
func ReadBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		return nil, New(http.StatusRequestEntityTooLarge, "body_too_large", "Request body exceeds 64 KiB")
	}
	return raw, nil
}

// ValidText reports whether value, once trimmed, has length in [min, max] bytes.
func ValidText(value string, min, max int) bool {
	trimmed := strings.TrimSpace(value)
	return len(trimmed) >= min && len(value) <= max
}
