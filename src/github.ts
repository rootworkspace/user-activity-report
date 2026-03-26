import * as github from '@actions/github'
import { paginateGraphql } from '@octokit/plugin-paginate-graphql'
import * as core from '@actions/core'

const IS_GITHUB_COM = process.env['GITHUB_API_URL'] === 'https://api.github.com'

export class GithubApi {
  octokit: ReturnType<typeof github.getOctokit> & ReturnType<typeof paginateGraphql>
  private requestCount: number = 0

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
      rateLimit?: { // rate limit might be disabled on GHES
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
    hasIssuesEnabled: boolean
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
      ...e.repository,
      hasDiscussionsEnabled: e.repository.hasDiscussionsEnabled || false
    }))
    core.info(`Found ${repos.length} repositories in organization`)
    return repos
  }

  async getRepoBranches(repoId: string): Promise<{ id: string, name: string }[]> {
    this.logRequest('getRepoBranches', { repoId: repoId.substring(0, 8) + '...' })
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
    core.debug(`Found ${branches.length} branches`)
    return branches
  }

  async getRepoDefaultBranch(repoId: string): Promise<{ id: string, name: string }> {
    this.logRequest('getRepoDefaultBranch', { repoId: repoId.substring(0, 8) + '...' })
    const result = await this.octokit.graphql<{
      node: {
        defaultBranchRef: {
          id: string
          name: string
        }
      }
    }>(
      `query paginate($repoId: ID!) {
        node(id: $repoId) {
          ... on Repository {
            defaultBranchRef {
              id
              name
            }
          }
        }
      }`,
      {
        repoId
      }
    )
    const branch = result.node.defaultBranchRef
    core.debug(`Default branch: ${branch.name}`)
    return branch
  }

  async getBranchCommits(branchId: string, since: string, until: string): Promise<{
    author?: string
    oid: string
  }[]> {
    this.logRequest('getBranchCommits', { branchId: branchId.substring(0, 8) + '...', since, until })
    const result = await this.octokit.graphql.paginate<{
      node: {
        target: {
          history: {
            nodes: {
              oid: string // = git commit hash
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
                    ... on Commit {
                      oid
                      author {
                        user {
                          login
                        }
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
    const commits = result.node.target.history.nodes.map(n => ({
      author: n.author.user?.login,
      oid: n.oid
    }))
    core.debug(`Found ${commits.length} commits in date range`)
    return commits
  }

  async getRepoIssues(repoId: string, since: string): Promise<{ id: string, number: number, author?: string, createdAt: string }[]> {
    this.logRequest('getRepoIssues', { repoId: repoId.substring(0, 8) + '...', since })
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
      `query paginate($cursor: String, $repoId: ID!, $since: DateTime) {
        node(id: $repoId) {
          ... on Repository {
            issues(first: 100, filterBy: {since: $since}, after: $cursor) {
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
        repoId,
        since
      }
    )
    const issues = result.node.issues.nodes.map(n => ({ id: n.id, number: n.number, author: n.author?.login, createdAt: n.createdAt }))
    core.debug(`Found ${issues.length} issues since ${since}`)
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
    const comments = result.node.comments.nodes.map(n => ({ createdAt: n.createdAt, author: n.author?.login }))
    core.debug(`Found ${comments.length} comments`)
    return comments
  }

  async getRepoPullRequests(repoId: string): Promise<{ id: string, number: number, author?: string, createdAt: string, updatedAt: string, mergedBy?: string, mergedAt?: string }[]> {
    this.logRequest('getRepoPullRequests', { repoId: repoId.substring(0, 8) + '...' })
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
      id: n.id, author: n.author?.login, number: n.number, createdAt: n.createdAt, updatedAt: n.updatedAt, mergedAt: n.mergedAt, mergedBy: n.mergedBy?.login
    }))
    core.debug(`Found ${prs.length} pull requests`)
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
    const comments = result.node.comments.nodes.map(n => ({ author: n.author?.login, createdAt: n.createdAt }))
    core.debug(`Found ${comments.length} PR comments`)
    return comments
  }

  async getRepoDiscussions(repoId: string): Promise<{ id: string, number: number, author?: string, createdAt: string, updatedAt: string }[]> {
    this.logRequest('getRepoDiscussions', { repoId: repoId.substring(0, 8) + '...' })
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
    const discussions = result.node.discussions.nodes.map(n => ({ id: n.id, number: n.number, author: n.author?.login, createdAt: n.createdAt, updatedAt: n.updatedAt }))
    core.debug(`Found ${discussions.length} discussions`)
    return discussions
  }

  async getDiscussionComments(prId: string): Promise<{ author?: string, createdAt: string }[]> {
    this.logRequest('getDiscussionComments', { discussionId: prId.substring(0, 8) + '...' })
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
        prId
      }
    )
    const comments = result.node.comments.nodes.map(n => ({ author: n.author?.login, createdAt: n.createdAt }))
    core.debug(`Found ${comments.length} discussion comments`)
    return comments
  }
}