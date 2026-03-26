import * as github from '@actions/github'
import * as core from '@actions/core'

export class GithubApi {
  octokit: ReturnType<typeof github.getOctokit>
  private requestCount: number = 0
  private token: string

  constructor(token: string) {
    this.token = token
    core.debug('Initializing GitHub API client')
    this.octokit = github.getOctokit(token)
  }

  private logRequest(method: string, params?: any): void {
    this.requestCount++
    core.debug(`[API Request #${this.requestCount}] ${method}`)
  }

  async getOrgMembers(organization: string): Promise<string[]> {
    this.logRequest('getOrgMembers', { organization })
    core.info(`Fetching members for organization: ${organization}`)
    
    const members: string[] = []
    let page = 1
    
    try {
      while (true) {
        const result = await this.octokit.rest.orgs.listMembers({
          org: organization,
          per_page: 100,
          page
        })
        
        members.push(...result.data.map(m => m.login))
        
        if (result.data.length < 100) break
        page++
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          throw new Error(`Organization "${organization}" not found or token lacks access`)
        }
        if (error.message.includes('401')) {
          throw new Error('Invalid token or token expired')
        }
      }
      throw error
    }
    
    core.info(`Found ${members.length} members in organization`)
    return members
  }

  async getOrgRepos(organization: string): Promise<{
    name: string,
    owner: string,
    default_branch: string,
    private: boolean
  }[]> {
    this.logRequest('getOrgRepos', { organization })
    core.info(`Fetching repositories for organization: ${organization}`)
    
    const repos: any[] = []
    let page = 1
    
    try {
      while (true) {
        const result = await this.octokit.rest.repos.listForOrg({
          org: organization,
          per_page: 100,
          page,
          type: 'all'
        })
        
        repos.push(...result.data)
        
        if (result.data.length < 100) break
        page++
        
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          throw new Error(`Organization "${organization}" not found or token lacks access`)
        }
      }
      throw error
    }
    
    const repoList = repos.map(repo => ({
      name: repo.name,
      owner: repo.owner.login,
      default_branch: repo.default_branch,
      private: repo.private
    }))
    
    const privateCount = repoList.filter(r => r.private).length
    core.info(`Found ${repoList.length} repositories (${privateCount} private, ${repoList.length - privateCount} public)`)
    return repoList
  }

  async getRepoCommits(
    owner: string, 
    repo: string, 
    since: string, 
    until: string
  ): Promise<{ 
    sha: string, 
    commit: { 
      author: { date: string, name: string, email: string } 
    }, 
    author?: { login?: string }
  }[]> {
    this.logRequest('getRepoCommits', { owner, repo, since, until })
    
    const commits: any[] = []
    let page = 1
    
    try {
      while (true) {
        const result = await this.octokit.rest.repos.listCommits({
          owner,
          repo,
          since,
          until,
          per_page: 100,
          page
        })
        
        commits.push(...result.data)
        
        if (result.data.length < 100) break
        page++
        
        // Delay to avoid secondary rate limits
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('409')) {
          core.warning(`Repository ${owner}/${repo} is empty, skipping...`)
          return []
        }
        if (error.message.includes('404')) {
          core.warning(`Repository ${owner}/${repo} not found or no access, skipping...`)
          return []
        }
        if (error.message.includes('403')) {
          core.warning(`Access denied to ${owner}/${repo} (check token permissions), skipping...`)
          return []
        }
      }
      throw error
    }
    
    return commits
  }

  async getRateLimit(): Promise<{ remaining: number, limit: number, reset: Date }> {
    const { data } = await this.octokit.rest.rateLimit.get()
    return {
      remaining: data.resources.core.remaining,
      limit: data.resources.core.limit,
      reset: new Date(data.rate.reset * 1000)
    }
  }
}