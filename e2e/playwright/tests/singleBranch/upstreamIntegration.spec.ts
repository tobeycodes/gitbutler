import { expectCurrentBranchChip, openSingleBranchWorkspace } from "./helpers.ts";
import { assertBranch, assertCleanWorktree, assertCommitSubjects } from "../../src/branch.ts";
import { test } from "../../src/test.ts";
import {
	clickByTestId,
	commitRow,
	getByTestId,
	stack,
	waitForTestIdToNotExist,
} from "../../src/util.ts";
import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

const FULLY_INTEGRATED_BRANCH = "fully-integrated-branch";
const PARTIAL_STACK_BASE = "partial-stack-base";
const PARTIAL_STACK_TOP = "partial-stack-top";
const REBASED_SINGLE_BRANCH = "rebased-single-branch";

test.use({
	gitbutlerOptions: {
		config: {
			onboardingComplete: true,
			featureFlags: { singleBranch: true },
		},
	},
});

async function syncAndIntegrateWorkspace(page: Page) {
	await clickByTestId(page, "sync-button");
	await clickByTestId(page, "integrate-upstream-commits-button");
	await clickByTestId(page, "integrate-upstream-action-button");
}

async function expectBranchParentToBeOriginMaster(pathToRepo: string, branchName: string) {
	await expect
		.poll(() => git(pathToRepo, ["rev-parse", `${branchName}~2`]), {
			message: `Expected ${branchName} to be rebased onto origin/master`,
			intervals: [100, 200, 500, 1000],
		})
		.toBe(git(pathToRepo, ["rev-parse", "origin/master"]));
}

async function expectBranchFirstParentToBeOriginMaster(pathToRepo: string, branchName: string) {
	await expect
		.poll(() => git(pathToRepo, ["rev-parse", `${branchName}^`]), {
			message: `Expected ${branchName} to be parented to origin/master`,
			intervals: [100, 200, 500, 1000],
		})
		.toBe(git(pathToRepo, ["rev-parse", "origin/master"]));
}

function git(pathToRepo: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd: pathToRepo,
		encoding: "utf8",
	}).trim();
}

test("moves to the target branch after the checked-out branch is fully integrated", async ({
	page,
	gitbutler,
}) => {
	test.fail(
		true,
		"workspace integration currently removes the checked-out branch without retargeting HEAD to the target branch",
	);

	await gitbutler.runScript("project-in-single-branch-upstream-integration.sh", [
		"fully-integrated",
	]);
	await openSingleBranchWorkspace(page);

	const localClone = gitbutler.pathInWorkdir("local-clone");
	await assertBranch(FULLY_INTEGRATED_BRANCH, localClone);
	await expectCurrentBranchChip(page, FULLY_INTEGRATED_BRANCH);
	await expect(commitRow(page, "fully-integrated: second commit")).toBeVisible();

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", [FULLY_INTEGRATED_BRANCH]);
	await syncAndIntegrateWorkspace(page);

	await waitForTestIdToNotExist(page, "stack");
	await assertBranch("master", localClone);
	await expectCurrentBranchChip(page, "master");
	await assertCleanWorktree(localClone);
});

test("keeps the top branch when its lower stack segment is integrated", async ({
	page,
	gitbutler,
}) => {
	await gitbutler.runScript("project-in-single-branch-upstream-integration.sh", ["partial-stack"]);
	await openSingleBranchWorkspace(page);

	const localClone = gitbutler.pathInWorkdir("local-clone");
	await assertBranch(PARTIAL_STACK_TOP, localClone);
	await expect(stack(page)).toHaveCount(1);
	await expect(getByTestId(page, "branch-card")).toHaveCount(2);
	await expect(
		getByTestId(page, "branch-card").filter({ hasText: PARTIAL_STACK_BASE }),
	).toBeVisible();
	await expect(
		getByTestId(page, "branch-card").filter({ hasText: PARTIAL_STACK_TOP }),
	).toBeVisible();

	await gitbutler.runScript("merge-upstream-branch-to-base.sh", [PARTIAL_STACK_BASE]);
	await clickByTestId(page, "sync-button");
	await clickByTestId(page, "integrate-upstream-commits-button");

	const baseRow = page
		.locator(`[data-integration-row-branch-name="${PARTIAL_STACK_BASE}"]`)
		.first();
	await expect(baseRow.getByTestId("integrate-upstream-series-row-status-badge")).toHaveText(
		"Integrated",
	);

	await clickByTestId(page, "integrate-upstream-action-button");

	await expect(stack(page)).toHaveCount(1);
	await expect(getByTestId(page, "branch-card")).toHaveCount(1);
	await expect(getByTestId(page, "branch-card")).toContainText(PARTIAL_STACK_TOP);
	await expect(getByTestId(page, "branch-card")).not.toContainText(PARTIAL_STACK_BASE);
	await assertBranch(PARTIAL_STACK_TOP, localClone);
	await expectCurrentBranchChip(page, PARTIAL_STACK_TOP);
	await assertCommitSubjects(
		[
			"partial-stack-top: first commit",
			`Merging upstream branch ${PARTIAL_STACK_BASE} into base`,
		],
		localClone,
	);
	await expectBranchFirstParentToBeOriginMaster(localClone, PARTIAL_STACK_TOP);
	await assertCleanWorktree(localClone);
});

test("rebases the checked-out branch when the target advances", async ({ page, gitbutler }) => {
	await gitbutler.runScript("project-in-single-branch-upstream-integration.sh", ["rebase"]);
	await openSingleBranchWorkspace(page);

	const localClone = gitbutler.pathInWorkdir("local-clone");
	await assertBranch(REBASED_SINGLE_BRANCH, localClone);
	await expectCurrentBranchChip(page, REBASED_SINGLE_BRANCH);

	await gitbutler.runScript("project-with-remote-branches__add-commit-to-base.sh");
	await syncAndIntegrateWorkspace(page);

	await waitForTestIdToNotExist(page, "integrate-upstream-commits-button");
	await assertBranch(REBASED_SINGLE_BRANCH, localClone);
	await expectCurrentBranchChip(page, REBASED_SINGLE_BRANCH);
	await assertCommitSubjects(
		[
			"rebased-single-branch: second commit",
			"rebased-single-branch: first commit",
			"commit in base",
		],
		localClone,
	);
	await expectBranchParentToBeOriginMaster(localClone, REBASED_SINGLE_BRANCH);
	await assertCleanWorktree(localClone);
});
