import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { JiraUserService } from "../services/users.js";

export interface JiraGetUserParams {
  accountId?: string;
  emailAddress?: string;
}

export async function handleJiraGetUser(
  params: unknown,
  _runCtx: ToolRunContext,
  userService: JiraUserService,
): Promise<ToolResult> {
  const { accountId, emailAddress } = params as JiraGetUserParams;

  if (!accountId && !emailAddress) {
    return { error: "Either accountId or emailAddress is required" };
  }

  try {
    if (accountId) {
      const user = await userService.getUser(accountId);
      return {
        content: `${user.displayName} (${user.emailAddress ?? "no email"})`,
        data: { user },
      };
    }

    const users = await userService.findUser(emailAddress!);
    if (users.length === 0) {
      return { content: `No user found for "${emailAddress}"`, data: { users: [] } };
    }

    const list = users.map((u) => `${u.displayName} (${u.accountId})`).join("\n");
    return {
      content: `Found ${users.length} user(s):\n${list}`,
      data: { users },
    };
  } catch (err) {
    return { error: `Failed to get user: ${(err as Error).message}` };
  }
}
