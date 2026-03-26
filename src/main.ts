import * as core from '@actions/core'
import * as fs from 'fs'
import { GithubApi } from './github'

interface DailyCommitCount {
  [date: string]: number
}

interface CommitRecord {
  date: string
  author: string
  repo: string
  sha: string
}

async function run(): Promise<void> {
  try {
    console.log('=== GitHub Organization Activity Report ===\n')

    // Get inputs
    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    // Date range (last 365 days)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 365)

    console.log(`Organization: ${organization}`)
    console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`)

    // Initialize API
    const api = new GithubApi(token)

    // Check rate limit
    const initialRateLimit = await api.getRateLimit()
    console.log(`Initial rate limit: ${initialRateLimit.remaining}/${initialRateLimit.limit}`)
    console.log(`Rate limit resets at: ${initialRateLimit.reset.toLocaleString()}\n`)

    // Verify token has access to org by fetching members
    console.log('Verifying token access...')
    const members = await api.getOrgMembers(organization)
    const memberSet = new Set(members.map(m => m.toLowerCase()))
    console.log(`✓ Found ${members.length} members\n`)

    // Get all repos
    console.log('Fetching repositories...')
    const repos = await api.getOrgRepos(organization)
    console.log(`✓ Found ${repos.length} repositories to analyze\n`)

    // Prepare date strings
    const since = startDate.toISOString()
    const until = endDate.toISOString()

    // Storage
    const allCommits: CommitRecord[] = []
    const dailyTotals: DailyCommitCount = {}
    const repoCommitCounts: { [repo: string]: number } = {}
    const authorCommitCounts: { [author: string]: number } = {}

    let processedRepos = 0
    let totalCommits = 0

    // Process each repo
    for (const repo of repos) {
      processedRepos++
      const repoLabel = `${repo.owner}/${repo.name}${repo.private ? ' (private)' : ''}`
      console.log(`\n[${processedRepos}/${repos.length}] Processing ${repoLabel}...`)

      try {
        // Get commits for this repo
        const commits = await api.getRepoCommits(repo.owner, repo.name, since, until)

        if (commits.length === 0) {
          console.log(`  No commits in date range`)
          continue
        }

        console.log(`  Found ${commits.length} total commits`)

        // Filter and process commits from members
        let memberCommits = 0

        for (const commit of commits) {
          // Try to get author from GitHub user first, fallback to commit author
          let authorName = commit.author?.login
          let authorEmail = commit.commit.author.email

          if (!authorName) {
            authorName = commit.commit.author.name
          }

          // Check if author is a member (by username or email)
          const isMember = memberSet.has(authorName?.toLowerCase() || '') ||
            members.some(m => authorEmail?.toLowerCase().includes(m.toLowerCase()))

          if (isMember && authorName) {
            const commitDate = new Date(commit.commit.author.date)
            const dateStr = commitDate.toISOString().split('T')[0]

            memberCommits++
            totalCommits++

            // Store commit record
            allCommits.push({
              date: dateStr,
              author: authorName,
              repo: repo.name,
              sha: commit.sha.substring(0, 7)
            })

            // Update daily totals
            dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + 1

            // Update repo counts
            repoCommitCounts[repo.name] = (repoCommitCounts[repo.name] || 0) + 1

            // Update author counts
            authorCommitCounts[authorName] = (authorCommitCounts[authorName] || 0) + 1
          }
        }

        console.log(`  ✓ Member commits: ${memberCommits}`)

      } catch (error) {
        console.error(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Fill in missing dates
    const currentDate = new Date(startDate)
    const filledDailyTotals: DailyCommitCount = {}
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      filledDailyTotals[dateStr] = dailyTotals[dateStr] || 0
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Display results
    console.log('\n' + '='.repeat(60))
    console.log('📊 COMMIT ACTIVITY REPORT')
    console.log('='.repeat(60))

    console.log('\n📈 Daily Commit Activity:')
    const sortedDates = Object.keys(filledDailyTotals).sort()

    // Show last 30 days
    const last30Days = sortedDates.slice(-30)
    console.log('\n  Last 30 days:')
    for (const date of last30Days) {
      const count = filledDailyTotals[date]
      const bar = '█'.repeat(Math.min(Math.floor(count / 5), 50))
      console.log(`    ${date}: ${count.toString().padStart(3)} commits ${bar}`)
    }

    // Summary statistics
    const daysWithActivity = Object.values(filledDailyTotals).filter(v => v > 0).length
    const totalDays = sortedDates.length
    const avgCommitsPerDay = totalCommits / totalDays

    console.log('\n📊 Summary:')
    console.log(`  Total commits: ${totalCommits}`)
    console.log(`  Days with activity: ${daysWithActivity}/${totalDays}`)
    console.log(`  Average commits/day: ${avgCommitsPerDay.toFixed(2)}`)

    if (totalCommits > 0) {
      const maxDay = Object.entries(filledDailyTotals).sort((a, b) => b[1] - a[1])[0]
      console.log(`  Most active day: ${maxDay[0]} (${maxDay[1]} commits)`)
    }

    // Top repositories
    const sortedRepos = Object.entries(repoCommitCounts).sort((a, b) => b[1] - a[1])
    console.log('\n📚 Top Repositories:')
    for (const [repo, count] of sortedRepos.slice(0, 10)) {
      const percentage = ((count / totalCommits) * 100).toFixed(1)
      console.log(`  ${repo}: ${count} commits (${percentage}%)`)
    }

    // Top authors
    const sortedAuthors = Object.entries(authorCommitCounts).sort((a, b) => b[1] - a[1])
    console.log('\n👥 Top Contributors:')
    for (const [author, count] of sortedAuthors.slice(0, 10)) {
      const percentage = ((count / totalCommits) * 100).toFixed(1)
      console.log(`  ${author}: ${count} commits (${percentage}%)`)
    }

    // Save JSON report
    const report = {
      metadata: {
        organization,
        token_used: token.substring(0, 10) + '...',
        date_range: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        },
        total_days: totalDays,
        members_count: members.length,
        repos_analyzed: repos.length,
        generated_at: new Date().toISOString()
      },
      summary: {
        total_commits: totalCommits,
        active_days: daysWithActivity,
        average_commits_per_day: avgCommitsPerDay,
        most_active_day: totalCommits > 0 ? {
          date: Object.entries(filledDailyTotals).sort((a, b) => b[1] - a[1])[0][0],
          count: Object.entries(filledDailyTotals).sort((a, b) => b[1] - a[1])[0][1]
        } : null
      },
      daily_activity: filledDailyTotals,
      repositories: repoCommitCounts,
      contributors: authorCommitCounts,
      recent_commits: allCommits.slice(0, 500) // Last 500 commits for reference
    }

    fs.writeFileSync('activity-report.json', JSON.stringify(report, null, 2))
    console.log('\n✅ Detailed report saved to activity-report.json')

    // Set output for GitHub Actions
    core.setOutput('total_commits', totalCommits.toString())
    core.setOutput('active_days', daysWithActivity.toString())
    core.setOutput('report_path', 'activity-report.json')

    // Final rate limit check
    const finalRateLimit = await api.getRateLimit()
    const usedRequests = initialRateLimit.limit - finalRateLimit.remaining
    console.log(`\n📊 API Usage: ${usedRequests} requests used (${((usedRequests / initialRateLimit.limit) * 100).toFixed(1)}%)`)

  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`)
      core.setFailed(error.message)
    } else {
      core.setFailed('Unknown error occurred')
    }
  }
}

run()