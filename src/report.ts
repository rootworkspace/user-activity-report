import * as core from '@actions/core'
import { GithubApi } from './github'
import { AnalyzeOptions, DailyReportData } from './reportData'

export async function createDailyReport(token: string, organization: string, startDate: Date, endDate: Date, analyzeOptions: AnalyzeOptions): Promise<DailyReportData> {
  console.log('\n=== Processing Activity Data ===')

  console.log('Initializing GitHub API client...')
  const api = new GithubApi(token)
  const dailyReport = new DailyReportData(organization, analyzeOptions)

  console.log('Checking rate limit...')
  const rateLimitStart = await api.getRateLimitRemaining()
  console.log(`Starting rate limit: ${rateLimitStart}`)

  console.log('\nBuilding date range...')
  const dateRange: Date[] = []
  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    dateRange.push(new Date(currentDate))
    currentDate.setDate(currentDate.getDate() + 1)
  }
  console.log(`Processing ${dateRange.length} days (${dateRange[0].toISOString().split('T')[0]} to ${dateRange[dateRange.length - 1].toISOString().split('T')[0]})`)

  console.log('\nFetching organization members...')
  const orgMembers = await api.getOrgMembers(organization)
  for (const member of orgMembers) {
    dailyReport.setOrgMember(member)
  }
  console.log(`Loaded ${orgMembers.length} organization members`)

  console.log('\nFetching organization repositories...')
  const repos = await api.getOrgRepos(organization)
  console.log(`Found ${repos.length} repositories to analyze`)

  let totalCommits = 0
  let totalIssues = 0
  let totalPRs = 0
  let totalDiscussions = 0

  for (let i = 0; i < dateRange.length - 1; i++) {
    const dayStart = dateRange[i]
    const dayEnd = new Date(dateRange[i + 1])
    const dayString = dayStart.toISOString().split('T')[0]

    console.log(`\n📅 Processing day ${i + 1}/${dateRange.length - 1}: ${dayString}`)

    let dayCommits = 0
    let dayIssues = 0
    let dayPRs = 0
    let dayDiscussions = 0

    for (const repo of repos) {
      process.stdout.write(`  Analyzing repository: ${repo.name}... `)

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
            dayCommits++
          }
        }
      }

      if (analyzeOptions.issues && repo.hasIssuesEnabled) {
        const issues = await api.getRepoIssues(repo.id, dayStart.toISOString())
        for (const issue of issues) {
          const createdAt = new Date(issue.createdAt)
          if (issue.author && createdAt >= dayStart && createdAt < dayEnd) {
            dailyReport.addCreatedIssue(issue.author, dayString)
            dayIssues++
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
            dayPRs++
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
            dayDiscussions++
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

      process.stdout.write(`✓\n`)
    }

    totalCommits += dayCommits
    totalIssues += dayIssues
    totalPRs += dayPRs
    totalDiscussions += dayDiscussions

    console.log(`  Day summary: ${dayCommits} commits, ${dayIssues} issues, ${dayPRs} PRs, ${dayDiscussions} discussions`)
  }

  console.log('\n=== Processing Complete ===')
  console.log(`Total activity across all days:`)
  console.log(`  - Commits: ${totalCommits}`)
  console.log(`  - Issues created: ${totalIssues}`)
  console.log(`  - Pull Requests created: ${totalPRs}`)
  console.log(`  - Discussions created: ${totalDiscussions}`)

  const rateLimitEnd = await api.getRateLimitRemaining()
  const rateLimitCost = rateLimitStart - rateLimitEnd
  console.log(`\nGraphQL API usage:`)
  console.log(`  - Rate limit start: ${rateLimitStart}`)
  console.log(`  - Rate limit end: ${rateLimitEnd}`)
  console.log(`  - Total requests cost: ${rateLimitCost}`)
  console.log(`  - Average cost per day: ${(rateLimitCost / (dateRange.length - 1)).toFixed(1)}`)

  return dailyReport
}