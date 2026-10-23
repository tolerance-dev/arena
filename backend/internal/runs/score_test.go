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
		judged  bool
		want    *int
	}{
		{"app did not start", pass, false, nil, true, ptr(0)},
		{"checks only, no judge.md", half, true, &Judge{Status: "off"}, false, ptr(50)},
		{"30% checks + 70% judge", pass, true, ok, true, ptr(58)},
		// A page that shows the seed data passes every check; without a verdict it must not rank.
		{"judge skipped: no score", pass, true, &Judge{Status: "skipped"}, true, nil},
		{"judge error: no score", pass, true, &Judge{Status: "error"}, true, nil},
		{"no judge result: no score", pass, true, nil, true, nil},
	}
	for _, c := range cases {
		got := Score(c.checks, c.started, c.judge, c.judged)
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
