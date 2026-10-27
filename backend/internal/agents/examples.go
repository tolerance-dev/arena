package agents

import (
	"embed"
	"slices"

	"tolerance/internal/pricing"
)

// The example agents (examples/README.md), built into the binary so a user can start from one without a file.
//
//go:embed examples/*/run.sh
var exampleFiles embed.FS

// Example is a ready agent (a CLI) a user may pick instead of uploading a bundle, with any model it can reach.
type Example struct {
	Slug      string   `json:"slug"`
	Name      string   `json:"name"`      // the CLI, the first half of the default agent name
	Model     string   `json:"model"`     // the model it runs unless the user picks another (a pricing.Models slug)
	Providers []string `json:"providers"` // keys its protocol works with; the first is its vendor's own
}

// Examples is the picker's list. demo is left out: it writes the reference app by hand, so it would top every
// ranking without an agent behind it. A CLI works with a key when it speaks that key's protocol: OrcaRouter takes
// all three (Anthropic, OpenAI, Gemini) with one key, a vendor key only its own.
var Examples = []Example{
	{Slug: "claude-code", Name: "Claude Code", Model: "claude-opus-5.5", Providers: []string{"anthropic", "orcarouter", "claude-sub"}},
	{Slug: "codex", Name: "Codex", Model: "gpt-6.1-sol", Providers: []string{"openai", "orcarouter", "chatgpt-sub"}},
	{Slug: "gemini-cli", Name: "Gemini CLI", Model: "gemini-3.8-flash", Providers: []string{"google", "orcarouter"}},
	{Slug: "kimi-code", Name: "Kimi Code", Model: "kimi-k3", Providers: []string{"orcarouter", "openai"}},
	{Slug: "opencode", Name: "OpenCode", Model: "deepseek-v4.1-flash-free", Providers: []string{"orcarouter", "openai"}},
}

// exampleBundle returns the example's run.sh and the model it will run (the worker sets MODEL to that model's id
// at the agent's key kind, which every example honours), or invalid input when the slug or model is unknown or the
// key can't reach that model through that CLI.
func exampleBundle(slug, model, provider string) ([]byte, string, error) {
	e := exampleBySlug(slug)
	if e == nil {
		return nil, "", invalid("Unknown example agent")
	}
	if model == "" {
		model = e.Model
	}
	m := pricing.BySlug(model)
	if m == nil {
		return nil, "", invalid("Unknown model")
	}
	if _, ok := m.IDs[provider]; !ok || !slices.Contains(e.Providers, provider) {
		return nil, "", invalid("This agent can't run that model with that kind of key")
	}
	script, err := exampleFiles.ReadFile("examples/" + slug + "/run.sh")
	return script, model, err
}

func exampleBySlug(slug string) *Example {
	if i := slices.IndexFunc(Examples, func(e Example) bool { return e.Slug == slug }); i >= 0 {
		return &Examples[i]
	}
	return nil
}
