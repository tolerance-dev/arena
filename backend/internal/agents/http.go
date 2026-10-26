package agents

import (
	"errors"
	"io"
	"net/http"

	"tolerance/internal/identity"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/pricing"
)

// RegisterPublicRoutes mounts the public reads (no keys).
func RegisterPublicRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/agents", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.List(r.Context(), "", false)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("GET /api/v1/agents/examples", func(w http.ResponseWriter, r *http.Request) {
		httpx.Respond(w, http.StatusOK, map[string]any{"items": Examples, "models": pricing.Models})
	})
	mux.HandleFunc("GET /api/v1/agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		a, err := s.Get(r.Context(), r.PathValue("id"), false)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, a)
	})
}

// RegisterOwnerRoutes mounts uploads and key management for any signed-in user. Each user sees and changes only
// their own agents; an admin manages everyone's.
func RegisterOwnerRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/my/agents", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.List(r.Context(), identity.MustFromContext(r.Context()).UserID, true)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("POST /api/v1/my/agents", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, MaxBundleBytes+(256<<10))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				httpx.WriteError(w, r, httpx.New(http.StatusRequestEntityTooLarge, "body_too_large", "The bundle is larger than 20 MB"))
				return
			}
			httpx.WriteError(w, r, invalid("Send a multipart form with a bundle field"))
			return
		}
		defer r.MultipartForm.RemoveAll()
		data, model, err := formBundle(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		a, err := s.Create(r.Context(), identity.MustFromContext(r.Context()).UserID, identity.OwnerScope(r.Context()) != "", CreateInput{
			Name: r.FormValue("name"), Description: r.FormValue("description"), Provider: r.FormValue("provider"),
			APIKey: r.FormValue("api_key"), Bundle: data, Model: model,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusCreated, a)
	})
	mux.HandleFunc("PUT /api/v1/my/agents/{id}/key", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in struct {
			Provider string `json:"provider"`
			APIKey   string `json:"api_key"`
		}
		if err := httpx.Decode(raw, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		a, err := s.UpdateKey(r.Context(), identity.OwnerScope(r.Context()), r.PathValue("id"), in.Provider, in.APIKey)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, a)
	})
	mux.HandleFunc("DELETE /api/v1/my/agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Delete(r.Context(), identity.OwnerScope(r.Context()), r.PathValue("id")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// formBundle is the upload's bundle and its model: a ready example (example=<slug>, model=<slug>, see Examples)
// or the uploaded file (model unknown).
func formBundle(r *http.Request) ([]byte, string, error) {
	if slug := r.FormValue("example"); slug != "" {
		return exampleBundle(slug, r.FormValue("model"), r.FormValue("provider"))
	}
	f, _, err := r.FormFile("bundle")
	if err != nil {
		return nil, "", invalid("Pick a ready agent or upload a bundle")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxBundleBytes+1))
	if err != nil || len(data) > MaxBundleBytes {
		return nil, "", httpx.New(http.StatusRequestEntityTooLarge, "body_too_large", "The bundle is larger than 20 MB")
	}
	return data, "", nil
}
