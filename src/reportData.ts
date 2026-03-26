export type UserActivity = {
    commits: number
    createdIssues: number
    issueComments: number
    createdPrs: number
    mergedPrs: number
    prComments: number
    createdDiscussions: number
    discussionComments: number
}

export type DailyUserData = {
    [username: string]: UserActivity
}

export type DailyReport = {
    [date: string]: DailyUserData
}

export type AnalyzeOptions = {
    commits: boolean
    commitsOnAllBranches: boolean
    issues: boolean
    issueComments: boolean
    pullRequests: boolean
    pullRequestComments: boolean
    discussions: boolean
    discussionComments: boolean
}

export class DailyReportData {
    private report: DailyReport = {}
    private orgMembers: Set<string> = new Set()

    constructor(private organization: string, private analyzeOptions?: AnalyzeOptions) { }

    getOrCreateUserData(date: string, userName: string): UserActivity {
        if (!this.report[date]) {
            this.report[date] = {}
        }

        if (!this.report[date][userName]) {
            this.report[date][userName] = {
                commits: 0,
                createdIssues: 0,
                issueComments: 0,
                createdPrs: 0,
                mergedPrs: 0,
                prComments: 0,
                createdDiscussions: 0,
                discussionComments: 0
            }
        }

        return this.report[date][userName]
    }

    setOrgMember(userName: string): void {
        this.orgMembers.add(userName)
    }

    addCommit(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).commits++
    }

    addCreatedIssue(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).createdIssues++
    }

    addIssueComment(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).issueComments++
    }

    addCreatedPr(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).createdPrs++
    }

    addMergedPr(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).mergedPrs++
    }

    addPrComment(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).prComments++
    }

    addCreatedDiscussion(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).createdDiscussions++
    }

    addDiscussionComment(userName: string, date: string): void {
        this.getOrCreateUserData(date, userName).discussionComments++
    }

    toJSON(): string {
        const output: any = {
            organization: this.organization,
            dateRange: {
                start: Object.keys(this.report)[0],
                end: Object.keys(this.report)[Object.keys(this.report).length - 1]
            },
            orgMembers: Array.from(this.orgMembers),
            dailyActivity: this.report
        }
        return JSON.stringify(output, null, 2)
    }
}