package runs

import "testing"

func TestScore(t *testing.T) {
	pass := []Check{{Passed: true}, {Passed: true}, {Passed: true}}
	some := []Check{{Passed: true}, {Passed: false}, {Passed: false}}
	cases := []struct {
		name    string
		checks  []Check
		started bool
		want    int
	}{
		{"app did not start", pass, false, 0},
		{"all checks pass", pass, true, 100},
		{"a third of the checks pass", some, true, 33},
		{"no checks", nil, true, 0},
	}
	for _, c := range cases {
		if got := Score(c.checks, c.started); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
