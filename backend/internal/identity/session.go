package identity

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"
)

const sessionTTL = 30 * 24 * time.Hour

// SessionCookie is the session cookie's name. UseHostPrefix switches it to the __Host- form.
var SessionCookie = "arena_session"

// UseHostPrefix names the session cookie __Host-arena_session (secure cookies only). Browsers refuse such a cookie
// from any other host, so a sibling subdomain, such as a live preview of an agent's app, can't plant or overwrite it.
func UseHostPrefix() { SessionCookie = "__Host-arena_session" }

var ErrNoSession = errors.New("identity: no such session")

func newSessionToken() (token, id string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(b[:])
	return token, sessionID(token), nil
}

func sessionID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func SetSessionCookie(w http.ResponseWriter, token string, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
}

func ClearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}
