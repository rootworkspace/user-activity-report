import * as core from '@actions/core'
import { GithubApi } from './github'

async function run(): Promise<void> {
  try {
    console.log('=== GitHub Activity Report Generator ===\n')

    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 31)

    console.log(`Organization: ${organization}`)
    console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (last 31 days)\n`)

    console.log('Initializing GitHub API...')
    const api = new GithubApi(token)

    console.log('Fetching organization members...')
    const members = await api.getOrgMembers(organization)
    const memberSet = new Set(members)
    console.log(`✓ Found ${members.length} members\n`)

    console.log('Fetching organization repositories...')
    const repos = await api.getOrgRepos(organization)
    console.log(`✓ Found ${repos.length} repositories to analyze\n`)

    // Build date range
    const dateRange: Date[] = []
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      dateRange.push(new Date(currentDate))
      currentDate.setDate(currentDate.getDate() + 1)
    }
    const totalDays = dateRange.length - 1
    console.log(`Processing ${totalDays} days...\n`)

    const dailyTotals: { [date: string]: number } = {}

    // Process each day
    for (let i = 0; i < totalDays; i++) {
      const dayStart = dateRange[i]
      const dayEnd = new Date(dateRange[i + 1])
      const dayString = dayStart.toISOString().split('T')[0]

      console.log(`📅 Day ${i + 1}/${totalDays}: ${dayString}`)

      let total = 0
      let repoCount = 0
      let activeRepos = 0

      for (const repo of repos) {
        repoCount++
        process.stdout.write(`  [${repoCount}/${repos.length}] Analyzing... `)

        let repoActivity = 0

        // Commits
        const branches = await api.getAllRepoBranches(repo.id)
        const uniqueCommits = new Set<string>()
        for (const branch of branches) {
          const commits = await api.getBranchCommits(branch.id, dayStart.toISOString(), dayEnd.toISOString())
          for (const commit of commits) {
            if (commit.author && memberSet.has(commit.author) && !uniqueCommits.has(commit.oid)) {
              uniqueCommits.add(commit.oid)
              total++
              repoActivity++
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
              repoActivity++
            }

            // Issue comments
            const comments = await api.getIssueComments(issue.id)
            for (const comment of comments) {
              const commentDate = new Date(comment.createdAt)
              if (comment.author && memberSet.has(comment.author) && commentDate >= dayStart && commentDate < dayEnd) {
                total++
                repoActivity++
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
            repoActivity++
          }

          // PR comments
          const comments = await api.getRepoPullComments(pr.id)
          for (const comment of comments) {
            const commentDate = new Date(comment.createdAt)
            if (comment.author && memberSet.has(comment.author) && commentDate >= dayStart && commentDate < dayEnd) {
              total++
              repoActivity++
            }
          }
        }

        if (repoActivity > 0) {
          process.stdout.write(`✓ (${repoActivity})\n`)
          activeRepos++
        } else {
          process.stdout.write(`-\n`)
        }
      }

      dailyTotals[dayString] = total
      console.log(`  📊 ${total} total contributions from ${activeRepos}/${repos.length} active repos\n`)
    }

    console.log('=== Complete ===')
    console.log(`Generated report for ${totalDays} days across ${repos.length} repositories`)
    console.log(`Total contributions across all days: ${Object.values(dailyTotals).reduce((a, b) => a + b, 0)}`)
    console.log('\nOutput:')
    console.log(JSON.stringify(dailyTotals, null, 2))

  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`)
      core.setFailed(error.message)
    }
  }
}

run()