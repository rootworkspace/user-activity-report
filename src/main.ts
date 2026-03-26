import * as core from '@actions/core'
import * as fs from 'fs'
import { createDailyReport } from './report'

async function run(): Promise<void> {
  try {
    console.log('=== GitHub Activity Report Generator ===')
    console.log(`Started at: ${new Date().toISOString()}`)

    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    console.log(`Generating report for organization: ${organization}`)

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 31)

    console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (last 31 days)`)

    const analyzeOptions = {
      commits: true,
      commitsOnAllBranches: true,
      issues: true,
      issueComments: true,
      pullRequests: true,
      pullRequestComments: true,
      discussions: true,
      discussionComments: true
    }

    console.log('Analysis options:')
    console.log(`  - Commits: ${analyzeOptions.commits} (all branches: ${analyzeOptions.commitsOnAllBranches})`)
    console.log(`  - Issues: ${analyzeOptions.issues}`)
    console.log(`  - Issue comments: ${analyzeOptions.issueComments}`)
    console.log(`  - Pull Requests: ${analyzeOptions.pullRequests}`)
    console.log(`  - PR comments: ${analyzeOptions.pullRequestComments}`)
    console.log(`  - Discussions: ${analyzeOptions.discussions}`)
    console.log(`  - Discussion comments: ${analyzeOptions.discussionComments}`)

    console.log('\nStarting report generation...')
    const report = await createDailyReport(
      token,
      organization,
      startDate,
      endDate,
      analyzeOptions
    )

    console.log('\nSaving report to file...')
    fs.writeFileSync('report.json', JSON.stringify(report, null, 2), { encoding: 'utf-8' })

    console.log('✅ Report has been saved to report.json')
    console.log(`Report size: ${(fs.statSync('report.json').size / 1024).toFixed(2)} KB`)
    console.log(`Completed at: ${new Date().toISOString()}`)

  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`)
      core.setFailed(error.message)
    }
  }
}

run()