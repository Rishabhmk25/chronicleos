// Shared domain types for ChronicleOS dashboard

export interface Page {
  id: number
  url: string
  title: string
  timestamp: number
  domain: string
}

export interface Session {
  id: number
  label: string
  start_time: number
  end_time: number
  page_count: number
  cluster_id: number
  pages: Page[]
}
