// Package sandbox drives disposable Docker containers through the docker CLI: the agent's build container, the
// check container and the preview containers. Files go in and out as tar streams (`docker cp -`), so the same code
// works when the caller itself runs in a container that only has the host's docker.sock.
package sandbox

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

// Network is the internal Docker network sandboxes join: no route out, only the gateway (alias "gateway") on it.
// ARENA_AGENTS_NETWORK renames it: local checkouts each get their own (the Makefile), since two gateways on one
// network would share the alias and answer each other's sandboxes.
var Network = func() string {
	if n := os.Getenv("ARENA_AGENTS_NETWORK"); n != "" {
		return n
	}
	return "arena-agents"
}()

// GatewayURL is how a sandbox reaches the gateway.
const GatewayURL = "http://gateway:8090"

// Image is the runtime every sandbox starts from (runtime/Dockerfile): Node, Python, Chromium, agent CLIs.
const Image = "arena-runtime:1"

type Spec struct {
	Name    string
	Image   string
	Network string // "" = none
	Env     []string
	Cmd     []string
	Workdir string
	Memory  string // e.g. "4g"
	CPUs    string
	Pids    int
	CapAdd  []string
	Labels  map[string]string
}

func (s Spec) createArgs() []string {
	network := s.Network
	if network == "" {
		network = "none"
	}
	mem, cpus, pids := s.Memory, s.CPUs, s.Pids
	if mem == "" {
		mem = "2g"
	}
	if cpus == "" {
		cpus = "1"
	}
	if pids == 0 {
		pids = 1024
	}
	args := []string{"create"}
	if s.Name != "" {
		args = append(args, "--name", s.Name)
	}
	args = append(args,
		"--network", network, "--memory", mem, "--memory-swap", mem, "--cpus", cpus, "--pids-limit", fmt.Sprint(pids),
		"--cap-drop=ALL", "--security-opt=no-new-privileges",
		"--tmpfs", "/tmp:rw,exec,size=1g",
		// Caps a single file's size everywhere (storage-opt size= works on few storage drivers).
		"--ulimit", "fsize=524288000",
		"--label", "arena.sandbox=1", "--label", "arena.stack="+Network)
	for _, c := range s.CapAdd {
		args = append(args, "--cap-add", c)
	}
	keys := make([]string, 0, len(s.Labels))
	for k := range s.Labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		args = append(args, "--label", k+"="+s.Labels[k])
	}
	for _, e := range s.Env {
		args = append(args, "-e", e)
	}
	if s.Workdir != "" {
		args = append(args, "-w", s.Workdir)
	}
	args = append(args, s.Image)
	return append(args, s.Cmd...)
}

func docker(ctx context.Context, stdin io.Reader, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdin = stdin
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	s := strings.TrimSpace(out.String())
	if err != nil {
		return s, fmt.Errorf("docker %s: %w: %s", args[0], err, tail(s, 2000))
	}
	return s, nil
}

// EnsureNetwork creates the internal sandbox network when it is missing.
func EnsureNetwork(ctx context.Context) error {
	if _, err := docker(ctx, nil, "network", "inspect", Network); err == nil {
		return nil
	}
	_, err := docker(ctx, nil, "network", "create", "--internal", Network)
	return err
}

// Create creates (but does not start) a container and returns its id.
func Create(ctx context.Context, s Spec) (string, error) {
	return docker(ctx, nil, s.createArgs()...)
}

// Remove force-removes a container, best effort.
func Remove(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = docker(ctx, nil, "rm", "-f", id)
}

func Kill(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = docker(ctx, nil, "kill", id)
}

// File is one file to copy into a container.
type File struct {
	Body []byte
	Mode int64 // 0 = 0644
}

