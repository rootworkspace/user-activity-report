import * as github from '@actions/github'
import { paginateGraphql } from '@octokit/plugin-paginate-graphql'
import * as core from '@actions/core'

const IS_GITHUB_COM = process.env['GITHUB_API_URL'] === 'https://api.github.com'

export class GithubApi {
  octokit: ReturnType<typeof github.getOctokit> & ReturnType<typeof paginateGraphql>
  private requestCount: number = 0
  private commitCache: Map<string, Map<string, Map<string, { author?: string, oid: string }[]>>> = new Map() // repoId -> (date -> branchName -> commits)
  private issueCache: Map<string, any[]> = new Map() // repoId -> issues
  private prCache: Map<string, any[]> = new Map() // repoId -> PRs
  private discussionCache: Map<string, any[]> = new Map() // repoId -> discussions
  private branchCache: Map<string, { id: string, name: string }[]> = new Map() // repoId -> branches

  constructor(token: string) {
    core.debug('Initializing GitHub API client')
    this.octokit = github.getOctokit(token, { baseUrl: process.env['GITHUB_API_URL'] }, paginateGraphql) as typeof this.octokit
  }

  private logRequest(method: string, params?: any): void {
    this.requestCount++
    core.debug(`[API Request #${this.requestCount}] ${method}`)
  }

  async getRateLimitRemaining(): Promise<number> {
    this.logRequest('getRateLimitRemaining')
    const result = await this.octokit.graphql<{
      rateLimit?: {
        remaining: number
      }
    }>(
      `query {
        rateLimit {
          remaining
        }
      }`
    )
    const remaining = result.rateLimit?.remaining || 5000
    core.debug(`Rate limit remaining: ${remaining}`)
    return remaining
  }

