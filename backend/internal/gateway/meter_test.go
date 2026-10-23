package gateway

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"
)

const sseUsage = "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1200,\"output_tokens\":30}}}\n\n"

// A client asking for a compressed stream must still be metered: the gateway drops its Accept-Encoding, so the
// upstream's gzip (negotiated by Go's transport) comes back decoded and readable.
func TestMeteringSurvivesClientCompression(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		enc := r.Header.Get("Accept-Encoding")
		switch {
		case strings.Contains(enc, "zstd"):
			w.Header().Set("Content-Encoding", "zstd") // what the client asked for: unreadable to the gateway
			_, _ = io.WriteString(w, "\x28\xb5\x2f\xfd garbage")
		case strings.Contains(enc, "gzip"):
			w.Header().Set("Content-Encoding", "gzip")
			zw := gzip.NewWriter(w)
			_, _ = io.WriteString(zw, sseUsage)
			_ = zw.Close()
		default:
			_, _ = io.WriteString(w, sseUsage)
		}
	}))
	defer up.Close()
	target, _ := url.Parse(up.URL)
	meter := &usage{}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			plainResponses(pr.Out.Header)
		},
		ModifyResponse: meterResponse(meter),
	}
	front := httptest.NewServer(proxy)
	defer front.Close()

	req, _ := http.NewRequest("POST", front.URL+"/responses", strings.NewReader("{}"))
	req.Header.Set("Accept-Encoding", "zstd, br, gzip")
	resp, err := http.DefaultTransport.RoundTrip(req) // a raw client: no transparent decoding on this side
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "response.completed") {
		t.Fatalf("client got %q (encoding %q)", body, resp.Header.Get("Content-Encoding"))
	}
	if !meter.seen || meter.in != 1200 || meter.out != 30 {
		t.Errorf("metered in=%d out=%d seen=%v", meter.in, meter.out, meter.seen)
	}
}

// An upstream that answers encoded anyway is refused rather than passed through unmetered.
func TestEncodedResponseRefused(t *testing.T) {
	resp := &http.Response{StatusCode: 200, Header: http.Header{"Content-Encoding": {"br"}}, Body: io.NopCloser(strings.NewReader("x"))}
	if meterResponse(&usage{})(resp) == nil {
		t.Error("an encoded response must be refused")
	}
}

// A WebSocket upgrade would tunnel past the metering: refused before anything else.
func TestWebSocketRefused(t *testing.T) {
	g := &Gateway{}
	for _, p := range []string{"openai", "chatgpt", "anthropic", "gemini"} {
		req := httptest.NewRequest("GET", "/"+p+"/v1/responses", nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		rr := httptest.NewRecorder()
		g.llm(rr, req, p)
		if rr.Code != http.StatusUpgradeRequired {
			t.Errorf("%s: got %d", p, rr.Code)
		}
	}
}

// chatgpt.com streams events without a Content-Type: they must still be read as a stream and metered.
func TestStreamWithoutContentType(t *testing.T) {
	meter := &usage{}
	resp := &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(sseUsage))}
	if err := meterResponse(meter)(resp); err != nil {
		t.Fatal(err)
	}
	_, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if !meter.seen || meter.in != 1200 || meter.out != 30 {
		t.Errorf("metered in=%d out=%d seen=%v", meter.in, meter.out, meter.seen)
	}
}