// CopyIn writes files (paths relative to dest, slash-separated) into the container under dest. dirMode applies to
// the directories it creates (0 = 0755).
func CopyIn(ctx context.Context, id, dest string, files map[string]File, dirMode int64) error {
	if dirMode == 0 {
		dirMode = 0o755
	}
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	made := map[string]bool{}
	now := time.Now()
	for _, n := range names {
		parts := strings.Split(n, "/")
		for i := 1; i < len(parts); i++ {
			d := strings.Join(parts[:i], "/")
			if !made[d] {
				made[d] = true
				if err := tw.WriteHeader(&tar.Header{Name: d + "/", Typeflag: tar.TypeDir, Mode: dirMode, ModTime: now}); err != nil {
					return err
				}
			}
		}
		f := files[n]
		mode := f.Mode
		if mode == 0 {
			mode = 0o644
		}
		if err := tw.WriteHeader(&tar.Header{Name: n, Typeflag: tar.TypeReg, Mode: mode, Size: int64(len(f.Body)), ModTime: now}); err != nil {
			return err
		}
		if _, err := tw.Write(f.Body); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	// docker cp - extracts the tar into an existing directory; make sure dest exists by shipping it as the root.
	var wrapped bytes.Buffer
	if err := prefixTar(&wrapped, &buf, strings.TrimPrefix(dest, "/"), dirMode); err != nil {
		return err
	}
	_, err := docker(ctx, &wrapped, "cp", "-", id+":/")
	return err
}

// prefixTar re-roots a tar under prefix (creating prefix's directories).
func prefixTar(dst io.Writer, src io.Reader, prefix string, dirMode int64) error {
	tw := tar.NewWriter(dst)
	now := time.Now()
	parts := strings.Split(strings.Trim(prefix, "/"), "/")
	for i := 1; i <= len(parts); i++ {
		if err := tw.WriteHeader(&tar.Header{Name: strings.Join(parts[:i], "/") + "/", Typeflag: tar.TypeDir, Mode: dirMode, ModTime: now}); err != nil {
			return err
		}
	}
	tr := tar.NewReader(src)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		h.Name = strings.Trim(prefix, "/") + "/" + h.Name
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		if _, err := io.Copy(tw, tr); err != nil {
			return err
		}
	}
	return tw.Close()
}

// Result is how a container run ended.
type Result struct {
	ExitCode int
	TimedOut bool
	Killed   bool // stopped by the caller (budget, cancel)
	Output   string
}

// Start runs a created container to completion (attached), keeping the tail of its output in out (readable while
// it runs). It kills the container when timeout passes or stop is closed.
func Start(ctx context.Context, id string, timeout time.Duration, stop <-chan struct{}, out *Tail) (Result, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.Command("docker", "start", "-a", id)
	cmd.Stdout, cmd.Stderr = out, out
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("docker start: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var res Result
	select {
	case err := <-done:
		res = exitResult(err)
	case <-runCtx.Done():
		Kill(id)
		<-done
		res = Result{ExitCode: -1, TimedOut: errors.Is(runCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil}
		if ctx.Err() != nil {
			res.Killed = true
		}
	case <-stop:
		Kill(id)
		<-done
		res = Result{ExitCode: -1, Killed: true}
	}
	res.Output = out.String()
	if res.ExitCode == 125 && !res.TimedOut && !res.Killed {
		return res, fmt.Errorf("container failed to start: %s", tail(res.Output, 2000))
	}
	return res, nil
}

func exitResult(err error) Result {
	if err == nil {
		return Result{}
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return Result{ExitCode: ee.ExitCode()}
	}
	return Result{ExitCode: -1}
}

// Commit snapshots a stopped container into an image. changes are Dockerfile instructions (ENV, CMD).
func Commit(ctx context.Context, id, image string, changes ...string) error {
	args := []string{"commit", "--change", "LABEL arena.stack=" + Network}
	for _, c := range changes {
		args = append(args, "--change", c)
	}
	_, err := docker(ctx, nil, append(args, id, image)...)
	return err
}

// CopyOut reads a path out of a container as a tar (docker cp's format: the last path element is the root).
func CopyOut(ctx context.Context, id, path string, max int64) ([]byte, error) {
	var data []byte
	err := StreamOut(ctx, id, path, func(r io.Reader) error {
		var err error
		data, err = io.ReadAll(io.LimitReader(r, max+1))
		if err == nil && int64(len(data)) > max {
			err = fmt.Errorf("docker cp %s: more than %d bytes", path, max)
		}
		return err
	})
	return data, err
}

// StreamOut passes a path of a container to read as a tar stream (docker cp's format). docker cp reads the
// container's filesystem through the daemon, so nothing from the container's image runs: this is how the platform
// reads an agent's snapshot. The container doesn't have to be started.
func StreamOut(ctx context.Context, id, path string, read func(io.Reader) error) error {
	cmd := exec.CommandContext(ctx, "docker", "cp", id+":"+path, "-")
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	rerr := read(stdout)
	if rerr != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return rerr
	}
	_, _ = io.Copy(io.Discard, stdout)
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("docker cp %s: %w: %s", path, err, tail(errBuf.String(), 500))
	}
	return nil
}

