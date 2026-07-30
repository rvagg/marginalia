export const COMMENTS_RESOURCE_URI = 'marginalia://comments/pending'

export interface PendingComment {
  content: string
  meta: Record<string, string>
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', '&quot;')
}

function formatComments(comments: PendingComment[]): string {
  return comments.map(comment => {
    const attrs = Object.entries(comment.meta).map(([key, value]) => {
      const escaped = escapeXmlAttribute(value)
      return `${key}="${escaped}"`
    }).join(' ')
    const content = escapeXmlText(comment.content)
    return `<channel source="marginalia" ${attrs}>\n${content}\n</channel>`
  }).join('\n\n')
}

export class CommentMailbox {
  #comments: PendingComment[] = []

  add(comment: PendingComment): void {
    this.#comments.push(comment)
  }

  read(): string {
    return formatComments(this.#comments)
  }

  drain(): string {
    const comments = this.#comments
    this.#comments = []
    return formatComments(comments)
  }

  acknowledgeThread(threadId: string): void {
    let writeIndex = 0
    for (const comment of this.#comments) {
      if (comment.meta.thread_id !== threadId) {
        this.#comments[writeIndex++] = comment
      }
    }
    this.#comments.length = writeIndex
  }
}
