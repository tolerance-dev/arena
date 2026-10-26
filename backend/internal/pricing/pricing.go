// Package pricing is the model catalog the example agents run on, with each model's id at each key kind and its
// list price, so a run's metered tokens turn into dollars.
package pricing

import (
	"slices"
	"strings"
)

// Price is in USD per million tokens. CacheWrite is the 5-minute cache write where the vendor bills one.
type Price struct {
	In         float64 `json:"in"`
	Out        float64 `json:"out"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
}

// Model is a model the agent picker offers.
type Model struct {
	Slug   string            `json:"slug"`
	Name   string            `json:"name"`
	IDs    map[string]string `json:"ids"` // provider → the model id that provider takes (absent = not served there)
	Price  Price             `json:"price"`
	Source string            `json:"source"` // where the price is from, and since when
}

// Models: vendor list prices (standard tier, short prompts), checked 2026-10-26. OrcaRouter says it bills the
// provider's rate with no markup, so one price covers both key kinds.
var Models = []Model{
	{Slug: "claude-opus-5.5", Name: "Claude Opus 5.5",
		IDs:    map[string]string{"anthropic": "claude-opus-5-5", "claude-sub": "claude-opus-5-5", "orcarouter": "anthropic/claude-opus-5.5"},
		Price:  Price{In: 4, Out: 20, CacheRead: 0.20, CacheWrite: 5},
		Source: "platform.claude.com/docs/en/about-claude/pricing, 2026-10-26"},
	{Slug: "gpt-6.1-sol", Name: "GPT-6.1 Sol",
		IDs:    map[string]string{"openai": "gpt-6.1-sol", "chatgpt-sub": "gpt-6.1-sol", "orcarouter": "openai/gpt-6.1-sol"},
		Price:  Price{In: 2, Out: 10, CacheRead: 0.10, CacheWrite: 2.50},
		Source: "developers.openai.com/api/docs/pricing, 2026-10-26"},
	// Introductory until 2026-12-31; from 2027-01-01 Google doubles it ($1.50 / $7.50 / $0.15).
	{Slug: "gemini-3.8-flash", Name: "Gemini 3.8 Flash",
		IDs:    map[string]string{"google": "gemini-3.8-flash", "orcarouter": "google/gemini-3.8-flash"},
		Price:  Price{In: 0.75, Out: 3.75, CacheRead: 0.075, CacheWrite: 0.75},
		Source: "ai.google.dev/gemini-api/docs/pricing, 2026-10-26 (introductory until 2026-12-31)"},
	{Slug: "kimi-k3", Name: "Kimi K3",
		IDs:    map[string]string{"orcarouter": "kimi/kimi-k3"},
		Price:  Price{In: 3, Out: 15, CacheRead: 0.30, CacheWrite: 3},
		Source: "orcarouter.ai/compare/deepseek-v4.1-flash-vs-kimi-k3, 2026-10-26"},
	{Slug: "deepseek-v4.1-flash-free", Name: "DeepSeek V4.1 Flash (free)",
		IDs:    map[string]string{"orcarouter": "deepseek/deepseek-v4.1-flash-free"},
		Price:  Price{},
		Source: "orcarouter.ai/models/deepseek/deepseek-v4.1-flash-free, 2026-10-26"},
}

// BySlug is the catalog model, or nil.
func BySlug(slug string) *Model {
	i := slices.IndexFunc(Models, func(m Model) bool { return m.Slug == slug })
	if i < 0 {
		return nil
	}
	return &Models[i]
}

// Subscription is true for a personal subscription key: runs spend its limits, not money.
func Subscription(provider string) bool { return strings.HasSuffix(provider, "-sub") }

// Spent is what these tokens cost the owner: 0 on a subscription (it spends limits, not money), else Cost.
func Spent(model, provider string, in, out, cacheRead, cacheWrite int64) *float64 {
	c := Cost(model, in, out, cacheRead, cacheWrite)
	if c != nil && Subscription(provider) {
		*c = 0
	}
	return c
}

// Cost is what these tokens cost in USD at the model's list price: nil when the model is unknown (an uploaded
// agent).
func Cost(model string, in, out, cacheRead, cacheWrite int64) *float64 {
	m := BySlug(model)
	if m == nil {
		return nil
	}
	p := m.Price
	c := (float64(in)*p.In + float64(out)*p.Out + float64(cacheRead)*p.CacheRead + float64(cacheWrite)*p.CacheWrite) / 1e6
	return &c
}
