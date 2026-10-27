package runs

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"tolerance/internal/pricing"
	"tolerance/internal/tasks"
)

// ScoringVersion is the version of Score and of how verify.py judges a check; bump it when either changes so that old
// scores no longer compare (it is part of ChecksVersion, so runs scored the old way leave the rankings). A verify.py
// change that can't flip a check (logs, screenshots, refactoring) needs no bump. 2: browser scenarios, and a build
// task's score is half the API and page checks, half the browser checks.
const ScoringVersion = 2

// Manifest is what a run was set up with, fixed when it is created and never rewritten: changing the agent's key or
// provider later doesn't change how a past run reads or what the gateway lets it call. No secrets: it is public.
type Manifest struct {
	BundleHash string `json:"bundle_sha256"`
	Provider   string `json:"provider"`
	Model      string `json:"model,omitempty"`    // pricing.Models slug; "" for an uploaded agent
	ModelID    string `json:"model_id,omitempty"` // MODEL the agent gets: the model's id at this provider
	// KeyRotation is what a key change does to the run while it builds: "same_provider" = a new key of the same
	// provider is used from the next request on; a key of another provider is refused.
	KeyRotation    string `json:"key_rotation"`
	TaskMDHash     string `json:"task_md_sha256"`
	DataHash       string `json:"data_sha256"`
	ChecksHash     string `json:"checks_sha256"`   // the task's check spec
	VerifierHash   string `json:"verifier_sha256"` // verify.py
	ScoringVersion int    `json:"scoring_version"`
	// ChecksVersion is the checks, verify.py and scoring together: what the rankings compare (checksVersion).
	ChecksVersion string `json:"checks_version"`
	// Runtime is set once, when the agent's container is created (the worker, not the api, has the image).
	Runtime *Runtime `json:"runtime,omitempty"`
}

// Runtime is the sandbox image the agent ran in.
type Runtime struct {
	Image    string            `json:"image"`              // image id (sha256:…)
	Versions map[string]string `json:"versions,omitempty"` // CLI and tool versions from the image's arena.versions label
}

func sha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

var verifierHash = sha(verifyPy) // recorded in each manifest, not in checksVersion

// checksVerifier stands where verify.py's hash was in checksVersion: the hash of the verify.py every run was scored
// with when the file left the formula, so those runs kept their version. Every byte of verify.py used to unrank all
// runs; now ScoringVersion does that on purpose.
const checksVerifier = "1e67a9d1c8a15d9990808d1aa67760beae764513ad3728ecfbb18a9647ed7de4"

// checksVersion is a short hash of what turns an app into a score: the task's check spec (public and hidden) and the
// scoring version. Runs with different versions aren't ranked together.
func checksVersion(t *tasks.Task) string {
	return sha(fmt.Appendf(nil, "%s\x00%s\x00%d", t.ChecksHash, checksVerifier, ScoringVersion))[:12]
}

// newManifest is the manifest of a new run of an agent (provider, model, bundle hash) at task t.
func newManifest(t *tasks.Task, provider, model, bundleHash string) Manifest {
	m := Manifest{
		BundleHash: bundleHash, Provider: provider, Model: model, KeyRotation: "same_provider",
		TaskMDHash: t.TaskMDHash, DataHash: t.DataHash, ChecksHash: t.ChecksHash, VerifierHash: verifierHash,
		ScoringVersion: ScoringVersion, ChecksVersion: checksVersion(t),
	}
	if pm := pricing.BySlug(model); pm != nil {
		m.ModelID = pm.IDs[provider]
	}
	return m
}
