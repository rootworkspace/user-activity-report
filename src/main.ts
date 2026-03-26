import * as core from '@actions/core'
import * as fs from 'fs'
import { createDailyReport } from './report'

async function run(): Promise<void> {
  try {
    const token = core.getInput('token', { required: true })
    const organization = core.getInput('organization', { required: true })

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 31)

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

    const report = await createDailyReport(
      token,
      organization,
      startDate,
      endDate,
      analyzeOptions
    )

    fs.writeFileSync('report.json', JSON.stringify(report, null, 2), { encoding: 'utf-8' })
    console.log('Report has been saved!')

  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()