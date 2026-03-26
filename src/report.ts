import * as core from '@actions/core'
import { GithubApi } from './github'
import { AnalyzeOptions, DailyReportData } from './reportData'

export async function createDailyReport(token: string, organization: string, startDate: Date, endDate: Date, analyzeOptions: AnalyzeOptions): Promise<DailyReportData> {
  const api = new GithubApi(token)
  const dailyReport = new DailyReportData(organization, analyzeOptions)
  const rateLimitStart = await api.getRateLimitRemaining()

  const dateRange: Date[] = []
  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    dateRange.push(new Date(currentDate))
    currentDate.setDate(currentDate.getDate() + 1)
  }

  core.debug('Reading org members')
  const orgMembers = await api.getOrgMembers(organization)
  for (const member of orgMembers) {
    dailyReport.setOrgMember(member)
  }

  core.debug('Getting org repositories')
  const repos = await api.getOrgRepos(organization)

  for (let i = 0; i < dateRange.length - 1; i++) {
    const dayStart = dateRange[i]
    const dayEnd = new Date(dateRange[i + 1])
    const dayString = dayStart.toISOString().split('T')[0]

    core.debug(`Processing day: ${dayString}`)

    for (const repo of repos) {
      core.debug(`Analyzing repository: ${repo.name} for ${dayString}...`)

      if (analyzeOptions.commits) {
        const branches = (analyzeOptions.commitsOnAllBranches ? await api.getRepoBranches(repo.id) : [await api.getRepoDefaultBranch(repo.id)].filter(b => !!b))
        const uniqueCommits = new Map<string, Awaited<ReturnType<typeof api.getBranchCommits>>[0]>()
        for (const branch of branches) {
          const commits = await api.getBranchCommits(branch.id, dayStart.toISOString(), dayEnd.toISOString())
          for (const commit of commits) {
            uniqueCommits.set(commit.oid, commit)
          }
        }
        for (const commit of uniqueCommits.values()) {
          if (commit.author) {
            dailyReport.addCommit(commit.author, dayString)
          }
        }
      }

      if (analyzeOptions.issues && repo.hasIssuesEnabled) {
        const issues = await api.getRepoIssues(repo.id, dayStart.toISOString())
        for (const issue of issues) {
          const createdAt = new Date(issue.createdAt)
          if (issue.author && createdAt >= dayStart && createdAt < dayEnd) {
            dailyReport.addCreatedIssue(issue.author, dayString)
          }

          if (analyzeOptions.issueComments) {
            const issueComments = await api.getIssueComments(issue.id)
            for (const issueComment of issueComments) {
              const commentCreatedAt = new Date(issueComment.createdAt)
              if (issueComment.author && commentCreatedAt >= dayStart && commentCreatedAt < dayEnd) {
                dailyReport.addIssueComment(issueComment.author, dayString)
              }
            }
          }
        }
      }

      if (analyzeOptions.pullRequests) {
        const prs = await api.getRepoPullRequests(repo.id)
        for (const pr of prs) {
          const createdAt = new Date(pr.createdAt)
          if (pr.author && createdAt >= dayStart && createdAt < dayEnd) {
            dailyReport.addCreatedPr(pr.author, dayString)
          }
          if (pr.mergedAt && pr.mergedBy) {
            const mergedAt = new Date(pr.mergedAt)
            if (mergedAt >= dayStart && mergedAt < dayEnd) {
              dailyReport.addMergedPr(pr.mergedBy, dayString)
            }
          }

          if (analyzeOptions.pullRequestComments) {
            if (new Date(pr.updatedAt) >= dayStart) {
              const comments = await api.getRepoPullComments(pr.id)
              for (const comment of comments) {
                const commentCreatedAt = new Date(comment.createdAt)
                if (comment.author && commentCreatedAt >= dayStart && commentCreatedAt < dayEnd) {
                  dailyReport.addPrComment(comment.author, dayString)
                }
              }
            }
          }
        }
      }

      if (analyzeOptions.discussions && repo.hasDiscussionsEnabled) {
        const discussions = await api.getRepoDiscussions(repo.id)
        for (const discussion of discussions) {
          const createdAt = new Date(discussion.createdAt)
          if (discussion.author && createdAt >= dayStart && createdAt < dayEnd) {
            dailyReport.addCreatedDiscussion(discussion.author, dayString)
          }

          if (analyzeOptions.discussionComments) {
            if (new Date(discussion.updatedAt) >= dayStart) {
              const comments = await api.getDiscussionComments(discussion.id)
              for (const comment of comments) {
                const commentCreatedAt = new Date(comment.createdAt)
                if (comment.author && commentCreatedAt >= dayStart && commentCreatedAt < dayEnd) {
                  dailyReport.addDiscussionComment(comment.author, dayString)
                }
              }
            }
          }
        }
      }
    }
  }

  const rateLimitEnd = await api.getRateLimitRemaining()
  core.info(`GraphQL rate limit cost: ${rateLimitStart - rateLimitEnd}`)

  return dailyReport
}