import { describe, expect, it } from 'vitest'
import { fetch, postJson } from './utils'

type CfRequestInit = RequestInit & { cf?: { country?: string } }

describe('/', () => {
  it('returns 200 for homepage request', async () => {
    const response = await fetch('/')
    expect(response.status).toBe(200)
  })

  it('redirects CriOS user agent to apple URL', async () => {
    const slug = `crios-apple-${crypto.randomUUID()}`
    const apple = 'https://apps.apple.com/app/sink-test'

    const createResponse = await postJson('/api/link/create', {
      url: 'https://example.com',
      slug,
      apple,
    })
    expect(createResponse.status).toBe(201)
    const createData = await createResponse.json() as { link: { apple?: string } }
    expect(createData.link.apple).toBe(apple)

    const response = await fetch(`/${slug}`, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/147 Version/11.1.1 Safari/605.1.15',
      },
    })

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(apple)
  })

  it('redirects to geo URL when cf.country matches', async () => {
    const slug = `geo-cn-${crypto.randomUUID()}`
    const cnUrl = 'https://cn.example.com/landing'

    const createResponse = await postJson('/api/link/create', {
      url: 'https://example.com/default',
      slug,
      geo: { CN: cnUrl },
    })
    expect(createResponse.status).toBe(201)

    const options: CfRequestInit = { redirect: 'manual', cf: { country: 'CN' } }
    const response = await fetch(`/${slug}`, options as RequestInit)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(cnUrl)
  })

  it('redirects to default URL when cf.country does not match', async () => {
    const slug = `geo-default-${crypto.randomUUID()}`
    const defaultUrl = 'https://example.com/default'

    const createResponse = await postJson('/api/link/create', {
      url: defaultUrl,
      slug,
      geo: { CN: 'https://cn.example.com/landing' },
    })
    expect(createResponse.status).toBe(201)

    const options: CfRequestInit = { redirect: 'manual', cf: { country: 'US' } }
    const response = await fetch(`/${slug}`, options as RequestInit)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(defaultUrl)
  })

  it('shows geo URL in unsafe warning', async () => {
    const slug = `unsafe-geo-${crypto.randomUUID()}`
    const cnUrl = 'https://cn.example.com/unsafe'

    const createResponse = await postJson('/api/link/create', {
      url: 'https://example.com/default',
      slug,
      unsafe: true,
      geo: { CN: cnUrl },
    })
    expect(createResponse.status).toBe(201)

    const options: CfRequestInit = { redirect: 'manual', cf: { country: 'CN' } }
    const response = await fetch(`/${slug}`, options as RequestInit)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(cnUrl)
  })

  it('prefers device redirect over geo redirect', async () => {
    const slug = `device-over-geo-${crypto.randomUUID()}`
    const apple = 'https://apps.apple.com/app/sink-test-priority'

    const createResponse = await postJson('/api/link/create', {
      url: 'https://example.com/default',
      slug,
      apple,
      geo: { CN: 'https://cn.example.com/landing' },
    })
    expect(createResponse.status).toBe(201)

    const options: CfRequestInit = {
      redirect: 'manual',
      cf: { country: 'CN' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/147 Version/11.1.1 Mobile/15E148 Safari/604.1',
      },
    }
    const response = await fetch(`/${slug}`, options as RequestInit)

    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(apple)
  })
})
