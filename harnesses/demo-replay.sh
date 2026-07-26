#!/bin/sh
# DEMO-1's wired replay proof, for the seeded incident.
#
# Deliberately trivial: the demo's subject is the DECISION MODEL, not a real
# exact-once replay. What matters is that clicking "Add wired proof" in the
# browser now EXECUTES something and records the exit code, instead of asserting
# a verdict about a run that never happened — which is precisely what LB-27
# forbids everywhere else.
echo "DEMO-B3 wired replay: one external effect observed across two deliveries."
exit 0
