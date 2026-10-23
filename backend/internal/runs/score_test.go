package runs

import "testing"

func TestScore(t *testing.T) {
	pass := []Check{{Passed: true}, {Passed: true}, {Passed: true}}
	half := []Check{{Passed: true}, {Passed: false}}
	ok := &Judge{Status: "ok", Score: 40}
	cases := []struct {
		name    string
		checks  []Check
		started bool
		judge   *Judge
		weight  float64
		want    *int
	}{
		{"app did not start", pass, false, nil, 0.7, ptr(0)},
		{"checks only, no judge.md", half, true, &Judge{Status: "off"}, 0, ptr(50)},
		{"30% checks + 70% judge", pass, true, ok, 0.7, ptr(58)},
		{"75% checks + 25% screens judge", half, true, ok, 0.25, ptr(48)},
		// A run without a verdict must not rank next to fully scored ones.
		{"judge skipped: no score", pass, true, &Judge{Status: "skipped"}, 0.7, nil},
		{"judge error: no score", pass, true, &Judge{Status: "error"}, 0.25, nil},
		{"no judge result: no score", pass, true, nil, 0.7, nil},
	}
	for _, c := range cases {
		got := Score(c.checks, c.started, c.judge, c.weight)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s: got %v, want %v", c.name, deref(got), deref(c.want))
		}
	}
}

func ptr(n int) *int { return &n }

func deref(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
