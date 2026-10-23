package runs

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"path"
	"sort"
	"strings"
)

// skipDirs are dependency, build and cache folders: left out of the line count, the source download and the copy the
// judge reads, wherever they are in the tree. The top-level data/ (the seed data) is left out too.
var skipDirs = map[string]bool{"node_modules": true, ".git": true, ".next": true, ".nuxt": true, ".svelte-kit": true,
	".turbo": true, ".cache": true, ".npm": true, "__pycache__": true, ".venv": true, "venv": true, ".pytest_cache": true,
	"dist": true, "build": true, "out": true, "coverage": true}

var skipFiles = []string{"*.db", "*.sqlite", "*.sqlite3", "*.log", "*.map"}

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
	maxSources    = 50 << 20 // what readSources keeps in memory at most
)

// workspace is what readSources found in /work.
type workspace struct {
	files    map[string][]byte // source files by path relative to /work
	topLevel map[string]bool   // every top-level name, whatever its type (start.sh may be a symlink)
}

func skipped(name string) bool {
	parts := strings.Split(name, "/")
	if parts[0] == "data" && len(parts) > 1 {
		return true
	}
	for _, p := range parts[:len(parts)-1] {
		if skipDirs[p] {
			return true
		}
	}
	base := parts[len(parts)-1]
	for _, g := range skipFiles {
		if ok, _ := path.Match(g, base); ok {
			return true
		}
	}
	return base == "TASK.md" && len(parts) == 1
}

// readSources reads the source files out of a docker cp tar stream of /work (entries start with "work/").
func readSources(r io.Reader) (workspace, error) {
	ws := workspace{files: map[string][]byte{}, topLevel: map[string]bool{}}
	var total int
	tr := tar.NewReader(r)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return ws, nil
		}
		if err != nil {
			return ws, err
		}
		name := strings.TrimPrefix(path.Clean("/"+h.Name), "/")
		_, name, _ = strings.Cut(name, "/") // drop the "work/" root
		if name == "" {
			continue
		}
		if !strings.Contains(name, "/") {
			ws.topLevel[name] = true
		}
		if h.Typeflag != tar.TypeReg || h.Size > maxSourceFile || skipped(name) || total+int(h.Size) > maxSources {
			continue
		}
		body, err := io.ReadAll(tr)
		if err != nil {
			return ws, err
		}
		total += len(body)
		ws.files[name] = body
	}
}

// sourceStats counts lines of code per language and zips the sources.
func sourceStats(files map[string][]byte) (Stats, []byte, error) {
	st := Stats{Languages: map[string]int{}}
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	var zbuf bytes.Buffer
	zw := zip.NewWriter(&zbuf)
	for _, name := range names {
		body := files[name]
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
