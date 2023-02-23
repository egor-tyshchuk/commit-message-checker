import * as github from "@actions/github";
import * as core from "@actions/core";
// eslint-disable-next-line import/named
import { GetResponseDataTypeFromEndpointMethod } from "@octokit/types";

// See https://docs.github.com/en/rest/reactions#reaction-types
const REACTIONS = [
  "+1",
  "-1",
  "laugh",
  "confused",
  "heart",
  "hooray",
  "rocket",
  "eyes",
] as const;
type Reaction = (typeof REACTIONS)[number];

export class GithubMessage {
  private github_token: string = core.getInput("accessToken");
  private octokit = github.getOctokit(this.github_token);
  private context = github.context;
  private issue_number =
    this.context.payload.pull_request?.number ||
    this.context.payload.issue?.number;
  private comment_tag = "execution";
  private comment_tag_pattern = `<!-- thollander/actions-comment-pull-request "${this.comment_tag}" -->`;

  async postMessage(
    message: string,
    reactions: string,
    mode: "upsert" | "recreate"
  ): Promise<void> {
    try {
      if (!message) {
        core.setFailed('"message" should be provided');
        return;
      }

      const content: string = message;

      if (!this.issue_number) {
        core.setFailed(
          "No issue/pull request in input neither in current context."
        );
        return;
      }

      const body = this.comment_tag_pattern
        ? `${content}\n${this.comment_tag_pattern}`
        : content;

      if (this.comment_tag_pattern) {
        const comment = await this.findComment();

        if (comment) {
          if (mode === "upsert") {
            await this.octokit.rest.issues.updateComment({
              ...this.context.repo,
              comment_id: comment.id,
              body,
            });
            await this.addReactions(comment.id, reactions);
            return;
          } else if (mode === "recreate") {
            await this.octokit.rest.issues.deleteComment({
              ...this.context.repo,
              comment_id: comment.id,
            });

            const { data: newComment } =
              await this.octokit.rest.issues.createComment({
                ...this.context.repo,
                issue_number: this.issue_number,
                body,
              });

            await this.addReactions(newComment.id, reactions);
            return;
          } else {
            core.setFailed(
              `Mode ${mode} is unknown. Please use 'upsert' or 'recreate'.`
            );
            return;
          }
        } else {
          core.info(
            "No comment has been found with asked pattern. Creating a new comment."
          );
        }
      }

      const { data: comment } = await this.octokit.rest.issues.createComment({
        ...this.context.repo,
        issue_number: this.issue_number,
        body,
      });

      await this.addReactions(comment.id, reactions);
    } catch (error) {
      if (error instanceof Error) {
        core.setFailed(error.message);
      }
    }
  }

  private async addReactions(
    comment_id: number,
    reactions: string
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const validReactions = <Reaction[]>reactions
      .replace(/\s/g, "")
      .split(",")
      .filter((reaction) => REACTIONS.includes(reaction as Reaction));

    await Promise.allSettled(
      validReactions.map(async (content) => {
        await this.octokit.rest.reactions.createForIssueComment({
          ...this.context.repo,
          comment_id,
          content,
        });
      })
    );
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private async findComment() {
    if (!this.issue_number) {
      core.setFailed(
        "No issue/pull request in input neither in current context."
      );
      return;
    }

    const listComments = this.octokit.rest.issues.listComments;
    type ListCommentsResponseDataType = GetResponseDataTypeFromEndpointMethod<
      typeof listComments
    >;
    let comment: ListCommentsResponseDataType[0] | undefined;
    for await (const { data: comments } of this.octokit.paginate.iterator(
      listComments,
      {
        ...this.context.repo,
        issue_number: this.issue_number,
      }
    )) {
      comment = comments.find((nextComment) =>
        nextComment?.body?.includes(this.comment_tag_pattern)
      );
      if (comment) break;
    }

    return comment;
  }

  async deleteMessage(): Promise<void> {
    const comment = await this.findComment();
    if (comment) {
      await this.octokit.rest.issues.deleteComment({
        ...this.context.repo,
        comment_id: comment.id,
      });
    }
  }
}
