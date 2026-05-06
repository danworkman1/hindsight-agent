export function formatPriorReviewForPrompt(prior) {
  if (!prior || !prior.verdict) return "";

  const lines = [
    "",
    "---",
    "PRIOR REVIEW ON THIS BRANCH",
    `Verdict: ${prior.verdict}`,
  ];

  if (prior.prose) {
    lines.push(`Reasoning: ${prior.prose}`);
  }

  if (Array.isArray(prior.suggestions) && prior.suggestions.length > 0) {
    lines.push("Prior suggestions:");
    for (const s of prior.suggestions) {
      lines.push(`  - ${s.file}${s.lines ? `:${s.lines}` : ""} — ${s.issue} (fix: ${s.fix})`);
    }
  }

  lines.push("");
  lines.push(
    "IMPORTANT: The prior review may have been wrong, or the code may have changed since. " +
      "Reassess independently. If you agree with the prior verdict and the diff is minor, " +
      "restate the prior conclusion. If you disagree, explain what changed your mind. " +
      "Do not relitigate points the prior review already addressed unless the new diff makes them relevant again."
  );

  return lines.join("\n");
}
