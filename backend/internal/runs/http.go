package runs

import (
	"net/http"
	"strconv"
	"time"

	"tolerance/internal/identity"
	"tolerance/internal/platform/httpx"
	"tolerance/internal/sandbox"
	"tolerance/internal/tasks"
)

// TaskView is a task page: the brief as the agents get it, the data files, the leaderboard and the latest runs.
type TaskView struct {
	TaskSummary
	Brief     string   `json:"brief"`
	DataFiles []string `json:"data_files"`
	Checks    []string `json:"checks"`
	Compare   []Run    `json:"compare"`
	Recent    []Run    `json:"recent"`
	// Ratings is the agents' Elo from people's blind votes, by agent id (only agents someone voted on).
	Ratings map[string]Rating `json:"ratings"`
}

// RegisterPublicRoutes mounts the public reads.
func RegisterPublicRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/tasks", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Summaries(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("GET /api/v1/tasks/{slug}", func(w http.ResponseWriter, r *http.Request) {
		t := tasks.BySlug(r.PathValue("slug"))
		if t == nil {
			httpx.WriteError(w, r, httpx.NotFound())
			return
		}
		v := TaskView{Brief: t.Brief, DataFiles: t.DataNames(), Checks: t.CheckNames()}
		var err error
		if v.TaskSummary, err = s.Summary(r.Context(), t); err == nil {
			v.Recent, err = s.Recent(r.Context(), t.Slug, "", "", 20)
		}
		if err == nil {
			v.Compare, err = s.Compare(r.Context(), t.Slug)
		}
		if err == nil {
			v.Ratings, err = s.Ratings(r.Context(), t.Slug)
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, v)
	})
	mux.HandleFunc("GET /api/v1/tasks/{slug}/bundle.zip", func(w http.ResponseWriter, r *http.Request) {
		t := tasks.BySlug(r.PathValue("slug"))
		if t == nil {
			httpx.WriteError(w, r, httpx.NotFound())
			return
		}
		data, err := t.BundleZip()
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+t.Slug+`-task.zip"`)
		_, _ = w.Write(data)
	})
	mux.HandleFunc("GET /api/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 || limit > 100 {
			limit = 30
		}
		var items []Run
		var err error
		if r.URL.Query().Get("active") == "1" {
			items, err = s.Active(r.Context())
		} else {
			items, err = s.Recent(r.Context(), r.URL.Query().Get("task"), r.URL.Query().Get("agent"), r.URL.Query().Get("status"), limit)
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("GET /api/v1/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		run, err := s.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, run)
	})
	blob := func(column, ctype, disposition string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := s.Blob(r.Context(), r.PathValue("id"), column)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			w.Header().Set("Content-Type", ctype)
			if disposition != "" {
				w.Header().Set("Content-Disposition", disposition)
			} else {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("GET /api/v1/runs/{id}/shot.jpg", blob("shot", "image/jpeg", ""))
	mux.HandleFunc("GET /api/v1/runs/{id}/shot-mobile.jpg", blob("shot_mobile", "image/jpeg", ""))
	mux.HandleFunc("GET /api/v1/runs/{id}/source.zip", func(w http.ResponseWriter, r *http.Request) {
		blob("source_zip", "application/zip", `attachment; filename="`+PreviewHost(r.PathValue("id"))+`-source.zip"`)(w, r)
	})

	// A guest's pair: they see the apps before signing in, and sign in to vote (POST /api/v1/my/votes claims it).
	mux.HandleFunc("GET /api/v1/vote", func(w http.ResponseWriter, r *http.Request) {
		if s.GuestPairAllowed != nil && !s.GuestPairAllowed(r) {
			httpx.WriteError(w, r, httpx.New(http.StatusTooManyRequests, "rate_limited", "Too many pairs: take a break and come back later"))
			return
		}
		p, err := s.NextPair(r.Context(), "", r.URL.Query().Get("task"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"pair": p})
	})
	voteShot := func(column string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := s.VoteShot(r.Context(), r.PathValue("alias"), column)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Cache-Control", "private, max-age=3600")
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("GET /api/v1/vote/{alias}/shot.jpg", voteShot("shot"))
	mux.HandleFunc("GET /api/v1/vote/{alias}/shot-mobile.jpg", voteShot("shot_mobile"))
}

// RegisterAdminRoutes mounts what only admins do with runs (the caller wraps it in RequireSession + RequireAdmin).
func RegisterAdminRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/admin/tournament", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.TournamentState(r.Context(), identity.MustFromContext(r.Context()).UserID, time.Now())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, out)
	})
	mux.HandleFunc("POST /api/v1/admin/tournament", func(w http.ResponseWriter, r *http.Request) {
		n, err := s.StartTournament(r.Context(), identity.MustFromContext(r.Context()).UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusCreated, map[string]int{"runs": n})
	})
	mux.HandleFunc("PUT /api/v1/admin/tournament/weekly", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in struct {
			On bool `json:"on"`
		}
		if err := httpx.Decode(raw, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := s.SetTournamentWeekly(r.Context(), identity.MustFromContext(r.Context()).UserID, in.On); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/v1/admin/runs/{id}/recheck", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Recheck(r.Context(), r.PathValue("id")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// RegisterOwnerRoutes mounts starting, cancelling and deleting runs for any signed-in user, on their own agents
// (an admin: on any agent).
func RegisterOwnerRoutes(mux *http.ServeMux, s *Service) {
	mux.HandleFunc("GET /api/v1/my/runs", func(w http.ResponseWriter, r *http.Request) {
		var items []Run
		var err error
		if r.URL.Query().Get("latest") == "1" {
			items, err = s.Latest(r.Context(), identity.MustFromContext(r.Context()).UserID)
		} else {
			items, err = s.Mine(r.Context(), identity.MustFromContext(r.Context()).UserID, 30)
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"items": items})
	})
	// The run history on /my: finished runs, a page at a time, filtered by agent, task and outcome.
	mux.HandleFunc("GET /api/v1/my/runs/history", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		page, _ := strconv.Atoi(q.Get("page"))
		out, err := s.History(r.Context(), identity.MustFromContext(r.Context()).UserID, q.Get("agent"), q.Get("task"), q.Get("outcome"), page, 10)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, out)
	})
	mux.HandleFunc("POST /api/v1/my/runs", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in struct {
			AgentID     string `json:"agent_id"`
			Task        string `json:"task"`
			TimeLimitS  int    `json:"time_limit_s"`
			TokenBudget int64  `json:"token_budget"`
		}
		if err := httpx.Decode(raw, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		run, err := s.Create(r.Context(), identity.OwnerScope(r.Context()), in.AgentID, in.Task, in.TimeLimitS, in.TokenBudget)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusCreated, run)
	})
	mux.HandleFunc("GET /api/v1/my/vote", func(w http.ResponseWriter, r *http.Request) {
		p, err := s.NextPair(r.Context(), identity.MustFromContext(r.Context()).UserID, r.URL.Query().Get("task"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusOK, map[string]any{"pair": p})
	})
	mux.HandleFunc("POST /api/v1/my/votes", func(w http.ResponseWriter, r *http.Request) {
		raw, err := httpx.ReadBody(w, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var in struct {
			Pair   string `json:"pair"`
			Winner string `json:"winner"`
		}
		if err := httpx.Decode(raw, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		userID := identity.MustFromContext(r.Context()).UserID
		if s.VoteAllowed != nil && !s.VoteAllowed(r, userID) {
			httpx.WriteError(w, r, httpx.New(http.StatusTooManyRequests, "rate_limited", "Too many votes: take a break and come back later"))
			return
		}
		rev, err := s.Vote(r.Context(), userID, in.Pair, in.Winner)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.Respond(w, http.StatusCreated, rev)
	})
	mux.HandleFunc("POST /api/v1/my/runs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Cancel(r.Context(), identity.OwnerScope(r.Context()), r.PathValue("id")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /api/v1/my/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := s.Delete(r.Context(), identity.OwnerScope(r.Context()), id); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		go sandbox.RemoveImage(ImageFor(id))
		w.WriteHeader(http.StatusNoContent)
	})
}