// StartDetached starts a created container in the background.
func StartDetached(ctx context.Context, id string) error {
	_, err := docker(ctx, nil, "start", id)
	return err
}

// Running reports whether the named container exists and runs.
func Running(ctx context.Context, name string) bool {
	running, _, err := State(ctx, name)
	return err == nil && running
}

// State reports whether a container runs and, once it has stopped, its exit code.
func State(ctx context.Context, name string) (running bool, exitCode int, err error) {
	out, err := docker(ctx, nil, "inspect", "-f", "{{.State.Running}} {{.State.ExitCode}}", name)
	if err != nil {
		return false, 0, err
	}
	var r string
	_, err = fmt.Sscan(out, &r, &exitCode)
	return r == "true", exitCode, err
}

// Logs returns the tail (at most max bytes) of a container's output, best effort.
func Logs(ctx context.Context, id string, max int) string {
	out, _ := docker(ctx, nil, "logs", "--tail", "2000", id)
	return tail(out, max)
}

// AppPort is where an agent's app listens (RULES.md: start.sh serves on 0.0.0.0:$PORT).
const AppPort = "3000"

// AppSpec is the container that runs an agent's app from its snapshot: the same for the check and the live preview,
// so an app that passed the check also starts as a preview. It holds no secrets, so the app runs as the agent built
// it (root inside, no capabilities).
func AppSpec(name, image string, labels map[string]string) Spec {
	return Spec{
		Name: name, Image: image, Network: Network, Memory: "512m", CPUs: "1", Pids: 1024, Workdir: "/work", Labels: labels,
		Env: []string{"PORT=" + AppPort, "HOST=0.0.0.0", "NODE_ENV=production", "HOME=/tmp", "LANG=C.UTF-8",
			// The runtime image sets a 3 GB heap for the agent; in 512 MB node must collect sooner.
			"NODE_OPTIONS=--max-old-space-size=384", "ANTHROPIC_API_KEY=", "OPENAI_API_KEY="},
		Cmd: []string{"sh", "-c", "cd /work && exec sh start.sh"},
	}
}

// RemoveByLabel force-removes this stack's containers carrying label (k=v), best effort: leftovers of a crashed
// process. Only this stack's (arena.stack = its network): other checkouts share the Docker host.
func RemoveByLabel(ctx context.Context, label string) {
	out, err := docker(ctx, nil, "ps", "-aq", "--filter", "label="+label, "--filter", "label=arena.stack="+Network)
	if err != nil || out == "" {
		return
	}
	_, _ = docker(ctx, nil, append([]string{"rm", "-f"}, strings.Fields(out)...)...)
}

// Images lists this stack's local image references (repo:tag) of a repository.
func Images(ctx context.Context, repo string) ([]string, error) {
	out, err := docker(ctx, nil, "images", "--filter", "label=arena.stack="+Network, "--format", "{{.Repository}}:{{.Tag}}", repo)
	if err != nil {
		return nil, err
	}
	return strings.Fields(out), nil
}

// RemoveImage deletes an image, best effort.
func RemoveImage(image string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	_, _ = docker(ctx, nil, "rmi", "-f", image)
}

// ImageExists reports whether image is present locally.
func ImageExists(ctx context.Context, image string) bool {
	_, err := docker(ctx, nil, "image", "inspect", image)
	return err == nil
}

// Tail keeps the last Max bytes written to it; safe to read while a container writes.
type Tail struct {
	Max int
	mu  sync.Mutex
	buf []byte
}

func (w *Tail) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	if len(w.buf) > 2*w.Max {
		w.buf = append([]byte(nil), w.buf[len(w.buf)-w.Max:]...)
	}
	return len(p), nil
}

func (w *Tail) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return tail(string(w.buf), w.Max)
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
