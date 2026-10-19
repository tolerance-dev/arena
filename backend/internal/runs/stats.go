package runs

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"path"
	"strings"
)

// sourceExcludes are left out of both the line count and the source download (tar --exclude patterns).
var sourceExcludes = []string{"node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".npm",
	"__pycache__", ".venv", "venv", ".pytest_cache", "dist", "build", "out", "coverage", "./data", "*.db", "*.sqlite",
	"*.sqlite3", "*.log", "*.map"}

// SourceTarCmd is the command that streams the agent's source out of its snapshot image.
func SourceTarCmd() []string {
	cmd := []string{"tar", "-C", "/work", "-c"}
	for _, e := range sourceExcludes {
		cmd = append(cmd, "--exclude="+e)
	}
	return append(cmd, ".")
}

var languages = map[string]string{
	".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
	".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript",
	".py": "Python", ".go": "Go", ".rb": "Ruby", ".php": "PHP", ".java": "Java", ".kt": "Kotlin", ".rs": "Rust",
	".cs": "C#", ".html": "HTML", ".htm": "HTML", ".css": "CSS", ".scss": "CSS", ".sass": "CSS", ".less": "CSS",
	".vue": "Vue", ".svelte": "Svelte", ".sql": "SQL", ".sh": "Shell",
}

const (
	maxSourceFile = 1 << 20  // bigger files are generated or vendored: not counted, not zipped
	maxSourceZip  = 20 << 20 // the download stops growing past this
)

// sourceStats counts lines of code per language in a tar of the workspace and zips the sources.
func sourceStats(tarball []byte) (Stats, []byte, error) {
	st := Stats{Languages: map[string]int{}}
	var zbuf bytes.Buffer
	zw := zip.NewWriter(&zbuf)
	tr := tar.NewReader(bytes.NewReader(tarball))
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return st, nil, err
		}
		if h.Typeflag != tar.TypeReg || h.Size > maxSourceFile {
			continue
		}
		name := strings.TrimPrefix(path.Clean("/"+h.Name), "/")
		if name == "" || name == "TASK.md" {
			continue
		}
		body, err := io.ReadAll(tr)
		if err != nil {
			return st, nil, err
		}
		base := path.Base(name)
		lang := languages[strings.ToLower(path.Ext(name))]
		if lang != "" && !strings.Contains(base, ".min.") && !bytes.Contains(body[:min(len(body), 8000)], []byte{0}) {
			n := 0
			for _, line := range bytes.Split(body, []byte("\n")) {
				if len(bytes.TrimSpace(line)) > 0 {
					n++
				}
			}
			st.LOC += n
			st.Files++
			st.Languages[lang] += n
		}
		if zbuf.Len() < maxSourceZip {
			w, err := zw.Create(name)
			if err != nil {
				return st, nil, err
			}
			if _, err := w.Write(body); err != nil {
				return st, nil, err
			}
		}
	}
	if err := zw.Close(); err != nil {
		return st, nil, err
	}
	return st, zbuf.Bytes(), nil
}
