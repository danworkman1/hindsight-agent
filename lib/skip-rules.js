export const REVIEW_CAP = 3;

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const WIP_PATTERN = /\bwip\b/i;
const NO_REVIEW_TAG = /\[no-review\]/i;

export function shouldSkip({ branch, commitMessage, reviewCount }) {
  if (branch && PROTECTED_BRANCHES.has(branch)) {
    return { skip: true, reason: `protected branch: ${branch}` };
  }

  if (commitMessage && NO_REVIEW_TAG.test(commitMessage)) {
    return { skip: true, reason: "[no-review] tag in commit message" };
  }

  if (commitMessage && WIP_PATTERN.test(commitMessage)) {
    return { skip: true, reason: "wip commit" };
  }

  if (typeof reviewCount === "number" && reviewCount >= REVIEW_CAP) {
    return {
      skip: true,
      reason: `branch review cap reached (${reviewCount}/${REVIEW_CAP}) — run manually to force another review`,
    };
  }

  return { skip: false, reason: "" };
}
