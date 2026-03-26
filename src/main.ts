import * as core from '@actions/core'
import * as fs from 'fs'
import { GithubApi } from './github'

interface DailyCommitCount {
  [date: string]: number
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 365)

    console.log(`Analyzing ${organization} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)

    const api = new GithubApi(token)

    // Get members
    const members = await api.getOrgMembers(organization)
    const memberSet = new Set(members.map(m => m.toLowerCase()))

    // Get repos
    const repos = await api.getOrgRepos(organization)
    console.log(`Found ${repos.length} repos, ${members.length} members`)

    const since = startDate.toISOString()
    const until = endDate.toISOString()

    const dailyTotals: DailyCommitCount = {}
    let totalCommits = 0

    // Process each repo
    for (const repo of repos) {
      try {
        const commits = await api.getRepoCommits(repo.owner, repo.name, since, until)

        for (const commit of commits) {
          let authorName = commit.author?.login || commit.commit.author.name
          let authorEmail = commit.commit.author.email

          const isMember = memberSet.has(authorName?.toLowerCase() || '') ||
            members.some(m => authorEmail?.toLowerCase().includes(m.toLowerCase()))

          if (isMember && authorName) {
            const dateStr = new Date(commit.commit.author.date).toISOString().split('T')[0]
            dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + 1
            totalCommits++
          }
        }
      } catch (error) {
        console.error(`Error processing ${repo.name}: ${error}`)
      }
    }

    // Fill in missing dates
    const currentDate = new Date(startDate)
    const completeDailyTotals: DailyCommitCount = {}
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      completeDailyTotals[dateStr] = dailyTotals[dateStr] || 0
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Create JSON output
    const output = {
      organization,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      total_days: 365,
      total_commits: totalCommits,
      daily_commits: completeDailyTotals
    }

    // Save to file
    const outputFile = 'report.json'
    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2))

    console.log(`Done. Total commits: ${totalCommits}`)
    console.log(`Report saved to ${outputFile}`)

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('Unknown error occurred')
    }
  }
}

run()