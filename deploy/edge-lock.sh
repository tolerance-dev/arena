#!/bin/sh
# Ports 80/443 of this host take only the relay on Selectel and Cloudflare (mentor.nualimov.dev is still proxied);
# everyone else reaches tolerance.cc through the relay (deploy/README.md). Run as root: `edge-lock.sh on|off`.
# tolerance-edge-lock.service runs `on` at boot. SSH and outgoing traffic are untouched.
#
# Caddy's ports are published by Docker, so the packets go through DOCKER-USER after DNAT, not INPUT: the rules
# match the port the client asked for (conntrack, original direction) on the public interface only, which leaves
# replies to the containers' own outgoing connections and traffic between containers alone.
set -eu

RELAY4="139.100.217.119"
# https://www.cloudflare.com/ips-v4, ips-v6 as of 2026-09-25 (the same list as the Caddyfile).
CF4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18
190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14
172.64.0.0/13 131.0.72.0/22"
CF6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

CHAIN=TOLERANCE-EDGE
IF=$(ip route show default | awk '{print $5; exit}')

unhook() { # $1 = iptables or ip6tables
  for port in 80 443; do
    while $1 -D DOCKER-USER -i "$IF" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$port" -j "$CHAIN" 2>/dev/null; do :; done
  done
  $1 -F "$CHAIN" 2>/dev/null || true
  $1 -X "$CHAIN" 2>/dev/null || true
}

lock() { # $1 = iptables or ip6tables, $2 = allowed sources
  unhook "$1"
  $1 -N DOCKER-USER 2>/dev/null || true
  $1 -N "$CHAIN"
  for src in $2; do $1 -A "$CHAIN" -s "$src" -j RETURN; done
  $1 -A "$CHAIN" -j DROP
  for port in 80 443; do
    $1 -I DOCKER-USER -i "$IF" -p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport "$port" -j "$CHAIN"
  done
}

case "${1:-on}" in
  on)
    lock iptables "$RELAY4 $CF4"
    lock ip6tables "$CF6"
    echo "80/443 on $IF: relay and Cloudflare only"
    ;;
  off)
    unhook iptables
    unhook ip6tables
    echo "80/443 open to everyone"
    ;;
  *) echo "usage: $0 on|off" >&2; exit 2 ;;
esac