  async getOrgMembers(organization: string): Promise<string[]> {
    this.logRequest('getOrgMembers', { organization })
    core.info(`Fetching members for organization: ${organization}`)
    const result = await this.octokit.graphql.paginate<{
      organization: {
        membersWithRole: {
          nodes: {
            login: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $organization: String!) {
        organization(login: $organization) {
          membersWithRole(first: 100, after: $cursor) {
            nodes {
              login
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      {
        organization
      }
    )
    const members = result.organization.membersWithRole.nodes.map(n => n.login)
    core.info(`Found ${members.length} members in organization`)
    return members
  }

  async getOrgRepos(organization: string): Promise<{
    id: string,
    name: string,
    hasDiscussionsEnabled: boolean,
    hasIssuesEnabled: boolean,
    defaultBranchId?: string
  }[]> {
    this.logRequest('getOrgRepos', { organization })
    core.info(`Fetching repositories for organization: ${organization}`)
    const result = await this.octokit.graphql.paginate<{
      organization: {
        repositories: {
          edges: {
            repository: {
              id: string
              name: string
              hasDiscussionsEnabled?: boolean
              hasIssuesEnabled: boolean
              defaultBranchRef?: {
                name: string
                id: string
              }
            }
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $organization: String!) {
        organization(login: $organization) {
          repositories(first: 100, after: $cursor) {
            edges {
              repository:node {
                id
                name
                ${IS_GITHUB_COM ? 'hasDiscussionsEnabled' : ''}
                hasIssuesEnabled
                defaultBranchRef {
                  name
                  id
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      {
        organization
      }
    )
    const repos = result.organization.repositories.edges.map(e => ({
      id: e.repository.id,
      name: e.repository.name,
      hasDiscussionsEnabled: e.repository.hasDiscussionsEnabled || false,
      hasIssuesEnabled: e.repository.hasIssuesEnabled,
      defaultBranchId: e.repository.defaultBranchRef?.id
    }))
    core.info(`Found ${repos.length} repositories in organization`)
    return repos
  }

  async getAllRepoBranches(repoId: string): Promise<{ id: string, name: string }[]> {
    if (this.branchCache.has(repoId)) {
      return this.branchCache.get(repoId)!
    }

    this.logRequest('getAllRepoBranches', { repoId: repoId.substring(0, 8) + '...' })
    const result = await this.octokit.graphql.paginate<{
      node: {
        refs: {
          nodes: {
            id: string
            name: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $repoId: ID!) {
        node(id: $repoId) {
          ... on Repository {
            refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
              nodes {
                id
                name
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        repoId
      }
    )
    const branches = result.node.refs.nodes
    this.branchCache.set(repoId, branches)
    return branches
  }

  async getCommitsForRepo(repoId: string, startDate: string, endDate: string): Promise<Map<string, { author?: string, oid: string }[]>> {
    const cacheKey = `${startDate}|${endDate}`

    if (!this.commitCache.has(repoId)) {
      this.commitCache.set(repoId, new Map())
    }

    const repoCache = this.commitCache.get(repoId)!
    if (repoCache.has(cacheKey)) {
      core.debug(`Using cached commits for repo ${repoId.substring(0, 8)}...`)
      return repoCache.get(cacheKey)!
    }

    this.logRequest('getCommitsForRepo', { repoId: repoId.substring(0, 8) + '...' })

    // Get all branches first
    const branches = await this.getAllRepoBranches(repoId)

    // Get commits for all branches in parallel
    const commitPromises = branches.map(branch =>
      this.getBranchCommits(branch.id, startDate, endDate)
    )

    const commitsPerBranch = await Promise.all(commitPromises)
    const branchCommits = new Map<string, { author?: string, oid: string }[]>()

    branches.forEach((branch, index) => {
      branchCommits.set(branch.name, commitsPerBranch[index])
    })

    repoCache.set(cacheKey, branchCommits)
    return branchCommits
  }

  async getBranchCommits(branchId: string, since: string, until: string): Promise<{
    author?: string
    oid: string
  }[]> {
    const result = await this.octokit.graphql.paginate<{
      node: {
        target: {
          history: {
            nodes: {
              oid: string
              author: {
                user?: {
                  login: string
                }
              }
            }[]
          }
        }
      }
    }>(
      `query paginate($cursor: String, $branchId: ID!, $since: GitTimestamp!, $until: GitTimestamp!) {
        node(id: $branchId) {
          ... on Ref {
            target {
              ... on Commit {
                history(first: 100, since: $since, until: $until, after: $cursor) {
                  nodes {
                    oid
                    author {
                      user {
                        login
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          }
        }
      }`,
      {
        branchId,
        since,
        until
      }
    )
    return result.node.target.history.nodes.map(n => ({
      author: n.author.user?.login,
      oid: n.oid
    }))
  }

  async getAllRepoIssues(repoId: string): Promise<{ id: string, number: number, author?: string, createdAt: string }[]> {
    if (this.issueCache.has(repoId)) {
      return this.issueCache.get(repoId)!
    }

    this.logRequest('getAllRepoIssues', { repoId: repoId.substring(0, 8) + '...' })

    const result = await this.octokit.graphql.paginate<{
      node: {
        issues: {
          nodes: {
            id: string
            number: number,
            author?: {
              login: string
            }
            createdAt: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $repoId: ID!) {
        node(id: $repoId) {
          ... on Repository {
            issues(first: 100, after: $cursor) {
              nodes {
                id
                number
                author {
                  login
                }
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        repoId
      }
    )

    const issues = result.node.issues.nodes.map(n => ({
      id: n.id,
      number: n.number,
      author: n.author?.login,
      createdAt: n.createdAt
    }))

    this.issueCache.set(repoId, issues)
    return issues
  }

  async getIssueComments(issueId: string): Promise<{ createdAt: string, author?: string }[]> {
    this.logRequest('getIssueComments', { issueId: issueId.substring(0, 8) + '...' })
    const result = await this.octokit.graphql.paginate<{
      node: {
        comments: {
          nodes: {
            createdAt: string
            author?: {
              login: string
            }
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $issueId: ID!) {
        node(id: $issueId) {
          ... on Issue {
            comments(first: 100, after: $cursor) {
              nodes {
                createdAt
                author {
                  login
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        issueId
      }
    )
    return result.node.comments.nodes.map(n => ({ createdAt: n.createdAt, author: n.author?.login }))
  }

  async getAllRepoPullRequests(repoId: string): Promise<{ id: string, number: number, author?: string, createdAt: string, updatedAt: string, mergedBy?: string, mergedAt?: string }[]> {
    if (this.prCache.has(repoId)) {
      return this.prCache.get(repoId)!
    }

    this.logRequest('getAllRepoPullRequests', { repoId: repoId.substring(0, 8) + '...' })

    const result = await this.octokit.graphql.paginate<{
      node: {
        pullRequests: {
          nodes: {
            id: string
            number: number
            author?: {
              login: string
            }
            createdAt: string
            updatedAt: string
            mergedBy?: {
              login: string
            }
            mergedAt?: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $repoId: ID!) {
        node(id: $repoId) {
          ... on Repository {
            pullRequests(first: 100, after: $cursor) {
              nodes {
                id
                number
                author {
                  login
                }
                createdAt
                mergedBy {
                  login
                }
                mergedAt
                updatedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        repoId
      }
    )

    const prs = result.node.pullRequests.nodes.map(n => ({
      id: n.id,
      author: n.author?.login,
      number: n.number,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      mergedAt: n.mergedAt,
      mergedBy: n.mergedBy?.login
    }))

    this.prCache.set(repoId, prs)
    return prs
  }

  async getRepoPullComments(prId: string): Promise<{ author?: string, createdAt: string }[]> {
    this.logRequest('getRepoPullComments', { prId: prId.substring(0, 8) + '...' })
    const result = await this.octokit.graphql.paginate<{
      node: {
        comments: {
          nodes: {
            author?: {
              login: string
            }
            createdAt: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $prId: ID!) {
        node(id: $prId) {
          ... on PullRequest {
            comments(first: 100, after: $cursor) {
              nodes {
                author {
                  login
                }
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        prId
      }
    )
    return result.node.comments.nodes.map(n => ({ author: n.author?.login, createdAt: n.createdAt }))
  }

  async getAllRepoDiscussions(repoId: string): Promise<{ id: string, number: number, author?: string, createdAt: string, updatedAt: string }[]> {
    if (this.discussionCache.has(repoId)) {
      return this.discussionCache.get(repoId)!
    }

    this.logRequest('getAllRepoDiscussions', { repoId: repoId.substring(0, 8) + '...' })

    const result = await this.octokit.graphql.paginate<{
      node: {
        discussions: {
          nodes: {
            id: string
            number: number
            author?: {
              login: string
            }
            createdAt: string
            updatedAt: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $repoId: ID!) {
        node(id: $repoId) {
          ... on Repository {
            discussions(first: 100, after: $cursor) {
              nodes {
                id
                number
                author {
                  login
                }
                createdAt
                updatedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        repoId
      }
    )

    const discussions = result.node.discussions.nodes.map(n => ({
      id: n.id,
      number: n.number,
      author: n.author?.login,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt
    }))

    this.discussionCache.set(repoId, discussions)
    return discussions
  }

  async getDiscussionComments(discussionId: string): Promise<{ author?: string, createdAt: string }[]> {
    this.logRequest('getDiscussionComments', { discussionId: discussionId.substring(0, 8) + '...' })
    const result = await this.octokit.graphql.paginate<{
      node: {
        comments: {
          nodes: {
            author?: {
              login: string
            }
            createdAt: string
          }[]
        }
      }
    }>(
      `query paginate($cursor: String, $discussionId: ID!) {
        node(id: $discussionId) {
          ... on Discussion {
            comments(first: 100, after: $cursor) {
              nodes {
                author {
                  login
                }
                createdAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }`,
      {
        discussionId
      }
    )
    return result.node.comments.nodes.map(n => ({ author: n.author?.login, createdAt: n.createdAt }))
  }
}