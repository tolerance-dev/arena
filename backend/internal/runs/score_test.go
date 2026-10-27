package runs

import "testing"

func TestScore(t *testing.T) {
	ok := func(name string) Check { return Check{Name: name, Passed: true} }
	bad := func(name string) Check { return Check{Name: name} }
	pass := []Check{ok("start"), ok("cart: add"), ok("orders: list")}
	some := []Check{ok("start"), bad("cart: add"), bad("orders: list")}
	b := BrowserPrefix
	cases := []struct {
		name    string
		checks  []Check
		started bool
		want    int
	}{
		{"app did not start", pass, false, 0},
		{"no browser checks: all pass", pass, true, 100},
		{"no browser checks: a third pass", some, true, 33},
		{"no checks", nil, true, 0},
		{"everything passes", append(pass, ok(b+"sign in"), ok(b+"sign out")), true, 100},
		{"API passes, the UI can't be clicked through", append(pass, bad(b+"sign in"), bad(b+"sign out")), true, 50},
		{"the UI passes, a third of the API", append(some, ok(b+"sign in"), ok(b+"sign out")), true, 67},
		{"half of each", []Check{ok("start"), bad("cart: add"), ok(b + "sign in"), bad(b + "sign out")}, true, 50},
		{"a quarter of the browser checks", append(pass, ok(b+"a"), bad(b+"b"), bad(b+"c"), bad(b+"d")), true, 63},
		{"a check named browser without the prefix is an API check", []Check{ok("browser"), bad(b + "x")}, true, 50},
		{"did not start, browser checks passed", append(pass, ok(b+"sign in")), false, 0},
	}
	for _, c := range cases {
		if got := Score(c.checks, c.started); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
