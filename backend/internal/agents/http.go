package agents

import (
	"errors"
	"io"
	"net/http"

	"dopamine/internal/identity"
	"dopamine/internal/platform/httpx"
)

// RegisterPublicRoutes mounts the public reads (no keys).
func RegisterPublicRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/agents", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.List(r.Context(), false)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
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

// RegisterAdminRoutes mounts uploads and key management (admins only, for now: only the platform owner uploads).
func RegisterAdminRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/admin/agents", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.List(r.Context(), true)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("POST /api/v1/admin/agents", func(w http.ResponseWriter, r *http.Request) {
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
		f, _, err := r.FormFile("bundle")
		if err != nil {
			httpx.WriteError(w, r, invalid("The bundle (zip) is required"))
			return
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, MaxBundleBytes+1))
		if err != nil || len(data) > MaxBundleBytes {
			httpx.WriteError(w, r, httpx.New(http.StatusRequestEntityTooLarge, "body_too_large", "The bundle is larger than 20 MB"))
			return
		}
		a, err := s.Create(r.Context(), identity.MustFromContext(r.Context()).UserID, CreateInput{
			Name: r.FormValue("name"), Description: r.FormValue("description"), Provider: r.FormValue("provider"),
			APIKey: r.FormValue("api_key"), Bundle: data,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusCreated, a)
	})
	mux.HandleFunc("PUT /api/v1/admin/agents/{id}/key", func(w http.ResponseWriter, r *http.Request) {
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
		a, err := s.UpdateKey(r.Context(), r.PathValue("id"), in.Provider, in.APIKey)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, a)
	})
	mux.HandleFunc("DELETE /api/v1/admin/agents/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Delete(r.Context(), r.PathValue("id")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
