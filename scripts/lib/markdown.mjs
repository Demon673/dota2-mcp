// lib/markdown.mjs — shared mdast/GFM parsing and structural signature for the
// bilingual-pairing gate. Uses the same `mdast-util-from-markdown` +
// `micromark-extension-gfm` + `mdast-util-gfm` parser stack as the official
// harness, so the structure signature is derived from a real GFM AST, not hand-rolled.

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

/** Parse GitHub-flavored Markdown with the repository's standard extensions. */
export function parseMarkdown(source) {
  return fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

/** Depth-first visit; returning false prunes a node's children. */
export function visitMarkdown(node, visitor) {
  if (visitor(node) === false) return
  if ('children' in node) {
    for (const child of node.children) visitMarkdown(child, visitor)
  }
}

/** Whether the tree contains a link to any accepted target. */
export function linksTo(tree, targets) {
  const accepted = new Set(typeof targets === 'string' ? [targets] : targets)
  let found = false
  visitMarkdown(tree, (node) => {
    if (node.type === 'link' && accepted.has(node.url)) found = true
  })
  return found
}

/**
 * Collect the ordered structural signature, skipping accepted switcher targets.
 * Compared field-for-field between the two sides of a pair: heading depths,
 * verbatim code blocks (info string + content), table row/column counts, list
 * kind + ordered-list start + item count, and every link target in order.
 */
export function structureSignature(tree, switcherTargets) {
  const acceptedSwitchers = new Set(
    typeof switcherTargets === 'string' ? [switcherTargets] : switcherTargets,
  )
  const sig = { headings: [], code: [], tables: [], lists: [], links: [] }
  visitMarkdown(tree, (node) => {
    switch (node.type) {
      case 'heading':
        sig.headings.push(node.depth)
        break
      case 'code':
        sig.code.push(`\`\`\`${node.lang ?? ''}${node.meta ? ` ${node.meta}` : ''}\n${node.value}`)
        break
      case 'table':
        sig.tables.push(`${node.children.length}x${node.children[0]?.children.length ?? 0}`)
        break
      case 'list':
        sig.lists.push(node.ordered
          ? `ordered:start=${node.start ?? 1}:items=${node.children.length}`
          : `bullet:items=${node.children.length}`)
        break
      case 'link':
        if (!acceptedSwitchers.has(node.url)) sig.links.push(node.url)
        break
      default:
        break
    }
  })
  return sig
}
