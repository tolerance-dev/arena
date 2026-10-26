package agents

import (
	"embed"
	"slices"
)

// The example agents (examples/README.md), built into the binary so a user can start from one without a file.
//
//go:embed examples/*/run.sh
var exampleFiles embed.FS

// Example is a ready agent a user may pick instead of uploading a bundle.
type Example struct {
	Slug      string   `json:"slug"`
	Name      string   `json:"name"`      // the default agent name
	Model     string   `json:"model"`     // what it runs, for the picker
	Providers []string `json:"providers"` // keys it works with; the first is its vendor's own
}

// Examples is the picker's list. demo is left out: it writes the reference app by hand, so it would top every
// ranking without an agent behind it.
var Examples = []Example{
	{Slug: "claude-code", Name: "Claude Code · Opus 5.5", Model: "Claude Opus 5.5", Providers: []string{"anthropic", "orcarouter", "claude-sub"}},
	{Slug: "codex", Name: "Codex · GPT-6.1 Sol", Model: "GPT-6.1 Sol", Providers: []string{"openai", "orcarouter", "chatgpt-sub"}},
	{Slug: "gemini-cli", Name: "Gemini CLI · Gemini 3.8 Flash", Model: "Gemini 3.8 Flash", Providers: []string{"google", "orcarouter"}},
	{Slug: "kimi-code", Name: "Kimi Code · Kimi K3", Model: "Kimi K3", Providers: []string{"orcarouter"}},
	{Slug: "opencode", Name: "OpenCode · DeepSeek V4.1 Flash", Model: "DeepSeek V4.1 Flash (free)", Providers: []string{"orcarouter"}},
}

// exampleBundle returns the example's run.sh, or invalid input when the slug is unknown or the key is the wrong kind.
func exampleBundle(slug, provider string) ([]byte, error) {
	i := slices.IndexFunc(Examples, func(e Example) bool { return e.Slug == slug })
	if i < 0 {
		return nil, invalid("Unknown example agent")
	}
	if !slices.Contains(Examples[i].Providers, provider) {
		return nil, invalid("This agent doesn't work with that kind of key")
	}
	return exampleFiles.ReadFile("examples/" + slug + "/run.sh")
}
