"""EC8A arithmetic consistency checks.

The form has hard arithmetic constraints that must hold for the result to
be internally consistent. Violations are surfaced as flags - the platform
does not silently "correct" extracted figures.

  sum(candidate_votes) == total_valid_votes
  total_valid_votes + rejected_ballots == total_votes_cast
  total_votes_cast <= accredited_voters
  accredited_voters <= registered_voters
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import ExtractedEC8A


@dataclass
class ArithmeticReport:
    consistent: bool
    failed_checks: list[str]


def arithmetic_consistent(e: ExtractedEC8A) -> ArithmeticReport:
    failures: list[str] = []

    if sum(e.candidate_votes.values()) != e.total_valid_votes:
        failures.append("candidate_votes_sum_neq_total_valid")

    if e.total_valid_votes + e.rejected_ballots != e.total_votes_cast:
        failures.append("valid_plus_rejected_neq_cast")

    if e.total_votes_cast > e.accredited_voters:
        failures.append("cast_exceeds_accredited")

    if e.accredited_voters > e.registered_voters:
        failures.append("accredited_exceeds_registered")

    return ArithmeticReport(consistent=not failures, failed_checks=failures)
