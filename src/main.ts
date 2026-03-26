import * as core from '@actions/core'
import { GithubApi } from './github'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 31)

    const api = new GithubApi(token)

    // Get repos and members
    const repos = await api.getOrgRepos(organization)
    const members = await api.getOrgMembers(organization)
    const memberSet = new Set(members)

    // Build date range
    const dateRange: Date[] = []
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      dateRange.push(new Date(currentDate))
      currentDate.setDate(currentDate.getDate() + 1)
    }

    const dailyTotals: { [date: string]: number } = {}

    // Process each day
    for (let i = 0; i < dateRange.length - 1; i++) {
      const dayStart = dateRange[i]
      const dayEnd = new Date(dateRange[i + 1])
      const dayString = dayStart.toISOString().split('T')[0]

      let total = 0

      for (const repo of repos) {
        // Commits
        const branches = await api.getAllRepoBranches(repo.id)
        const uniqueCommits = new Set<string>()
        for (const branch of branches) {
          const commits = await api.getBranchCommits(branch.id, dayStart.toISOString(), dayEnd.toISOString())
          for (const commit of commits) {
            if (commit.author && memberSet.has(commit.author) && !uniqueCommits.has(commit.oid)) {
              uniqueCommits.add(commit.oid)
              total++
            }
          }
        }

        // Issues
        if (repo.hasIssuesEnabled) {
          const issues = await api.getAllRepoIssues(repo.id)
          for (const issue of issues) {
            const createdAt = new Date(issue.createdAt)
            if (issue.author && memberSet.has(issue.author) && createdAt >= dayStart && createdAt < dayEnd) {
              total++
            }

            // Issue comments
            const comments = await api.getIssueComments(issue.id)
            for (const comment of comments) {
              const commentDate = new Date(comment.createdAt)
              if (comment.author && memberSet.has(comment.author) && commentDate >= dayStart && commentDate < dayEnd) {
                total++
              }
            }
          }
        }

        // PRs
        const prs = await api.getAllRepoPullRequests(repo.id)
        for (const pr of prs) {
          const createdAt = new Date(pr.createdAt)
          if (pr.author && memberSet.has(pr.author) && createdAt >= dayStart && createdAt < dayEnd) {
            total++
          }

          // PR comments
          const comments = await api.getRepoPullComments(pr.id)
          for (const comment of comments) {
            const commentDate = new Date(comment.createdAt)
            if (comment.author && memberSet.has(comment.author) && commentDate >= dayStart && commentDate < dayEnd) {
              total++
            }
          }
        }
      }

      dailyTotals[dayString] = total
    }

    console.log(JSON.stringify(dailyTotals, null, 2))

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()